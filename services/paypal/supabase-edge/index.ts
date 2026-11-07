// TaskFlow ADS PayPal — gateway aislado, reutiliza TF_PAYPAL_* de Supabase.
// No altera la función taskflow-noads ni sus suscripciones.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const ORIGIN = "https://novaprimegt-coder.github.io";
const PROJECT = "taskflow-b0ece";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const MODE = Deno.env.get("TF_PAYPAL_MODE")==="live"?"live":"sandbox";
const CLIENT_ID = Deno.env.get("TF_PAYPAL_CLIENT_ID")||"";
const CLIENT_SECRET = Deno.env.get("TF_PAYPAL_CLIENT_SECRET")||"";
const API_BASE = MODE==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
const SANDBOX_EMAIL = Deno.env.get("TF_PAYPAL_ADS_SANDBOX_EMAIL")||"";
const MERCHANT_EMAIL = MODE==="live"?(Deno.env.get("TF_PAYPAL_ADS_LIVE_MERCHANT_EMAIL")||""):SANDBOX_EMAIL;
// No activar cobros live sin webhook Live e integración de reembolsos verificados.
const ENABLE_LIVE_CHECKOUT = false;
const ENABLE_CHECKOUT = !!CLIENT_ID && !!CLIENT_SECRET && !!MERCHANT_EMAIL && (MODE==="sandbox" || ENABLE_LIVE_CHECKOUT);
const WEBHOOK_ID = MODE==="sandbox"?"1J021638PV172915X":"";
const RETURN_URL = ORIGIN+"/TaskFlow_ADS_Manager/";
const CURRENCY = "USD";
const baseHeaders = {"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
let cachedToken = null,tokenUntil = 0;

function reply(req,status,data){
 const headers=new Headers(baseHeaders);
 if(req.headers.get("Origin")===ORIGIN)headers.set("Access-Control-Allow-Origin",ORIGIN);
 headers.set("Vary","Origin");
 if(status===204)return new Response(null,{status,headers});
 return new Response(JSON.stringify(data),{status,headers});
}
function err(message,status=503){const e=new Error(message);e.status=status;return e}
function db(){
 let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!key){
  try{const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");key=keys.service_role||keys.default||Object.values(keys).find(v=>typeof v==="string")||""}catch{}
 }
 if(!key)throw err("DATABASE_NOT_READY",503);
 return createClient(Deno.env.get("SUPABASE_URL")||"",key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function authUser(req){
 const token=(req.headers.get("Authorization")||"").match(/^Bearer ([^\s]+)$/i)?.[1];
 if(!token)throw err("AUTH_REQUIRED",401);
 let payload;
 try{
  ({payload}=await jwtVerify(token,JWKS,{issuer:"https://securetoken.google.com/"+PROJECT,audience:PROJECT,algorithms:["RS256"]}));
 }catch{throw err("AUTH_INVALID",401)}
 if(typeof payload.sub!=="string"||!/^[a-zA-Z0-9_-]{3,128}$/.test(payload.sub)||
    typeof payload.auth_time!=="number"||payload.auth_time>Math.floor(Date.now()/1000))throw err("AUTH_INVALID",401);
 return payload.sub;
}
async function parse(req){let raw;try{raw=await req.text()}catch{throw err("INVALID_BODY",400)}
 if(raw.length>12000)throw err("BODY_TOO_LARGE",413);
 try{return JSON.parse(raw)}catch{throw err("INVALID_BODY",400)}
}
function cents(s){
 if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(String(s||"")))return null;
 const [whole,f=""]=String(s).split(".");
 const n=Number(whole)*100+Number(f.padEnd(2,"0"));
 return Number.isSafeInteger(n)&&n>=1&&n<=1000000?n:null;
}
function usd(c){return (Number(c||0)/100).toFixed(2)}
async function accessToken(){
 if(!CLIENT_ID||!CLIENT_SECRET)throw err("PAYPAL_CREDENTIALS_UNAVAILABLE",503);
 if(cachedToken&&Date.now()<tokenUntil)return cachedToken;
 const ctrl=new AbortController(),to=setTimeout(()=>ctrl.abort(),12000);
 try{
  const auth=btoa(CLIENT_ID+":"+CLIENT_SECRET);
  const r=await fetch(API_BASE+"/v1/oauth2/token",{
   method:"POST",headers:{"Authorization":"Basic "+auth,"Content-Type":"application/x-www-form-urlencoded"},
   body:"grant_type=client_credentials",signal:ctrl.signal
  });
  if(!r.ok)throw err("PAYPAL_AUTH_FAILED",503);
  const info=await r.json();
  if(!info.access_token||String(info.token_type).toLowerCase()!=="bearer")throw err("PAYPAL_AUTH_FAILED",503);
  cachedToken=info.access_token;
  tokenUntil=Date.now()+Math.max(0,Number(info.expires_in||60)-90)*1000;
  return cachedToken;
 }finally{clearTimeout(to)}
}
async function paypal(path,method="GET",body,requestId){
 if(!/^\/v[12]\//.test(path)||path.includes(".."))throw err("INVALID_API_PATH",400);
 const ctrl=new AbortController(),to=setTimeout(()=>ctrl.abort(),14000);
 try{
  const token=await accessToken();
  const headers={"Authorization":"Bearer "+token,"Content-Type":"application/json","Accept":"application/json"};
  if(requestId)headers["PayPal-Request-Id"]=requestId;
  const r=await fetch(API_BASE+path,{method,headers,signal:ctrl.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw err("PAYPAL_UPSTREAM_"+r.status,502);
  return data;
 }finally{clearTimeout(to)}
}
function approvalUrl(data){
 const url=data.links?.find(x=>x.rel==="payer-action"||x.rel==="approve")?.href||"";
 let u;
 try{u=new URL(url)}catch{throw err("PAYPAL_APPROVAL_URL_INVALID",502)}
 if(u.protocol!=="https:"||!["www.paypal.com","www.sandbox.paypal.com","paypal.com","sandbox.paypal.com"].includes(u.hostname))
  throw err("PAYPAL_APPROVAL_URL_INVALID",502);
 return u.toString();
}
async function wallet(uid){
 const client=db();
 const [balance,events]=await Promise.all([
  client.from("taskflow_ads_balances").select("available_cents,total_topups_cents").eq("uid",uid).maybeSingle(),
  client.from("taskflow_ads_payment_ledger").select("entry_id,kind,amount_cents,created_at").eq("uid",uid).order("created_at",{ascending:false}).limit(12)
 ]);
 if(balance.error||events.error)throw err("WALLET_READ_FAILED",503);
 return {
  currency:CURRENCY,
  balance:usd(balance.data?.available_cents),
  totalTopUps:usd(balance.data?.total_topups_cents),
  checkoutAvailable:ENABLE_CHECKOUT,
  transactions:(events.data||[]).map(x=>({id:x.entry_id,kind:x.kind,amount:usd(x.amount_cents),createdAt:x.created_at}))
 };
}
async function create(uid,amount){
 if(!ENABLE_CHECKOUT)throw err("PAYMENTS_DISABLED",503);
 const n=cents(amount);
 if(n===null)throw err("INVALID_AMOUNT",400);
 const ticket=crypto.randomUUID(),value=usd(n);
 const order=await paypal("/v2/checkout/orders","POST",{
  intent:"CAPTURE",
  purchase_units:[{reference_id:ticket,custom_id:ticket,description:"TaskFlow ADS — saldo publicitario",amount:{currency_code:CURRENCY,value}}],
  payment_source:{paypal:{experience_context:{return_url:RETURN_URL+"?tfads_payment=return",cancel_url:RETURN_URL+"?tfads_payment=cancel",shipping_preference:"NO_SHIPPING",user_action:"PAY_NOW"}}}
 },ticket);
 if(!/^[a-zA-Z0-9]{10,40}$/.test(String(order.id||"")))throw err("PAYPAL_ORDER_INVALID",502);
 const link=approvalUrl(order);
 const {error}=await db().from("taskflow_ads_orders").insert({
  order_id:order.id,uid,ticket,amount_cents:n,currency:CURRENCY,mode:MODE,status:"CREATED"
 });
 if(error)throw err("ORDER_STORAGE_FAILED",503);
 return {orderId:order.id,approveUrl:link,amount:value,currency:CURRENCY};
}
async function verifyAndCredit(orderId,expectedUid){
 if(!/^[a-zA-Z0-9]{10,40}$/.test(orderId))throw err("INVALID_ORDER_ID",400);
 const client=db();
 const {data:record,error}=await client.from("taskflow_ads_orders").select("*").eq("order_id",orderId).maybeSingle();
 if(error||!record||record.mode!==MODE||expectedUid&&expectedUid!==record.uid)throw err("ORDER_NOT_FOUND",404);
 if(record.status==="CREDITED")return {credited:true,orderId,wallet:await wallet(record.uid)};
 let order=await paypal("/v2/checkout/orders/"+orderId);
 if(order.status==="APPROVED"){
  try{await paypal("/v2/checkout/orders/"+orderId+"/capture","POST",{},"capture-"+orderId)}
  catch(e){console.warn("PayPal capture requires reconciliation",e?.message)}
  order=await paypal("/v2/checkout/orders/"+orderId);
 }
 if(order.status!=="COMPLETED")throw err("PAYMENT_NOT_COMPLETED",409);
 if(!Array.isArray(order.purchase_units)||order.purchase_units.length!==1)throw err("PAYPAL_ORDER_MISMATCH",409);
 const unit=order.purchase_units[0];
 if(unit.custom_id!==record.ticket||unit.reference_id!==record.ticket)throw err("PAYPAL_ORDER_MISMATCH",409);
 const capture=unit.payments?.captures||[];
 if(capture.length!==1||capture[0].status!=="COMPLETED")throw err("PAYPAL_CAPTURE_INCOMPLETE",409);
 const verified=capture[0],received=cents(verified.amount?.value);
 if(!/^[A-Za-z0-9-]{8,100}$/.test(String(verified.id||""))||received!==Number(record.amount_cents)||verified.amount?.currency_code!==CURRENCY)
  throw err("PAYPAL_AMOUNT_MISMATCH",409);
 if(!MERCHANT_EMAIL||String(unit.payee?.email_address||"").trim().toLowerCase()!==MERCHANT_EMAIL.trim().toLowerCase())
  throw err("PAYPAL_RECEIVER_MISMATCH",409);
 const {error:creditError}=await client.rpc("taskflow_ads_credit_capture",{
  p_uid:record.uid,p_order_id:orderId,p_capture_id:verified.id,p_amount_cents:received
 });
 if(creditError)throw err("CREDIT_RECONCILIATION_REQUIRED",503);
 return {credited:true,orderId,wallet:await wallet(record.uid)};
}
async function webhook(req){
 if(!ENABLE_CHECKOUT||!WEBHOOK_ID)throw err("WEBHOOK_NOT_CONFIGURED",503);
 const event=await parse(req);
 if(!event?.id)throw err("INVALID_WEBHOOK",400);
 const signature={
  auth_algo:req.headers.get("paypal-auth-algo"),
  cert_url:req.headers.get("paypal-cert-url"),
  transmission_id:req.headers.get("paypal-transmission-id"),
  transmission_sig:req.headers.get("paypal-transmission-sig"),
  transmission_time:req.headers.get("paypal-transmission-time"),
  webhook_id:WEBHOOK_ID,webhook_event:event
 };
 if(Object.values(signature).some(x=>!x))throw err("INVALID_SIGNATURE",401);
 const verify=await paypal("/v1/notifications/verify-webhook-signature","POST",signature);
 if(verify.verification_status!=="SUCCESS")throw err("INVALID_SIGNATURE",401);
 const resource=event.resource||{},type=String(event.event_type||"");
 if(type==="PAYMENT.CAPTURE.COMPLETED"){
  const orderId=String(resource.supplementary_data?.related_ids?.order_id||"");
  if(orderId)try{await verifyAndCredit(orderId)}catch(e){if(e.message!=="ORDER_NOT_FOUND")throw e}
 }
 if(type==="PAYMENT.CAPTURE.REFUNDED"||type==="PAYMENT.CAPTURE.REVERSED"){
  const captureId=String(resource.supplementary_data?.related_ids?.capture_id||resource.capture_id||(type.endsWith("REVERSED")?resource.id:""));
  const refundId=type.endsWith("REVERSED")?"reversal-"+event.id:String(resource.id||"");
  const amount=cents(resource.amount?.value);
  if(!captureId||!refundId||amount===null||resource.amount?.currency_code!=="USD")throw err("REFUND_RECONCILIATION_REQUIRED",503);
  const {error}=await db().rpc("taskflow_ads_apply_refund",{
   p_refund_id:refundId,p_capture_id:captureId,p_amount_cents:amount,
   p_kind:type.endsWith("REVERSED")?"reversal":"refund"
  });
  if(error)throw err("REFUND_RECONCILIATION_REQUIRED",503);
 }
 return {verified:true};
}
Deno.serve(async req=>{
 const origin=req.headers.get("Origin");
 if(origin&&origin!==ORIGIN)return reply(req,403,{error:"ORIGIN_NOT_ALLOWED"});
 const url=new URL(req.url);
 const path=url.pathname.match(/\/taskflow-ads-paypal(\/.*)?$/)?.[1]||"/";
 if(req.method==="OPTIONS"){
  const h=new Headers(baseHeaders);
  if(origin===ORIGIN)h.set("Access-Control-Allow-Origin",ORIGIN);
  h.set("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers","Authorization,Content-Type");
  return new Response(null,{status:204,headers:h});
 }
 try{
  if(req.method==="POST"&&path==="/webhook")return reply(req,200,await webhook(req));
  const uid=await authUser(req);
  // No exponer públicamente entorno, configuración de claves ni arquitectura.
  if(req.method==="GET"&&path==="/status")
   return reply(req,200,{checkoutAvailable:ENABLE_CHECKOUT});
  if(req.method==="GET"&&path==="/wallet")return reply(req,200,await wallet(uid));
  if(req.method==="POST"&&path==="/orders")return reply(req,201,await create(uid,(await parse(req)).amount));
  if(req.method==="POST"&&path==="/capture")return reply(req,200,await verifyAndCredit(String((await parse(req)).orderId||""),uid));
  return reply(req,404,{error:"NOT_FOUND"});
 }catch(e){
  const code=String(e?.message||"PAYMENT_SERVICE_UNAVAILABLE");
  console.error("TaskFlow ADS PayPal:",code);
  return reply(req,e?.status||503,{error:/^(AUTH_|INVALID_|ORDER_NOT_FOUND|PAYMENTS_DISABLED|PAYMENT_NOT_COMPLETED)/.test(code)?code:"PAYMENT_SERVICE_UNAVAILABLE"});
 }
});
