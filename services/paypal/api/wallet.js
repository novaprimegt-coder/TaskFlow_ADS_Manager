/* Solo consulta del saldo real del usuario autenticado; sin escrituras desde el navegador. */
import { ready, preflight, respond, requester, walletOverview, errorResponse } from '../lib/wallet-service.js';
export default async function handler(req,res){
  if(preflight(req,res,'GET'))return;
  try{
    const uid=await requester(req);
    const wallet=await walletOverview(uid);
    return respond(res,200,{...wallet,checkoutAvailable:ready().enabled});
  }catch(e){
    const status=errorResponse(e);return respond(res,status.status,{error:status.error});
  }
}
