/* Estado mínimo del servicio legado. No publicar detalles internos del procesador. */
import { preflight, respond } from '../lib/wallet-service.js';

export default async function handler(req,res){
  if(preflight(req,res,'GET'))return;
  return respond(res,200,{checkoutAvailable:false});
}
