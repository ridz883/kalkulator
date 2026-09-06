let currentInput = "";
let currentOrderId = null;
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

  try {
    const res = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression: currentInput })
    });

    const data = await res.json();
    if (res.ok) {
      currentOrderId = data.orderId;
      qrisImage.src = data.qrImage;
      priceTag.innerText = `Rp ${data.amount.toLocaleString("id-ID")}`;
      statusText.innerText = "Menunggu transfer masuk...";
      modal.classList.remove("hidden");

      startPollingPayment(currentOrderId);
    } else {
      alert(data.error || "Gagal membuat invoice tagihan.");
    }
  } catch (err) {
    alert("Koneksi ke server bermasalah.");
  }
}

function startPollingPayment(orderId) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/check-status/${orderId}`);
      const data = await res.json();

      if (data.status === "paid") {
        clearInterval(pollInterval);
        statusText.innerText = "Pembayaran Diterima! ✅";

        showToast("Pembayaran Sukses!", `Jawaban: ${data.result}`);

        setTimeout(() => {
          closeModal();
          resultPreview.innerText = `= ${data.result}`;
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
