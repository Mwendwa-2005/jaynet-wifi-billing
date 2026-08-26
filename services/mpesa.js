const axios = require('axios');
const db = require('../db');

/**
 * Helper to normalize Kenyan phone numbers into format 2547XXXXXXXX or 2541XXXXXXXX
 */
function normalizePhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = phone.toString().replace(/[\s+\-]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}

/**
 * Get Daraja API Base URL depending on environment setting
 */
async function getMpesaConfig() {
  const envSetting = await db.get("SELECT value FROM settings WHERE key = 'MPESA_ENVIRONMENT'");
  const envVal = (envSetting?.value || process.env.MPESA_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  const isSandbox = envVal === 'sandbox';

  const rawKey = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_CONSUMER_KEY'"))?.value || process.env.MPESA_CONSUMER_KEY || '';
  const rawSecret = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_CONSUMER_SECRET'"))?.value || process.env.MPESA_CONSUMER_SECRET || '';
  const rawPasskey = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_PASSKEY'"))?.value || process.env.MPESA_PASSKEY || '';
  const rawShortcode = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_SHORTCODE'"))?.value || process.env.MPESA_SHORTCODE || '';
  const rawCallbackUrl = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_CALLBACK_URL'"))?.value || process.env.MPESA_CALLBACK_URL || '';

  const consumerKey = rawKey.trim();
  const consumerSecret = rawSecret.trim();
  const passkey = rawPasskey.trim() || (isSandbox ? 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919' : '');
  const shortcode = rawShortcode.trim() || (isSandbox ? '174379' : '');
  const callbackUrl = rawCallbackUrl.trim();

  const simSetting = await db.get("SELECT value FROM settings WHERE key = 'MPESA_FORCE_SIMULATION'");
  const forceSimulation = simSetting ? simSetting.value === 'true' : false;

  const baseUrl = isSandbox
    ? 'https://sandbox.safaricom.co.ke'
    : 'https://api.safaricom.co.ke';

  return {
    isSandbox,
    consumerKey,
    consumerSecret,
    passkey,
    shortcode,
    callbackUrl,
    forceSimulation,
    baseUrl
  };
}

/**
 * Generate OAuth Token from Safaricom Daraja API
 */
async function getOAuthToken() {
  const config = await getMpesaConfig();
  if (!config.consumerKey || !config.consumerSecret || config.consumerKey === 'YOUR_DARJA_CONSUMER_KEY') {
    throw new Error('Safaricom Daraja credentials not configured. Please enter your Consumer Key & Secret in Admin Panel Settings.');
  }

  const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  try {
    const response = await axios.get(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        Authorization: `Basic ${auth}`
      }
    });

    if (!response.data || !response.data.access_token) {
      throw new Error('No access_token returned by Safaricom OAuth API.');
    }
    return response.data.access_token;
  } catch (error) {
    console.error('[M-Pesa OAuth Error]:', error.response?.data || error.message);
    const apiError = error.response?.data?.errorMessage || error.response?.data?.error_description || error.message;
    
    if (apiError.includes('Invalid') || error.response?.status === 400 || error.response?.status === 401) {
      throw new Error(`Invalid Daraja Credentials or Environment Mismatch (${config.isSandbox ? 'Sandbox' : 'Production'} mode). Ensure your Consumer Key & Secret match the selected environment in Admin Settings.`);
    }
    throw new Error(`Safaricom OAuth Error: ${apiError}`);
  }
}

/**
 * Initiate Daraja STK Push Request
 */
async function initiateStkPush({ phone, amount, packageId, packageName, macAddress }) {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone || normalizedPhone.length !== 12) {
    throw new Error('Invalid Kenyan phone number format. Expected format: 07XXXXXXXX or 01XXXXXXXX');
  }

  const config = await getMpesaConfig();

  const hasCredentials = config.consumerKey && 
                         config.consumerSecret && 
                         config.consumerKey !== 'YOUR_DARJA_CONSUMER_KEY' &&
                         !config.forceSimulation;

  if (!hasCredentials) {
    console.log('[M-Pesa] Credentials missing or simulation forced. Running STK Push in Simulation Mode.');
    const mockCheckoutId = 'ws_CO_SIM_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

    await db.run(
      `INSERT INTO transactions (phone, amount, package_id, package_name, checkout_request_id, mac_address, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [normalizedPhone, amount, packageId, packageName, mockCheckoutId, macAddress]
    );

    return {
      success: true,
      checkoutRequestId: mockCheckoutId,
      customerMessage: 'STK Push sent in Simulation Mode. (Configure real Daraja keys in Admin Settings for live handset prompts).',
      isSimulation: true
    };
  }

  // REAL Safaricom Daraja STK Push Execution
  console.log(`[M-Pesa LIVE] Triggering STK Push for ${normalizedPhone} to Safaricom Daraja API (${config.baseUrl})...`);
  const token = await getOAuthToken();
  const date = new Date();
  const timestamp =
    date.getFullYear().toString() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0') +
    String(date.getHours()).padStart(2, '0') +
    String(date.getMinutes()).padStart(2, '0') +
    String(date.getSeconds()).padStart(2, '0');

  const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');

  const payload = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(amount),
    PartyA: normalizedPhone,
    PartyB: config.shortcode,
    PhoneNumber: normalizedPhone,
    CallBackURL: config.callbackUrl || 'https://jaynet-wifi-billing.onrender.com/api/mpesa/callback',
    AccountReference: `JayNet-${packageName.replace(/\s+/g, '')}`,
    TransactionDesc: `JayNet Wi-Fi Package: ${packageName}`
  };

  try {
    const response = await axios.post(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const checkoutRequestId = response.data.CheckoutRequestID;

    await db.run(
      `INSERT INTO transactions (phone, amount, package_id, package_name, checkout_request_id, mac_address, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [normalizedPhone, amount, packageId, packageName, checkoutRequestId, macAddress]
    );

    console.log(`[M-Pesa LIVE] STK Push Dispatched Successfully! CheckoutID: ${checkoutRequestId}`);

    return {
      success: true,
      checkoutRequestId,
      customerMessage: response.data.CustomerMessage || 'STK Push sent! Please check your phone and enter your M-Pesa PIN.',
      isSimulation: false
    };
  } catch (error) {
    console.error('[M-Pesa STK Push Live Error]:', error.response?.data || error.message);
    const errMsg = error.response?.data?.errorMessage || error.response?.data?.ResponseDescription || error.message;
    throw new Error(`Safaricom Daraja Error: ${errMsg}`);
  }
}

/**
 * Handle Daraja Callback HTTP POST payload
 */
async function processCallback(callbackData) {
  try {
    const stkCallback = callbackData.Body?.stkCallback;
    if (!stkCallback) return { success: false, message: 'Invalid callback structure' };

    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;

    if (resultCode === 0) {
      // Payment Successful
      let mpesaReceipt = '';
      const metaItems = stkCallback.CallbackMetadata?.Item || [];
      for (const item of metaItems) {
        if (item.Name === 'MpesaReceiptNumber') mpesaReceipt = item.Value;
      }

      await db.run(
        `UPDATE transactions 
         SET status = 'COMPLETED', mpesa_receipt_number = ?, result_desc = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE checkout_request_id = ?`,
        [mpesaReceipt, resultDesc, checkoutRequestId]
      );

      const txn = await db.get('SELECT * FROM transactions WHERE checkout_request_id = ?', [checkoutRequestId]);
      return { success: true, status: 'COMPLETED', transaction: txn };
    } else {
      // Payment Failed / Cancelled
      await db.run(
        `UPDATE transactions 
         SET status = 'FAILED', result_desc = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE checkout_request_id = ?`,
        [resultDesc, checkoutRequestId]
      );

      return { success: false, status: 'FAILED', resultDesc };
    }
  } catch (err) {
    console.error('[M-Pesa Callback Processing Error]:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  normalizePhoneNumber,
  getMpesaConfig,
  getOAuthToken,
  initiateStkPush,
  processCallback
};
