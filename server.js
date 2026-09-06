const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// QRIS Statis Asli Akun Merchant Kamu (ridzz05 - Kota Depok)
const STATIC_QRIS = "00020101021126570011ID.DANA.WWW011893600915303271888302090327188830303UMI51440014ID.CO.QRIS.WWW0215ID10265350467120303UMI5204654053033605802ID5907ridzz056010Kota Depok61051651563041F96";

// Penyimpanan sementara nominal yang baru masuk dari MacroDroid
let recentPayments = [];

// Helper: Hitung checksum CRC16-CCITT (Standar EMVCo QRIS)
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

// Helper: Ubah QRIS Statis menjadi Dinamis (Inject Tag 54 - Amount)
function convertToDynamicQRIS(staticQris, amount) {
  // 1. Ubah mode dari Statis (010211) menjadi Dinamis (010212)
  let qris = staticQris.replace("010211", "010212");

  // 2. Potong checksum CRC lama di bagian akhir (Tag 6304XXXX)
  const crcIndex = qris.lastIndexOf("6304");
  if (crcIndex !== -1) {
    qris = qris.substring(0, crcIndex);
  }

  // 3. Format Tag 54 (Nominal Transaksi)
  const amountStr = amount.toString();
  const amountLen = amountStr.length.toString().padStart(2, '0');
  const tag54 = `54${amountLen}${amountStr}`;

  // 4. Sisipkan Tag 54 sebelum Tag 58 (Country Code '5802ID')
  const tag58Index = qris.indexOf("5802ID");
  if (tag58Index !== -1) {
    qris = qris.substring(0, tag58Index) + tag54 + qris.substring(tag58Index);
  } else {
    qris += tag54;
  }

  // 5. Tambahkan tag CRC header lalu hitung checksum baru
  const payloadForCrc = qris + "6304";
  const newCrc = calculateCRC16(payloadForCrc);
  return payloadForCrc + newCrc;
}

// 1. Endpoint: Generate Barcode QRIS Dinamis Sesuai Nominal
app.post('/api/get-qris', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) {
      return res.status(400).json({ error: 'Nominal transaksi wajib dikirim' });
    }

    const dynamicPayload = convertToDynamicQRIS(STATIC_QRIS, amount);
    const qrImage = await QRCode.toDataURL(dynamicPayload, { margin: 2, scale: 7 });

    res.json({ qrImage, payload: dynamicPayload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat barcode QRIS' });
  }
});

// 2. Endpoint: Webhook Penerima Notifikasi dari MacroDroid di HP
app.post('/api/webhook-payment', (req, res) => {
  const { amount, secret } = req.body;

  // Verifikasi secret key
  if (secret !== 'rahasia123') {
    return res.status(401).json({ error: 'Secret key salah atau tidak diizinkan' });
  }

  const numericAmount = parseInt(amount, 10);
  if (!numericAmount) {
    return res.status(400).json({ error: 'Format nominal tidak valid' });
  }

  // Simpan mutasi pembayaran masuk
  recentPayments.push({
    amount: numericAmount,
    time: Date.now()
  });

  // Bersihkan data mutasi lama (> 10 menit)
  recentPayments = recentPayments.filter(p => Date.now() - p.time < 600000);

  console.log(`[PEMBAYARAN DITERIMA] Sukses mendeteksi transfer masuk: Rp${numericAmount}`);
  res.json({ success: true, received: numericAmount });
});

// 3. Endpoint: Polling Status Pembayaran dari Browser
app.get('/api/check-payment/:amount', (req, res) => {
  const checkAmount = parseInt(req.params.amount, 10);
  const paidIndex = recentPayments.findIndex(p => p.amount === checkAmount);

  if (paidIndex !== -1) {
    // Pembayaran valid ditemukan, hapus dari antrean agar tidak dipakai ganda
    recentPayments.splice(paidIndex, 1);
    return res.json({ status: 'paid' });
  }

  res.json({ status: 'unpaid' });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server aktif di http://localhost:${PORT}`));
}
