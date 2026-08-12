/**
 * JayNet Admin Dashboard Controller
 */

let ws = null;

document.addEventListener('DOMContentLoaded', () => {
  initAdminWebSocket();
  loadMetrics();
  loadPackages();
  loadTransactions();
  loadSessions();
  loadSupportTickets();
  loadSettings();
  setupAdminNavigation();
});

/**
 * Real-time Admin Updates via WebSocket
 */
function initAdminWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PACKAGES_UPDATED', 'SESSION_UPDATED', 'SESSION_RECONNECTED', 'NEW_SUPPORT_TICKET'].includes(data.type)) {
        loadMetrics();
        loadTransactions();
        loadSessions();
        loadSupportTickets();
      }
    } catch (e) {
      console.error(e);
    }
  };

  ws.onclose = () => setTimeout(initAdminWebSocket, 3000);
}

/**
 * Setup Tab Navigation
 */
function setupAdminNavigation() {
  const navBtns = document.querySelectorAll('.admin-nav-btn');
  const sections = document.querySelectorAll('.admin-section');

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      navBtns.forEach((b) => b.classList.remove('active'));
      sections.forEach((s) => s.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      document.getElementById(targetId).classList.add('active');
    });
  });
}

/**
 * Load Overview Metrics
 */
async function loadMetrics() {
  try {
    const res = await fetch('/api/admin/metrics');
    const data = await res.json();
    if (data.success) {
      const m = data.metrics;
      document.getElementById('metric-revenue').innerText = `KES ${(m.totalRevenue || 0).toLocaleString()}`;
      document.getElementById('metric-sessions').innerText = m.activeSessions;
      document.getElementById('metric-transactions').innerText = m.totalTransactions;
      document.getElementById('metric-tickets').innerText = m.openTickets;

      const routerPill = document.getElementById('router-status-indicator');
      if (m.routerStatus.online) {
        routerPill.className = 'status-pill online';
        routerPill.innerHTML = `<span class="status-dot"></span> Router ${m.routerStatus.mode === 'SIMULATION' ? 'Online (Virtual)' : 'Online'}`;
      } else {
        routerPill.className = 'status-pill offline';
        routerPill.innerHTML = `<span class="status-dot offline"></span> Router Offline`;
      }
    }
  } catch (err) {
    console.error('Error loading metrics:', err);
  }
}

/**
 * Load Packages Management Table
 */
async function loadPackages() {
  try {
    const res = await fetch('/api/admin/packages');
    const data = await res.json();
    const tbody = document.getElementById('packages-tbody');

    if (!data.packages.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No packages defined yet. Click Add Package.</td></tr>';
      return;
    }

    tbody.innerHTML = data.packages.map((p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>KES ${p.price.toLocaleString()}</td>
        <td>${p.duration_hours >= 720 ? Math.floor(p.duration_hours / 720) + ' Month(s)' : p.duration_hours + ' Hours'}</td>
        <td>↓ ${p.download_speed} / ↑ ${p.upload_speed}</td>
        <td>${p.device_limit} Device(s)</td>
        <td><span class="badge ${p.active ? 'badge-success' : 'badge-inactive'}">${p.active ? 'Active' : 'Disabled'}</span></td>
        <td>
          <button class="btn-action edit" onclick="editPackageModal(${p.id}, '${escapeHtml(p.name)}', ${p.price}, ${p.duration_hours}, '${p.download_speed}', '${p.upload_speed}', ${p.device_limit}, ${p.active})">Edit</button>
          <button class="btn-action delete" onclick="deletePackage(${p.id})">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading packages:', err);
  }
}

/**
 * Package Create / Edit Modal
 */
function openAddPackageModal() {
  document.getElementById('pkg-id').value = '';
  document.getElementById('pkg-name').value = '';
  document.getElementById('pkg-price').value = '';
  document.getElementById('pkg-duration').value = '';
  document.getElementById('pkg-download').value = '15M';
  document.getElementById('pkg-upload').value = '10M';
  document.getElementById('pkg-devices').value = '3';
  document.getElementById('pkg-active').checked = true;

  document.getElementById('pkg-modal-title').innerText = 'Add Wi-Fi Package';
  document.getElementById('package-modal').classList.add('active');
}

function editPackageModal(id, name, price, duration, dl, ul, devices, active) {
  document.getElementById('pkg-id').value = id;
  document.getElementById('pkg-name').value = name;
  document.getElementById('pkg-price').value = price;
  document.getElementById('pkg-duration').value = duration;
  document.getElementById('pkg-download').value = dl;
  document.getElementById('pkg-upload').value = ul;
  document.getElementById('pkg-devices').value = devices;
  document.getElementById('pkg-active').checked = !!active;

  document.getElementById('pkg-modal-title').innerText = 'Edit Wi-Fi Package';
  document.getElementById('package-modal').classList.add('active');
}

function closePackageModal() {
  document.getElementById('package-modal').classList.remove('active');
}

async function savePackage(e) {
  e.preventDefault();
  const id = document.getElementById('pkg-id').value;
  const payload = {
    name: document.getElementById('pkg-name').value.trim(),
    price: parseFloat(document.getElementById('pkg-price').value),
    duration_hours: parseFloat(document.getElementById('pkg-duration').value),
    download_speed: document.getElementById('pkg-download').value.trim(),
    upload_speed: document.getElementById('pkg-upload').value.trim(),
    device_limit: parseInt(document.getElementById('pkg-devices').value),
    active: document.getElementById('pkg-active').checked ? 1 : 0
  };

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/admin/packages/${id}` : '/api/admin/packages';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closePackageModal();
      loadPackages();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Failed to save package.');
  }
}

async function deletePackage(id) {
  if (!confirm('Are you sure you want to delete this Wi-Fi package?')) return;
  try {
    const res = await fetch(`/api/admin/packages/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) loadPackages();
  } catch (err) {
    alert('Error deleting package.');
  }
}

/**
 * Load Transactions Table
 */
async function loadTransactions() {
  try {
    const res = await fetch('/api/admin/transactions');
    const data = await res.json();
    const tbody = document.getElementById('transactions-tbody');

    if (!data.transactions.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No payment transactions recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.transactions.map((t) => `
      <tr>
        <td>#${t.id}</td>
        <td><strong>${t.phone}</strong></td>
        <td>${t.package_name || '-'}</td>
        <td>KES ${t.amount.toLocaleString()}</td>
        <td><strong style="color:var(--accent-cyan);">${t.voucher_code || '-'}</strong></td>
        <td><code>${t.mpesa_receipt_number || t.checkout_request_id || '-'}</code></td>
        <td><span class="badge badge-${t.status.toLowerCase()}">${t.status}</span></td>
        <td>${new Date(t.created_at).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading transactions:', err);
  }
}

/**
 * Load Active Sessions Table
 */
async function loadSessions() {
  try {
    const res = await fetch('/api/admin/sessions');
    const data = await res.json();
    const tbody = document.getElementById('sessions-tbody');

    if (!data.sessions.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No active Wi-Fi sessions right now.</td></tr>';
      return;
    }

    tbody.innerHTML = data.sessions.map((s) => `
      <tr>
        <td><strong style="color:var(--accent-cyan); font-size:15px;">${s.voucher_code || s.username}</strong></td>
        <td>${s.phone}</td>
        <td>${s.package_name}</td>
        <td>${s.mac_address || 'Bound'}</td>
        <td><span class="badge ${s.status === 'ACTIVE' ? 'badge-success' : 'badge-inactive'}">${s.status}</span></td>
        <td>${new Date(s.end_time).toLocaleString()}</td>
        <td>
          <button class="btn-action edit" onclick="extendUserSession('${s.username}')">+1 Hr</button>
          <button class="btn-action delete" onclick="kickUserSession('${s.username}')">Disconnect</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading sessions:', err);
  }
}

async function extendUserSession(username) {
  try {
    const res = await fetch('/api/admin/sessions/extend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, additionalHours: 1 })
    });
    const data = await res.json();
    if (data.success) loadSessions();
  } catch (err) {
    alert('Error extending session.');
  }
}

async function kickUserSession(username) {
  if (!confirm(`Disconnect Wi-Fi user ${username}?`)) return;
  try {
    const res = await fetch('/api/admin/sessions/kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (data.success) loadSessions();
  } catch (err) {
    alert('Error kicking user.');
  }
}

/**
 * Load Support Tickets
 */
async function loadSupportTickets() {
  try {
    const res = await fetch('/api/admin/support');
    const data = await res.json();
    const tbody = document.getElementById('support-tbody');

    if (!data.tickets.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No customer support tickets.</td></tr>';
      return;
    }

    tbody.innerHTML = data.tickets.map((tk) => `
      <tr>
        <td>#${tk.id}</td>
        <td><strong>${tk.phone}</strong></td>
        <td><span class="badge badge-warning">${escapeHtml(tk.issue_type)}</span></td>
        <td>${escapeHtml(tk.description)}</td>
        <td><span class="badge badge-${tk.status.toLowerCase()}">${tk.status}</span></td>
        <td>
          ${tk.status === 'OPEN' ? `<button class="btn-action edit" onclick="updateTicketStatus(${tk.id}, 'RESOLVED')">Mark Resolved</button>` : 'Resolved'}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading tickets:', err);
  }
}

async function updateTicketStatus(id, status) {
  try {
    const res = await fetch(`/api/admin/support/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (data.success) loadSupportTickets();
  } catch (err) {
    alert('Error updating ticket.');
  }
}

/**
 * Settings Management & Diagnostics
 */
async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings');
    const data = await res.json();

    if (data.success) {
      const s = data.settings;
      document.getElementById('set-mpesa-env').value = s.MPESA_ENVIRONMENT || 'sandbox';
      document.getElementById('set-mpesa-key').value = s.MPESA_CONSUMER_KEY || '';
      document.getElementById('set-mpesa-secret').value = s.MPESA_CONSUMER_SECRET || '';
      document.getElementById('set-mpesa-passkey').value = s.MPESA_PASSKEY || '';
      document.getElementById('set-mpesa-shortcode').value = s.MPESA_SHORTCODE || '174379';
      document.getElementById('set-mpesa-callback').value = s.MPESA_CALLBACK_URL || '';

      document.getElementById('set-mikrotik-host').value = s.MIKROTIK_HOST || '192.168.88.1';
      document.getElementById('set-mikrotik-port').value = s.MIKROTIK_PORT || '8728';
      document.getElementById('set-mikrotik-user').value = s.MIKROTIK_USER || 'admin';
      document.getElementById('set-mikrotik-pass').value = s.MIKROTIK_PASSWORD || '';
      document.getElementById('set-mikrotik-server').value = s.MIKROTIK_HOTSPOT_SERVER || 'all';
      document.getElementById('set-mikrotik-sim').value = s.MIKROTIK_SIMULATION_MODE || 'true';
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const settingsObj = {
    MPESA_ENVIRONMENT: document.getElementById('set-mpesa-env').value,
    MPESA_CONSUMER_KEY: document.getElementById('set-mpesa-key').value.trim(),
    MPESA_CONSUMER_SECRET: document.getElementById('set-mpesa-secret').value.trim(),
    MPESA_PASSKEY: document.getElementById('set-mpesa-passkey').value.trim(),
    MPESA_SHORTCODE: document.getElementById('set-mpesa-shortcode').value.trim(),
    MPESA_CALLBACK_URL: document.getElementById('set-mpesa-callback').value.trim(),

    MIKROTIK_HOST: document.getElementById('set-mikrotik-host').value.trim(),
    MIKROTIK_PORT: document.getElementById('set-mikrotik-port').value.trim(),
    MIKROTIK_USER: document.getElementById('set-mikrotik-user').value.trim(),
    MIKROTIK_PASSWORD: document.getElementById('set-mikrotik-pass').value.trim(),
    MIKROTIK_HOTSPOT_SERVER: document.getElementById('set-mikrotik-server').value.trim(),
    MIKROTIK_SIMULATION_MODE: document.getElementById('set-mikrotik-sim').value
  };

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsObj)
    });
    const data = await res.json();
    if (data.success) {
      alert('Settings saved successfully!');
      loadMetrics();
    } else {
      alert('Failed to save settings: ' + data.error);
    }
  } catch (err) {
    alert('Error saving settings.');
  }
}

async function testMikroTikConnection() {
  const resultBox = document.getElementById('mikrotik-test-result');
  resultBox.innerText = 'Testing connection to MikroTik router...';
  try {
    const res = await fetch('/api/admin/test-mikrotik', { method: 'POST' });
    const data = await res.json();
    resultBox.innerText = data.status.message;
    resultBox.style.color = data.status.online ? '#00e676' : '#ff5252';
  } catch (err) {
    resultBox.innerText = 'Error executing test.';
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
