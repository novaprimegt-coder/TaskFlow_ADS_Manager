/* PayPal Business: estado de conexión del nuevo saldo publicitario. */
import { ready, preflight, respond, CURRENCY } from '../lib/wallet-service.js';
export default async function handler(req,res){
  if(preflight(req,res,'GET'))return;
  const state=ready();
  return respond(res,200,{
    provider:'PayPal',
    mode:state.mode,
    currency:CURRENCY,
    configured:state.credentialsConfigured,
    checkoutAvailable:state.enabled,
    walletModel:'prepaid',
    accountType:'advertiser',
    note:state.enabled?'Recargas disponibles. Se acreditan únicamente después de captura y verificación en servidor.':
      'La conexión de cobro no está activada; faltan credenciales privadas o habilitación de PayPal y Firebase.'
  });
}
