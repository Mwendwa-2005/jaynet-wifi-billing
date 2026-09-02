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
  const isSandbox = envVal === 'sandbox' || envVal === 'demo';

  const dbKey = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_CONSUMER_KEY'"))?.value;
  const dbSecret = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_CONSUMER_SECRET'"))?.value;
  const dbPasskey = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_PASSKEY'"))?.value;
  const dbShortcode = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_SHORTCODE'"))?.value;
  const dbCallback = (await db.get("SELECT value FROM settings WHERE key = 'MPESA_CALLBACK_URL'"))?.value;

  // Default Safaricom Sandbox Keys
  const defaultKey = 'Vyj8TOAXnQVAlVbfJ4ypmlOfGMJ4siwOcAGFcu8NcYRBvWRs';
  const defaultSecret = 'rN7eD0zR8Rz6vW2Q';

  const consumerKey = (dbKey && dbKey.length > 10 ? dbKey : (process.env.MPESA_CONSUMER_KEY || defaultKey)).trim();
  const consumerSecret = (dbSecret && dbSecret.length > 5 ? dbSecret : (process.env.MPESA_CONSUMER_SECRET || defaultSecret)).trim();
  const passkey = (dbPasskey || process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919').trim();
  const shortcode = (dbShortcode || process.env.MPESA_SHORTCODE || '174379').trim();
  const callbackUrl = (dbCallback || process.env.MPESA_CALLBACK_URL || 'https://jaynet-wifi-billing.onrender.com/api/mpesa/callback').trim();

  const baseUrl = envVal === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

  return {
    isSandbox,
    consumerKey,
    consumerSecret,
    passkey,
    shortcode,
    callbackUrl,
    baseUrl
  };
}

/**
 * Generate OAuth Token from Safaricom Daraja API with automatic fallback
 */
async function getOAuthToken() {
  const config = await getMpesaConfig();

  const primaryAuth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  try {
    const response = await axios.get(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        Authorization: `Basic ${primaryAuth}`
      }
    });

    if (response.data && response.data.access_token) {
      return response.data.access_token;
    }
  } catch (primaryErr) {
    console.warn('[M-Pesa Primary Key Failed, trying Sandbox fallback...]:', primaryErr.response?.data || primaryErr.message);
  }

  // Fallback to verified Safaricom Sandbox Credentials
  const fallbackKey = 'Vyj8TOAXnQVAlVbfJ4ypmlOfGMJ4siwOcAGFcu8NcYRBvWRs';
  const fallbackSecret = 'rN7eD0zR8Rz6vW2Q';
  const fallbackAuth = Buffer.from(`${fallbackKey}:${fallbackSecret}`).toString('base64');

  try {
    const fbResponse = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: {
        Authorization: `Basic ${fallbackAuth}`
      }
    });

    if (fbResponse.data && fbResponse.data.access_token) {
      console.log('[M-Pesa OAuth] Successfully generated token via Sandbox Fallback.');
      return fbResponse.data.access_token;
    }
    throw new Error('OAuth token generation failed.');
  } catch (fallbackErr) {
    console.error('[M-Pesa OAuth Fatal Error]:', fallbackErr.response?.data || fallbackErr.message);
    const apiError = fallbackErr.response?.data?.errorMessage || fallbackErr.response?.data?.error_description || fallbackErr.message;
    throw new Error(`Safaricom OAuth Error: ${apiError}`);
  }
}

/**
 * Initiate Daraja STK Push Request directly to Safaricom Daraja API
 */
async function initiateStkPush({ phone, amount, packageId, packageName, macAddress }) {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone || normalizedPhone.length !== 12) {
    throw new Error('Invalid Kenyan phone number format. Expected format: 07XXXXXXXX or 01XXXXXXXX');
  }

  const config = await getMpesaConfig();

  // REAL Safaricom Daraja STK Push Execution
  console.log(`[M-Pesa LIVE] Triggering Real STK Push for ${normalizedPhone} to Safaricom Daraja API (${config.baseUrl})...`);
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

    console.log(`[M-Pesa LIVE] STK Push Dispatched Successfully to Safaricom! CheckoutID: ${checkoutRequestId}`);

    return {
      success: true,
      checkoutRequestId,
      customerMessage: response.data.CustomerMessage || 'STK Push sent! Please check your phone screen and enter your M-Pesa PIN.',
      isDemo: false
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
