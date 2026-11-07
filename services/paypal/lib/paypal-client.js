/* TaskFlow ADS — cliente REST PayPal (solo servidor).
   Nunca incluir este módulo ni sus credenciales en GitHub Pages. */
const ALLOWED_MODES = new Set(['sandbox', 'live']);
const TIMEOUT_MS = 12000;

export function paypalConfig() {
  const env = process.env;
  const mode = ALLOWED_MODES.has(env.PAYPAL_MODE) ? env.PAYPAL_MODE : 'sandbox';
  return {
    mode,
    baseUrl: mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    clientId: env.PAYPAL_CLIENT_ID || '',
    clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    merchantEmail: env.PAYPAL_MERCHANT_EMAIL || '',
    merchantId: env.PAYPAL_MERCHANT_ID || '',
    enabled: env.PAYPAL_PAYMENTS_ENABLED === 'true'
  };
}
export function paypalIsConfigured(config = paypalConfig()) {
  return !!(config.clientId && config.clientSecret && config.merchantEmail);
}
function timeoutSignal() {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return { signal: ctrl.signal, done: () => clearTimeout(id) };
}
export async function paypalAccessToken(config = paypalConfig()) {
  if (!paypalIsConfigured(config)) throw new Error('PAYPAL_NOT_CONFIGURED');
  const t = timeoutSignal();
  try {
    const basic = Buffer.from(config.clientId + ':' + config.clientSecret, 'utf8').toString('base64');
    const response = await fetch(config.baseUrl + '/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
      signal: t.signal
    });
    if (!response.ok) throw new Error('PAYPAL_AUTH_FAILED');
    const data = await response.json();
    if (!data.access_token || data.token_type?.toLowerCase() !== 'bearer') throw new Error('PAYPAL_INVALID_TOKEN');
    return data.access_token;
  } finally {
    t.done();
  }
}
export async function paypalApi(path, { method = 'GET', body, requestId } = {}, config = paypalConfig()) {
  if (!/^\/(?:v1|v2)\//.test(path) || path.includes('..')) throw new Error('PAYPAL_INVALID_PATH');
  const token = await paypalAccessToken(config);
  const t = timeoutSignal();
  try {
    const response = await fetch(config.baseUrl + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      signal: t.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // No exponer tokens ni detalles internos de la cuenta a los clientes.
      const error = new Error('PAYPAL_API_' + response.status);
      error.httpStatus = response.status;
      throw error;
    }
    return data;
  } finally {
    t.done();
  }
}
