/* La URL del navegador no acredita dinero; confirmación exclusiva del backend. */
import { preflight, respond, requester, captureTopup, errorResponse } from '../lib/wallet-service.js';
export default async function handler(req,res){
  if(preflight(req,res,'POST'))return;
  try{
    const uid=await requester(req);
    const orderId=String(req.body?.orderId||'').trim();
    return respond(res,200,await captureTopup(uid,orderId));
  }catch(e){
    console.error('ADS PayPal capture:',String(e.message||e));
    const status=errorResponse(e);return respond(res,status.status,{error:status.error});
  }
}
