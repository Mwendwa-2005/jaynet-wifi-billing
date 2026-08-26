/**
 * JayNet Captive Portal Client Controller
 */

let selectedPackage = null;
let currentCheckoutRequestId = null;
let ws = null;

// Parse URL Parameters for MikroTik MAC or IP
const urlParams = new URLSearchParams(window.location.search);
const clientMac = urlParams.get('mac') || urlParams.get('client_mac') || '00:1A:2B:3C:4D:5E';

document.addEventListener('DOMContentLoaded', () => {
  fetchPackages();
  initWebSocket();
  setupEventListeners();
});

/**
 * Connect to WebSocket for instant real-time notifications
 */
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'PAYMENT_SUCCESS' && data.checkoutRequestId === currentCheckoutRequestId) {
        showSuccessView(data);
      } else if (data.type === 'PAYMENT_FAILED' && data.checkoutRequestId === currentCheckoutRequestId) {
        showFailedView(data.reason || 'Payment was cancelled or failed on M-Pesa.');
      }
    } catch (e) {
      console.error('WS Parse Error:', e);
    }
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 3000);
  };
}

/**
 * Fetch packages from API and render cards
 */
async function fetchPackages() {
  const grid = document.getElementById('packages-grid');
  try {
    const res = await fetch('/api/packages');
    const data = await res.json();

    if (!data.success || !data.packages.length) {
      grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1; color: var(--text-secondary);">No Wi-Fi packages currently active.</p>';
      return;
    }

    grid.innerHTML = data.packages.map((pkg) => {
      const isPopular = pkg.price === 10 || pkg.price === 2000;
      const isMonthly = pkg.duration_hours >= 720;
      return `
        <div class="package-card">
          ${isPopular ? `<div class="package-popular">${isMonthly ? 'Best Value' : 'Most Popular'}</div>` : ''}
          <div>
            <h3 class="package-name">${escapeHtml(pkg.name)}</h3>
            <div class="package-price-container">
              <span class="currency">KES</span>
              <span class="price">${pkg.price.toLocaleString()}</span>
              <span class="duration">/ ${formatDuration(pkg.duration_hours)}</span>
            </div>
            <ul class="package-features">
              <li>
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                Speed up to ${pkg.download_speed} Download
              </li>
              <li>
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                Instant M-Pesa Auto-Connect
              </li>
              <li>
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                Includes Reconnection Code
              </li>
              <li>
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                Connect up to ${pkg.device_limit} Device${pkg.device_limit > 1 ? 's' : ''}
              </li>
            </ul>
          </div>
          <button class="btn-select" onclick="openPaymentModal(${pkg.id}, '${escapeHtml(pkg.name)}', ${pkg.price})">
            Connect Now
          </button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching packages:', err);
    grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1; color: #ff5252;">Failed to load Wi-Fi packages. Make sure server is running.</p>';
  }
}

/**
 * Open Payment Modal
 */
function openPaymentModal(packageId, packageName, price) {
  selectedPackage = { id: packageId, name: packageName, price };
  document.getElementById('modal-package-name').innerText = packageName;
  document.getElementById('modal-package-price').innerText = `KES ${price.toLocaleString()}`;

  document.getElementById('payment-step-input').style.display = 'block';
  document.getElementById('payment-step-waiting').style.display = 'none';
  document.getElementById('payment-step-success').style.display = 'none';
  document.getElementById('payment-step-error').style.display = 'none';

  document.getElementById('payment-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('payment-modal').classList.remove('active');
  selectedPackage = null;
  currentCheckoutRequestId = null;
}

/**
 * Setup Event Handlers
 */
function setupEventListeners() {
  // Payment Form Submit
  document.getElementById('stk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phoneInput = document.getElementById('phone-number').value.trim();
    if (!phoneInput || !selectedPackage) return;

    document.getElementById('payment-step-input').style.display = 'none';
    document.getElementById('payment-step-waiting').style.display = 'block';

    try {
      const response = await fetch('/api/stk-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneInput,
          packageId: selectedPackage.id,
          macAddress: clientMac
        })
      });

      const resData = await response.json();

      if (!resData.success) {
        showFailedView(resData.error || 'Failed to trigger STK Push.');
        return;
      }

      currentCheckoutRequestId = resData.checkoutRequestId;

      if (resData.isDemo) {
        document.getElementById('waiting-msg').innerText = `Demo Mode: Interactive M-Pesa STK prompt sent to ${phoneInput}.`;
        document.getElementById('demo-stk-phone-dialog').style.display = 'block';
        document.getElementById('waiting-spinner-box').style.display = 'none';
        document.getElementById('demo-stk-amount').innerText = `KES ${resData.amount.toLocaleString()}`;
        document.getElementById('demo-stk-phone').innerText = resData.phone;
        document.getElementById('demo-mpesa-pin').focus();
      } else {
        document.getElementById('demo-stk-phone-dialog').style.display = 'none';
        document.getElementById('waiting-spinner-box').style.display = 'block';
        document.getElementById('waiting-msg').innerText = `STK Push sent to ${phoneInput}. Check your phone handset and enter your M-Pesa PIN!`;
      }

      pollTransactionStatus(currentCheckoutRequestId);
    } catch (err) {
      showFailedView('Network error triggering payment. Please try again.');
    }
  });

  // Demo Interactive PIN Submission Form
  document.getElementById('demo-pin-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = document.getElementById('demo-mpesa-pin').value.trim();
    if (!pin || !currentCheckoutRequestId) return;

    document.getElementById('demo-stk-phone-dialog').style.display = 'none';
    document.getElementById('waiting-spinner-box').style.display = 'block';
    document.getElementById('waiting-msg').innerText = 'Verifying M-Pesa PIN & Activating Wi-Fi Session...';

    try {
      const res = await fetch('/api/stk-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutRequestId: currentCheckoutRequestId, pin })
      });
      const data = await res.json();

      if (data.success) {
        showSuccessView({
          packageName: selectedPackage?.name,
          mpesaReceipt: data.mpesaReceipt,
          activation: data.activation
        });
      } else {
        showFailedView(data.error || 'PIN verification failed.');
      }
    } catch (err) {
      showFailedView('Error confirming M-Pesa PIN.');
    }
  });

  // Reconnection Code Form Submit
  document.getElementById('reconnect-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeOrPhone = document.getElementById('reconnect-code-input').value.trim();
    const resBox = document.getElementById('reconnect-result');
    resBox.style.display = 'block';
    resBox.style.background = 'rgba(255,255,255,0.05)';
    resBox.style.color = '#fff';
    resBox.innerText = 'Verifying Reconnection Code...';

    try {
      const res = await fetch('/api/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeOrPhone, macAddress: clientMac })
      });
      const data = await res.json();

      if (data.success) {
        resBox.style.background = 'rgba(0,230,118,0.2)';
        resBox.style.color = '#00e676';
        resBox.innerHTML = `
          <strong>✅ Reconnected Successfully!</strong><br>
          Package: <strong>${escapeHtml(data.session.package_name)}</strong><br>
          Remaining Time: <strong>${data.remainingHours} Hours</strong><br>
          <small style="margin-top:8px; display:block;">Your internet connection is now active.</small>
        `;
      } else {
        resBox.style.background = 'rgba(255,82,82,0.2)';
        resBox.style.color = '#ff5252';
        resBox.innerText = data.error || 'Reconnection failed.';
      }
    } catch (err) {
      resBox.style.background = 'rgba(255,82,82,0.2)';
      resBox.style.color = '#ff5252';
      resBox.innerText = 'Network error verifying code.';
    }
  });

  // Support Form Submit
  document.getElementById('support-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('support-phone').value.trim();
    const issueType = document.getElementById('support-type').value;
    const description = document.getElementById('support-desc').value.trim();

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, issueType, description })
      });
      const data = await res.json();
      alert(data.message || 'Support ticket submitted.');
      closeSupportModal();
    } catch (err) {
      alert('Error submitting support request.');
    }
  });
}

/**
 * Poll status backup
 */
async function pollTransactionStatus(checkoutId) {
  let attempts = 0;
  const maxAttempts = 30;

  const interval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts || currentCheckoutRequestId !== checkoutId) {
      clearInterval(interval);
      return;
    }

    try {
      const res = await fetch(`/api/transaction/status/${checkoutId}`);
      const data = await res.json();

      if (data.success && data.transaction) {
        if (data.transaction.status === 'COMPLETED') {
          clearInterval(interval);
          showSuccessView({
            packageName: data.transaction.package_name,
            mpesaReceipt: data.transaction.mpesa_receipt_number,
            activation: data.session
          });
        } else if (data.transaction.status === 'FAILED') {
          clearInterval(interval);
          showFailedView(data.transaction.result_desc || 'Payment was cancelled.');
        }
      }
    } catch (e) {
      console.log('Polling status error:', e);
    }
  }, 2000);
}

function showSuccessView(data) {
  document.getElementById('payment-step-waiting').style.display = 'none';
  document.getElementById('payment-step-success').style.display = 'block';

  document.getElementById('success-pkg-name').innerText = data.packageName || selectedPackage?.name || 'Wi-Fi Package';
  document.getElementById('success-receipt').innerText = data.mpesaReceipt || 'APPROVED';

  if (data.activation && data.activation.voucherCode) {
    document.getElementById('success-voucher-code').innerText = data.activation.voucherCode;
  }
}

function showFailedView(msg) {
  document.getElementById('payment-step-waiting').style.display = 'none';
  document.getElementById('payment-step-error').style.display = 'block';
  document.getElementById('error-message-text').innerText = msg;
}

function openReconnectModal() {
  document.getElementById('reconnect-modal').classList.add('active');
}

function closeReconnectModal() {
  document.getElementById('reconnect-modal').classList.remove('active');
}

function openSupportModal() {
  document.getElementById('support-modal').classList.add('active');
}

function closeSupportModal() {
  document.getElementById('support-modal').classList.remove('active');
}

function formatDuration(hours) {
  if (hours < 24) return `${hours} Hours`;
  const days = Math.floor(hours / 24);
  if (days >= 30) return `${Math.floor(days / 30)} Month${Math.floor(days / 30) > 1 ? 's' : ''}`;
  return `${days} Days`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
