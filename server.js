require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const db = require('./db');
const mpesaService = require('./services/mpesa');
const mikrotikService = require('./services/mikrotik');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket Connection Manager & Broadcast
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'JayNet Real-time WebSocket Service Connected.' }));

  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// -------------------------------------------------------------
// PUBLIC CLIENT API ENDPOINTS
// -------------------------------------------------------------

/**
 * Get all active Wi-Fi Packages
 */
app.get('/api/packages', async (req, res) => {
  try {
    const packages = await db.query('SELECT * FROM packages WHERE active = 1 ORDER BY price ASC');
    res.json({ success: true, packages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Initiate M-Pesa STK Push Payment
 */
app.post('/api/stk-push', async (req, res) => {
  try {
    const { phone, packageId, macAddress } = req.body;

    if (!phone || !packageId) {
      return res.status(400).json({ success: false, error: 'Phone number and Package choice are required.' });
    }

    const pkg = await db.get('SELECT * FROM packages WHERE id = ? AND active = 1', [packageId]);
    if (!pkg) {
      return res.status(404).json({ success: false, error: 'Selected Wi-Fi package not found or inactive.' });
    }

    const result = await mpesaService.initiateStkPush({
      phone,
      amount: pkg.price,
      packageId: pkg.id,
      packageName: pkg.name,
      macAddress: macAddress || '00:00:00:00:00:00'
    });

    // Handle Simulation Mode Auto-Approve for Instant Testing
    if (result.isSimulation) {
      setTimeout(async () => {
        try {
          const mpesaReceipt = 'SIM' + Math.random().toString(36).substring(2, 10).toUpperCase();

          // Activate MikroTik Session & generate Reconnection Voucher Code
          const activation = await mikrotikService.activateHotspotUser({
            phone,
            macAddress,
            packageItem: pkg,
            durationHours: pkg.duration_hours
          });

          await db.run(
            `UPDATE transactions 
             SET status = 'COMPLETED', mpesa_receipt_number = ?, voucher_code = ?, result_desc = 'Simulation Payment Approved' 
             WHERE checkout_request_id = ?`,
            [mpesaReceipt, activation.voucherCode, result.checkoutRequestId]
          );

          // Broadcast WebSocket update
          broadcast({
            type: 'PAYMENT_SUCCESS',
            checkoutRequestId: result.checkoutRequestId,
            phone,
            packageName: pkg.name,
            mpesaReceipt,
            activation
          });
        } catch (simErr) {
          console.error('[Simulation Auto-Approve Error]:', simErr);
        }
      }, 4000);
    }

    res.json({
      success: true,
      checkoutRequestId: result.checkoutRequestId,
      message: result.customerMessage,
      isSimulation: result.isSimulation
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Check Transaction & Session Status by CheckoutRequestID
 */
app.get('/api/transaction/status/:checkoutRequestId', async (req, res) => {
  try {
    const txn = await db.get('SELECT * FROM transactions WHERE checkout_request_id = ?', [
      req.params.checkoutRequestId
    ]);
    if (!txn) {
      return res.status(404).json({ success: false, error: 'Transaction record not found.' });
    }

    let session = null;
    if (txn.status === 'COMPLETED') {
      session = await db.get('SELECT * FROM sessions WHERE phone = ? ORDER BY id DESC LIMIT 1', [txn.phone]);
    }

    res.json({ success: true, transaction: txn, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Reconnect Client Using Voucher Code or Phone Number
 */
app.post('/api/reconnect', async (req, res) => {
  try {
    const { codeOrPhone, macAddress } = req.body;
    if (!codeOrPhone) {
      return res.status(400).json({ success: false, error: 'Please enter your Reconnection Code or Phone Number.' });
    }

    const reconnection = await mikrotikService.reconnectSession({
      codeOrPhone,
      newMacAddress: macAddress
    });

    broadcast({ type: 'SESSION_RECONNECTED', username: reconnection.session.username });
    res.json(reconnection);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * M-Pesa Daraja Callback Webhook Receiver
 */
app.post('/api/mpesa/callback', async (req, res) => {
  console.log('[M-Pesa Callback Payload Received]:', JSON.stringify(req.body));
  const callbackResult = await mpesaService.processCallback(req.body);

  if (callbackResult.success && callbackResult.status === 'COMPLETED') {
    const txn = callbackResult.transaction;
    const pkg = await db.get('SELECT * FROM packages WHERE id = ?', [txn.package_id]);

    if (pkg) {
      const activation = await mikrotikService.activateHotspotUser({
        phone: txn.phone,
        macAddress: txn.mac_address,
        packageItem: pkg,
        durationHours: pkg.duration_hours
      });

      await db.run(
        `UPDATE transactions SET voucher_code = ? WHERE id = ?`,
        [activation.voucherCode, txn.id]
      );

      broadcast({
        type: 'PAYMENT_SUCCESS',
        checkoutRequestId: txn.checkout_request_id,
        phone: txn.phone,
        packageName: pkg.name,
        mpesaReceipt: txn.mpesa_receipt_number,
        activation
      });
    }
  } else if (callbackResult.status === 'FAILED') {
    broadcast({
      type: 'PAYMENT_FAILED',
      checkoutRequestId: req.body?.Body?.stkCallback?.CheckoutRequestID,
      reason: callbackResult.resultDesc
    });
  }

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/**
 * Submit Customer Support Ticket
 */
app.post('/api/support', async (req, res) => {
  try {
    const { phone, issueType, description } = req.body;
    if (!phone || !issueType || !description) {
      return res.status(400).json({ success: false, error: 'Please provide phone, issue type, and description.' });
    }

    await db.run(
      'INSERT INTO support_tickets (phone, issue_type, description) VALUES (?, ?, ?)',
      [phone, issueType, description]
    );

    broadcast({ type: 'NEW_SUPPORT_TICKET', phone, issueType });
    res.json({ success: true, message: 'Support ticket submitted successfully. Our team is inspecting your connection!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN MANAGEMENT & CONTROL API ENDPOINTS
// -------------------------------------------------------------

/**
 * Admin Dashboard Metrics
 */
app.get('/api/admin/metrics', async (req, res) => {
  try {
    const totalRevRow = await db.get("SELECT SUM(amount) as total FROM transactions WHERE status = 'COMPLETED'");
    const activeUsersRow = await db.get("SELECT COUNT(*) as count FROM sessions WHERE status = 'ACTIVE'");
    const totalTxnsRow = await db.get("SELECT COUNT(*) as count FROM transactions");
    const openTicketsRow = await db.get("SELECT COUNT(*) as count FROM support_tickets WHERE status = 'OPEN'");

    const routerStatus = await mikrotikService.testConnection();

    res.json({
      success: true,
      metrics: {
        totalRevenue: totalRevRow?.total || 0,
        activeSessions: activeUsersRow?.count || 0,
        totalTransactions: totalTxnsRow?.count || 0,
        openTickets: openTicketsRow?.count || 0,
        routerStatus
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Manage Wi-Fi Packages (CRUD)
 */
app.get('/api/admin/packages', async (req, res) => {
  try {
    const packages = await db.query('SELECT * FROM packages ORDER BY id DESC');
    res.json({ success: true, packages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/packages', async (req, res) => {
  try {
    const { name, price, duration_hours, download_speed, upload_speed, device_limit } = req.body;
    await db.run(
      `INSERT INTO packages (name, price, duration_hours, download_speed, upload_speed, device_limit)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, price, duration_hours, download_speed || '5M', upload_speed || '2M', device_limit || 1]
    );

    broadcast({ type: 'PACKAGES_UPDATED' });
    res.json({ success: true, message: 'Wi-Fi package created successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/packages/:id', async (req, res) => {
  try {
    const { name, price, duration_hours, download_speed, upload_speed, device_limit, active } = req.body;
    await db.run(
      `UPDATE packages 
       SET name = ?, price = ?, duration_hours = ?, download_speed = ?, upload_speed = ?, device_limit = ?, active = ?
       WHERE id = ?`,
      [name, price, duration_hours, download_speed, upload_speed, device_limit, active ? 1 : 0, req.params.id]
    );

    broadcast({ type: 'PACKAGES_UPDATED' });
    res.json({ success: true, message: 'Package updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/packages/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM packages WHERE id = ?', [req.params.id]);
    broadcast({ type: 'PACKAGES_UPDATED' });
    res.json({ success: true, message: 'Package deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Admin Transactions Log
 */
app.get('/api/admin/transactions', async (req, res) => {
  try {
    const transactions = await db.query('SELECT * FROM transactions ORDER BY id DESC LIMIT 100');
    res.json({ success: true, transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Admin Active Sessions Control
 */
app.get('/api/admin/sessions', async (req, res) => {
  try {
    const sessions = await db.query('SELECT * FROM sessions ORDER BY id DESC LIMIT 100');
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/sessions/extend', async (req, res) => {
  try {
    const { username, additionalHours } = req.body;
    const result = await mikrotikService.extendSession(username, parseFloat(additionalHours || 1));
    broadcast({ type: 'SESSION_UPDATED', username });
    res.json({ success: true, message: `Session extended for ${username}`, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/sessions/kick', async (req, res) => {
  try {
    const { username } = req.body;
    const result = await mikrotikService.kickSession(username);
    broadcast({ type: 'SESSION_UPDATED', username });
    res.json({ success: true, message: `Disconnected user ${username}`, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Customer Support Tickets Management
 */
app.get('/api/admin/support', async (req, res) => {
  try {
    const tickets = await db.query('SELECT * FROM support_tickets ORDER BY id DESC');
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/support/:id', async (req, res) => {
  try {
    const { status } = req.body;
    await db.run('UPDATE support_tickets SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: 'Ticket status updated.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * System Settings
 */
app.get('/api/admin/settings', async (req, res) => {
  try {
    const settings = await db.query('SELECT * FROM settings');
    const settingsObj = {};
    settings.forEach(s => (settingsObj[s.key] = s.value));

    const responseSettings = {
      MPESA_ENVIRONMENT: settingsObj.MPESA_ENVIRONMENT || process.env.MPESA_ENVIRONMENT || 'sandbox',
      MPESA_CONSUMER_KEY: settingsObj.MPESA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY || '',
      MPESA_CONSUMER_SECRET: settingsObj.MPESA_CONSUMER_SECRET || process.env.MPESA_CONSUMER_SECRET || '',
      MPESA_PASSKEY: settingsObj.MPESA_PASSKEY || process.env.MPESA_PASSKEY || '',
      MPESA_SHORTCODE: settingsObj.MPESA_SHORTCODE || process.env.MPESA_SHORTCODE || '174379',
      MPESA_CALLBACK_URL: settingsObj.MPESA_CALLBACK_URL || process.env.MPESA_CALLBACK_URL || '',

      MIKROTIK_HOST: settingsObj.MIKROTIK_HOST || process.env.MIKROTIK_HOST || '192.168.88.1',
      MIKROTIK_PORT: settingsObj.MIKROTIK_PORT || process.env.MIKROTIK_PORT || '8728',
      MIKROTIK_USER: settingsObj.MIKROTIK_USER || process.env.MIKROTIK_USER || 'admin',
      MIKROTIK_PASSWORD: settingsObj.MIKROTIK_PASSWORD || process.env.MIKROTIK_PASSWORD || '',
      MIKROTIK_HOTSPOT_SERVER: settingsObj.MIKROTIK_HOTSPOT_SERVER || process.env.MIKROTIK_HOTSPOT_SERVER || 'all',
      MIKROTIK_SIMULATION_MODE: settingsObj.MIKROTIK_SIMULATION_MODE || process.env.MIKROTIK_SIMULATION_MODE || 'true'
    };

    res.json({ success: true, settings: responseSettings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    }
    res.json({ success: true, message: 'Settings saved successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Test MikroTik Router Connection
 */
app.post('/api/admin/test-mikrotik', async (req, res) => {
  try {
    const status = await mikrotikService.testConnection();
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Start Server
 */
server.listen(PORT, () => {
  console.log(`
============================================================
⚡ JayNet Wi-Fi Billing System Server Online!
------------------------------------------------------------
🌐 Captive Portal Homepage : http://localhost:${PORT}
⚙️ Admin Management Panel : http://localhost:${PORT}/admin.html
============================================================
  `);
});
