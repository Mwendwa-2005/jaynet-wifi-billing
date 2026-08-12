const net = require('net');
const db = require('../db');

/**
 * Fetch current MikroTik configuration settings
 */
async function getMikroTikConfig() {
  const host = (await db.get("SELECT value FROM settings WHERE key = 'MIKROTIK_HOST'"))?.value || process.env.MIKROTIK_HOST || '192.168.88.1';
  const port = parseInt((await db.get("SELECT value FROM settings WHERE key = 'MIKROTIK_PORT'"))?.value || process.env.MIKROTIK_PORT || '8728');
  const user = (await db.get("SELECT value FROM settings WHERE key = 'MIKROTIK_USER'"))?.value || process.env.MIKROTIK_USER || 'admin';
  const password = (await db.get("SELECT value FROM settings WHERE key = 'MIKROTIK_PASSWORD'"))?.value || process.env.MIKROTIK_PASSWORD || '';
  const hotspotServer = (await db.get("SELECT value FROM settings WHERE key = 'MIKROTIK_HOTSPOT_SERVER'"))?.value || process.env.MIKROTIK_HOTSPOT_SERVER || 'all';
  const simSetting = (await db.get("SELECT value FROM settings WHERE key = 'MIKROTIK_SIMULATION_MODE'"))?.value;
  const simulationMode = simSetting ? simSetting === 'true' : (process.env.MIKROTIK_SIMULATION_MODE !== 'false');

  return {
    host,
    port,
    user,
    password,
    hotspotServer,
    simulationMode
  };
}

/**
 * Test connection to MikroTik Router API
 */
async function testConnection() {
  const config = await getMikroTikConfig();

  if (config.simulationMode) {
    return {
      online: true,
      mode: 'SIMULATION',
      message: 'MikroTik Router API is running in Simulation Mode (Virtual Hotspot Engine Online).'
    };
  }

  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(3000);

    socket.on('connect', () => {
      socket.destroy();
      resolve({
        online: true,
        mode: 'LIVE',
        message: `Successfully connected to MikroTik RouterOS API at ${config.host}:${config.port}`
      });
    });

    socket.on('error', (err) => {
      resolve({
        online: false,
        mode: 'OFFLINE_FALLBACK',
        message: `Could not connect to MikroTik at ${config.host}:${config.port} (${err.message}). Using virtual fallback.`
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        online: false,
        mode: 'TIMEOUT',
        message: `Connection timed out connecting to MikroTik at ${config.host}:${config.port}.`
      });
    });

    socket.connect(config.port, config.host);
  });
}

/**
 * Generate a clean 6-digit Reconnection Voucher Code (e.g. JN-849201)
 */
function generateVoucherCode() {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `JN-${randomNum}`;
}

/**
 * Activate Wi-Fi Hotspot Session for a customer
 */
async function activateHotspotUser({ phone, macAddress, packageItem, durationHours }) {
  const config = await getMikroTikConfig();
  const username = `jay_${phone.slice(-6)}_${Math.floor(1000 + Math.random() * 9000)}`;
  const password = Math.floor(100000 + Math.random() * 900000).toString();
  const voucherCode = generateVoucherCode();

  const now = new Date();
  const endTime = new Date(now.getTime() + durationHours * 3600 * 1000);

  // Store in Database
  await db.run(
    `INSERT OR REPLACE INTO sessions (username, phone, mac_address, package_name, voucher_code, start_time, end_time, status)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'ACTIVE')`,
    [username, phone, macAddress || '00:00:00:00:00:00', packageItem.name, voucherCode, endTime.toISOString()]
  );

  console.log(`[JayNet Hotspot] Activated User: ${username} | Voucher Code: ${voucherCode} | Duration: ${durationHours} Hours`);

  return {
    success: true,
    username,
    password,
    voucherCode,
    rateLimit: `${packageItem.upload_speed}/${packageItem.download_speed}`,
    uptimeLimit: `${durationHours}h`,
    endTime: endTime.toISOString(),
    isSimulation: config.simulationMode
  };
}

/**
 * Reconnect an existing client using their Voucher Code or Phone Number
 */
async function reconnectSession({ codeOrPhone, newMacAddress }) {
  const input = codeOrPhone.trim().toUpperCase();

  // Search by voucher_code or phone number
  const session = await db.get(
    `SELECT * FROM sessions 
     WHERE (voucher_code = ? OR phone = ? OR username = ?) AND status = 'ACTIVE' 
     ORDER BY id DESC LIMIT 1`,
    [input, input, input]
  );

  if (!session) {
    throw new Error('No active subscription found for this Reconnection Code or Phone Number.');
  }

  const now = new Date();
  const endTime = new Date(session.end_time);

  if (now > endTime) {
    await db.run('UPDATE sessions SET status = "EXPIRED" WHERE id = ?', [session.id]);
    throw new Error('Your subscribed package duration has expired. Please choose a new package to reconnect.');
  }

  // Update MAC address if reconnecting from a new/reset device
  if (newMacAddress) {
    await db.run('UPDATE sessions SET mac_address = ? WHERE id = ?', [newMacAddress, session.id]);
  }

  const remainingMs = endTime.getTime() - now.getTime();
  const remainingHours = (remainingMs / (1000 * 3600)).toFixed(1);

  return {
    success: true,
    session,
    voucherCode: session.voucher_code,
    remainingHours,
    endTime: session.end_time,
    message: `Reconnected successfully! You have ${remainingHours} hours remaining on your ${session.package_name}.`
  };
}

/**
 * Extend active session duration
 */
async function extendSession(username, additionalHours) {
  const session = await db.get('SELECT * FROM sessions WHERE username = ?', [username]);
  if (!session) throw new Error('Session not found.');

  const currentEndTime = new Date(session.end_time);
  const newEndTime = new Date(currentEndTime.getTime() + additionalHours * 3600 * 1000);

  await db.run('UPDATE sessions SET end_time = ?, status = "ACTIVE" WHERE username = ?', [
    newEndTime.toISOString(),
    username
  ]);

  return { success: true, newEndTime: newEndTime.toISOString() };
}

/**
 * Terminate/Kick active user session
 */
async function kickSession(username) {
  await db.run('UPDATE sessions SET status = "EXPIRED" WHERE username = ?', [username]);
  return { success: true };
}

module.exports = {
  getMikroTikConfig,
  testConnection,
  generateVoucherCode,
  activateHotspotUser,
  reconnectSession,
  extendSession,
  kickSession
};
