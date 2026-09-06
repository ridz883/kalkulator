const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const path = require('path');
const { Redis } = require('@upstash/redis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inisialisasi Upstash Redis Client (Environment Variables di Vercel)
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || ''
});

// =========================================================================
// 1. MASUKKAN STRING HASIL SCAN DARI GAMBAR QRIS KAMU DI SINI
//    (Gunakan aplikasi Google Lens / QR Scanner di HP untuk scan foto QRIS-mu)
// =========================================================================
const STATIC_QRIS_STRING = process.env.STATIC_QRIS || "00020101021126570011ID1234567890123456789012340303UMI51440014ID.CO.QRIS.WWW0215ID20232108123456780303UMI520454995802ID5914MERCHANT NAME6007Jakarta61051234662070703A016304ABCD";

// Token Pengaman Webhook (Samakan dengan yang disetel di MacroDroid)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "MY_SUPER_SECRET_KEY";

// Helper: Hitung CRC16-CCITT (Standar EMVCo QRIS)
function calculateCRC16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  let hex = (crc & 0xFFFF).toString(16).toUpperCase();
  return hex.padStart(4, '0');
}

// Helper: Ubah QRIS Statis Menjadi QRIS Dinamis (EMVCo Injected Amount)
function convertToDynamicQRIS(staticQris, amount) {
  let qris = staticQris.replace("010211", "010212");

  const crcIndex = qris.lastIndexOf("6304");
  if (crcIndex !== -1) {
    qris = qris.substring(0, crcIndex);
  }

  const amountStr = amount.toString();
  const amountLen = amountStr.length.toString().padStart(2, '0');
  const tag54 = `54${amountLen}${amountStr}`;

  const tag58Index = qris.indexOf("5802ID");
  if (tag58Index !== -1) {
    qris = qris.substring(0, tag58Index) + tag54 + qris.substring(tag58Index);
  } else {
    qris += tag54;
  }

  const payloadForCrc = qris + "6304";
  const newCrc = calculateCRC16(payloadForCrc);
  return payloadForCrc + newCrc;
}

// 1. Endpoint: Hitung & Buat Invoice QRIS
app.post('/api/calculate', async (req, res) => {
  try {
    const { expression } = req.body;
    if (!expression) {
      return res.status(400).json({ error: 'Expression diperlukan' });
    }

    // Evaluasi rumus secara aman
    const cleanExpr = expression.replace(/[^0-9+\-*/().]/g, '');
    let result;
    try {
      result = Function(`'use strict'; return (${cleanExpr})`)();
    } catch {
      return res.status(400).json({ error: 'Ekspresi matematika keliru' });
    }

    // Nominal dasar Rp1.000 + Kode unik acak 1-99
    const basePrice = 1000;
    const uniqueCode = Math.floor(Math.random() * 99) + 1;
    const totalAmount = basePrice + uniqueCode;
    const orderId = `ORD-${Date.now()}`;

    const orderData = {
      orderId,
      expression,
      result,
      amount: totalAmount,
      status: 'unpaid',
      createdAt: Date.now()
    };

    // Simpan di Upstash Redis dengan masa berlaku 15 menit (900 detik)
    await redis.set(`order:${orderId}`, JSON.stringify(orderData), { ex: 900 });
    // Indexing nominal untuk pencarian instan saat notifikasi masuk
    await redis.set(`amount:${totalAmount}`, orderId, { ex: 900 });

    const dynamicPayload = convertToDynamicQRIS(STATIC_QRIS_STRING, totalAmount);
    const qrImage = await QRCode.toDataURL(dynamicPayload, { margin: 2, scale: 7 });

    res.json({
      orderId,
      amount: totalAmount,
      qrImage
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan sistem' });
  }
});

// 2. Endpoint: Polling Status Order dari Web Frontend
app.get('/api/check-status/:orderId', async (req, res) => {
  try {
    const rawOrder = await redis.get(`order:${req.params.orderId}`);
    if (!rawOrder) {
      return res.status(404).json({ error: 'Invoice tidak ditemukan atau kedaluwarsa' });
    }

    const order = typeof rawOrder === 'string' ? JSON.parse(rawOrder) : rawOrder;

    if (order.status === 'paid') {
      return res.json({ status: 'paid', result: order.result });
    }

    res.json({ status: 'unpaid' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memeriksa status' });
  }
});

// 3. Endpoint: Webhook Notifikasi dari HP Android (MacroDroid)
app.post('/api/webhook-payment', async (req, res) => {
  try {
    const { amount, secret } = req.body;

    if (secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized: Secret key salah' });
    }

    const numericAmount = parseInt(amount, 10);
    if (!numericAmount) {
      return res.status(400).json({ error: 'Nominal amount tidak valid' });
    }

    // Ambil orderId berdasarkan nominal yang ditransfer
    const orderId = await redis.get(`amount:${numericAmount}`);
    if (!orderId) {
      return res.status(404).json({ message: 'Tidak ada invoice yang sesuai nominal ini' });
    }

    const rawOrder = await redis.get(`order:${orderId}`);
    if (!rawOrder) {
      return res.status(404).json({ message: 'Order sudah kedaluwarsa' });
    }

    const order = typeof rawOrder === 'string' ? JSON.parse(rawOrder) : rawOrder;
    order.status = 'paid';

    // Update status order menjadi paid
    await redis.set(`order:${orderId}`, JSON.stringify(order), { ex: 300 });
    // Hapus indeks nominal agar tidak dipakai ulang
    await redis.del(`amount:${numericAmount}`);

    console.log(`[SUKSES] Invoice ${orderId} lunas sebesar Rp${numericAmount}!`);
    res.json({ success: true, orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memproses webhook' });
  }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server siap di http://localhost:${PORT}`));
}
