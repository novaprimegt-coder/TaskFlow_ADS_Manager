/* Cada recarga requiere un consentimiento individual en PayPal. */
import { parseCents, preflight, respond, requester, ready, createTopup, errorResponse, MIN_CENTS, MAX_CENTS } from '../lib/wallet-service.js';
export default async function handler(req,res){
  if(preflight(req,res,'POST'))return;
  if(!ready().enabled)return respond(res,503,{error:'PAYMENTS_DISABLED'});
  const cents=parseCents(req.body?.amount);
  if(cents===null)return respond(res,400,{error:'INVALID_AMOUNT',min:(MIN_CENTS/100).toFixed(2),max:(MAX_CENTS/100).toFixed(2),currency:'USD'});
  try{
    const uid=await requester(req);
    return respond(res,201,await createTopup(uid,cents));
  }catch(e){
    console.error('ADS PayPal create:',String(e.message||e));
    const status=errorResponse(e);return respond(res,status.status,{error:status.error});
  }
}
