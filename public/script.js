let currentInput = "";
let targetAmount = 0;
let pendingCalculationResult = null;
let pollInterval = null;

const display = document.getElementById("display");
const resultPreview = document.getElementById("result-preview");
const modal = document.getElementById("payment-modal");
const qrisImage = document.getElementById("qris-image");
const priceTag = document.getElementById("price-tag");
const statusText = document.getElementById("payment-status-text");
const toast = document.getElementById("toast");

function showToast(title, message) {
  document.getElementById("toast-title").innerText = title;
  document.getElementById("toast-message").innerText = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function appendValue(val) {
  if (currentInput === "0" && val !== ".") currentInput = "";
  currentInput += val;
  display.value = currentInput;
  resultPreview.innerText = "Hasil terkunci 🔒";
  resultPreview.classList.remove("revealed");
}

function clearDisplay() {
  currentInput = "";
  display.value = "";
  resultPreview.innerText = "Hasil terkunci 🔒";
  resultPreview.classList.remove("revealed");
}

function deleteLast() {
  currentInput = currentInput.slice(0, -1);
  display.value = currentInput;
}

async function requestCalculation() {
  if (!currentInput.trim()) return;

  // 1. Hitung hasilnya langsung di browser
  try {
    const cleanExpr = currentInput.replace(/[^0-9+\-*/().]/g, '');
    pendingCalculationResult = Function(`'use strict'; return (${cleanExpr})`)();
  } catch (e) {
    alert("Ekspresi matematika salah!");
    return;
  }

  // 2. Tentukan harga: Rp1.000 + 2 digit angka acak (misal Rp1.047)
  const basePrice = 1000;
  const uniqueCode = Math.floor(Math.random() * 90) + 10;
  targetAmount = basePrice + uniqueCode;

  // 3. Minta server membuat gambar QRIS dengan nominal tersebut
  try {
    const res = await fetch("/api/get-qris", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: targetAmount })
    });

    const data = await res.json();
    if (res.ok) {
      qrisImage.src = data.qrImage;
      priceTag.innerText = `Rp ${targetAmount.toLocaleString("id-ID")}`;
      statusText.innerText = "Menunggu transfer masuk...";
      modal.classList.remove("hidden");

      // 4. Mulai polling mengecek apakah nominal ini sudah dibayar
      startPollingPayment(targetAmount);
    } else {
      alert("Gagal memuat QRIS");
    }
  } catch (err) {
    alert("Koneksi gagal ke server.");
  }
}

function startPollingPayment(amount) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/check-payment/${amount}`);
      const data = await res.json();

      if (data.status === "paid") {
        clearInterval(pollInterval);
        statusText.innerText = "Pembayaran Berhasil! ✅";

        showToast("Pembayaran Sukses!", `Hasil: ${pendingCalculationResult}`);

        setTimeout(() => {
          closeModal();
          resultPreview.innerText = `= ${pendingCalculationResult}`;
          resultPreview.classList.add("revealed");
        }, 1000);
      }
    } catch (e) {
      console.error("Polling error", e);
    }
  }, 2500);
}

function closeModal() {
  modal.classList.add("hidden");
  if (pollInterval) clearInterval(pollInterval);
}
