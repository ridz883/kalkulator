const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ganti teks di bawah dengan teks mentah hasil scan QRIS kamu jika sudah di-scan
const STATIC_QRIS = "00020101021126570011ID1234567890123456789012340303UMI51440014ID.CO.QRIS.WWW0215ID20232108123456780303UMI520454995802ID5914MERCHANT NAME6007Jakarta61051234662070703A016304ABCD";

// Penyimpanan sementara nominal yang baru saja masuk (maksimal 50 riwayat terakhir)
let recentPayments = [];

// Helper: Hitung CRC16 QRIS
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

// Helper: Injeksi Nominal ke QRIS
function convertToDynamicQRIS(staticQris, amount) {
  let qris = staticQris.replace("010211", "010212");
  const crcIndex = qris.lastIndexOf("6304");
  if (crcIndex !== -1) qris = qris.substring(0, crcIndex);

  const amountStr = amount.toString();
  const amountLen = amountStr.length.toString().padStart(2, '0');
  const tag54 = `54${amountLen}${amountStr}`;

  const tag58Index = qris.indexOf("5802ID");
  if (tag58Index !== -1) {
    qris = qris.substring(0, tag58Index) + tag54 + qris.substring(tag58Index);
  } else {
    qris += tag54;
  }

  const payload = qris + "6304";
  return payload + calculateCRC16(payload);
}

// 1. Endpoint: Buat Gambar QRIS Dinamis
app.post('/api/get-qris', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ error: 'Nominal wajib diisi' });

    const dynamicPayload = convertToDynamicQRIS(STATIC_QRIS, amount);
    const qrImage = await QRCode.toDataURL(dynamicPayload, { margin: 2, scale: 7 });

    res.json({ qrImage });
  } catch (err) {
    res.status(500).json({ error: 'Gagal generate barcode' });
  }
});

// 2. Endpoint Webhook: Ditembak oleh MacroDroid saat notifikasi muncul
app.post('/api/webhook-payment', (req, res) => {
  const { amount, secret } = req.body;

  // Password sederhana agar tidak diserang orang iseng
  if (secret !== 'rahasia123') {
    return res.status(401).json({ error: 'Secret key salah' });
  }

  const numericAmount = parseInt(amount, 10);
  if (!numericAmount) {
    return res.status(400).json({ error: 'Amount tidak valid' });
  }

  // Simpan nominal yang masuk bersama timestamp
  recentPayments.push({
    amount: numericAmount,
    time: Date.now()
  });

  // Hapus mutasi lama yang umurnya lebih dari 10 menit
  recentPayments = recentPayments.filter(p => Date.now() - p.time < 600000);

  console.log(`[MUTASI MASUK] Berhasil mendeteksi nominal: Rp${numericAmount}`);
  res.json({ success: true, received: numericAmount });
});

// 3. Endpoint Cek: Browser memeriksa apakah nominalnya sudah masuk
app.get('/api/check-payment/:amount', (req, res) => {
  const checkAmount = parseInt(req.params.amount, 10);
  const paidIndex = recentPayments.findIndex(p => p.amount === checkAmount);

  if (paidIndex !== -1) {
    // Jika sudah lunas, hapus dari daftar agar tidak bentrok
    recentPayments.splice(paidIndex, 1);
    return res.json({ status: 'paid' });
  }

  res.json({ status: 'unpaid' });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server siap di http://localhost:${PORT}`));
}
