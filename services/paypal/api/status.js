/* Estado del preparativo PayPal. No crea órdenes ni procesa dinero. */
import { paypalConfig, paypalIsConfigured } from '../lib/paypal-client.js';

const ORIGIN = 'https://novaprimegt-coder.github.io';
function send(res, code, body) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  if (code === 204) return res.status(code).end();
  return res.status(code).json(body);
}
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204);
  if (req.method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  const config = paypalConfig();
  return send(res, 200, {
    provider: 'PayPal',
    stage: 'preparation',
    mode: config.mode,
    credentialsConfigured: paypalIsConfigured(config),
    paymentsEnabled: false,
    checkoutAvailable: false,
    message: 'La integración no procesa cobros hasta confirmar precios, moneda, credenciales, validación de pago y conciliación.'
  });
}
