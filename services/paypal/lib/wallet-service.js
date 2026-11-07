/* TaskFlow ADS — cartera publicitaria. Solo ejecutable en servidor.
   Los importes se guardan como CENTAVOS USD y no se pueden escribir desde el cliente. */
import { randomUUID } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { paypalApi, paypalConfig, paypalIsConfigured } from './paypal-client.js';

export const PUBLIC_ORIGIN = 'https://novaprimegt-coder.github.io';
export const RETURN_URL = PUBLIC_ORIGIN + '/TaskFlow_ADS_Manager/';
export const CURRENCY = 'USD';
export const MIN_CENTS = 1;
export const MAX_CENTS = 1000000; // Protección operativa: USD 10,000 por recarga.

const uidRegex = /^[a-zA-Z0-9_-]{3,128}$/;
const orderRegex = /^[a-zA-Z0-9]{10,40}$/;
const refundRegex = /^[a-zA-Z0-9-]{8,100}$/;

export function respond(res, status, data) {
  res.setHeader('Access-Control-Allow-Origin', PUBLIC_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');
  res.setHeader('Cache-Control','no-store, private, max-age=0');
  res.setHeader('Vary','Origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (status===204) return res.status(status).end();
  return res.status(status).json(data);
}
export function preflight(req,res,method) {
  if(req.method==='OPTIONS') { respond(res,204); return true; }
  if(req.headers.origin && req.headers.origin!==PUBLIC_ORIGIN) { respond(res,403,{error:'ORIGIN_NOT_ALLOWED'}); return true; }
  if(req.method!==method) { respond(res,405,{error:'METHOD_NOT_ALLOWED'}); return true; }
  if(method==='POST' && req.headers.origin!==PUBLIC_ORIGIN) { respond(res,403,{error:'ORIGIN_REQUIRED'}); return true; }
  return false;
}
export function parseCents(value){
  const str=String(value??'').trim();
  if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(str))return null;
  const [whole,frac='']=str.split('.');
  const cents=Number(whole)*100+Number(frac.padEnd(2,'0'));
  return Number.isSafeInteger(cents)&&cents>=MIN_CENTS&&cents<=MAX_CENTS?cents:null;
}
export function asUSD(cents){
  if(!Number.isSafeInteger(cents))throw new Error('BAD_CENTS');
  return (cents/100).toFixed(2);
}
function firebaseApp(){
  if(getApps().length) return getApps()[0];
  const json=process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'';
  if(!json) throw new Error('FIREBASE_NOT_CONFIGURED');
  let sa;try{sa=JSON.parse(json)}catch{throw new Error('FIREBASE_CONFIG_INVALID')}
  if(sa.project_id!=='taskflow-b0ece'||!sa.private_key||!sa.client_email)throw new Error('FIREBASE_CONFIG_INVALID');
  return initializeApp({credential:cert(sa),projectId:'taskflow-b0ece'});
}
export function db(){return getFirestore(firebaseApp())}
export async function requester(req){
  const h=String(req.headers.authorization||'');
  if(!h.startsWith('Bearer '))throw new Error('AUTH_REQUIRED');
  let decoded;
  try{decoded=await getAuth(firebaseApp()).verifyIdToken(h.slice(7),true)}
  catch{throw new Error('AUTH_INVALID')}
  if(!uidRegex.test(decoded.uid))throw new Error('AUTH_INVALID');
  return decoded.uid;
}
export function ready(){
  const config=paypalConfig();
  const firestoreOK=!!process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return {
    mode:config.mode,
    credentialsConfigured:paypalIsConfigured(config)&&firestoreOK,
    enabled:!!config.enabled&&paypalIsConfigured(config)&&firestoreOK,
    currency:CURRENCY
  };
}
export function walletDoc(uid){return db().doc('users/'+uid+'/adsWallet/main')}
export function ordersDoc(orderId){
  if(!orderRegex.test(String(orderId||'')))throw new Error('INVALID_ORDER_ID');
  return db().collection('adsPaymentOrders').doc(orderId);
}
export function balanceSnapshot(info){
  const data=info||{};
  const cents=Number(data.availableCents??0);
  const total=Number(data.totalTopUpCents??0);
  return {currency:CURRENCY,balance:asUSD(Number.isSafeInteger(cents)?cents:0),totalTopUps:asUSD(Number.isSafeInteger(total)?total:0),spentTracked:false};
}
export async function walletOverview(uid){
  const w=await walletDoc(uid).get();
  const events=await db().collection('users').doc(uid).collection('adsPaymentLedger').orderBy('createdAt','desc').limit(12).get();
  return {...balanceSnapshot(w.data()),transactions:events.docs.map(x=>{
    const d=x.data();
    return {id:x.id,kind:d.kind||'topup',amount:asUSD(Number(d.amountCents||0)),status:d.status||'COMPLETED',createdAt:d.createdAt?.toDate?.()?.toISOString?.()||null};
  })};
}
export async function ensureBusiness(uid){
  const account=await db().doc('users/'+uid+'/adsManager/business').get();
  if(!account.exists)throw new Error('ACCOUNT_NOT_FOUND');
  const d=account.data()||{};
  if(d.ownerUid!==uid||d.accountStatus!=='active')throw new Error('ACCOUNT_NOT_ACTIVE');
}
export function safeApprovalLink(order){
  const link=(order.links||[]).find(x=>['approve','payer-action'].includes(x.rel));
  if(!link||!link.href)throw new Error('PAYPAL_APPROVAL_URL_MISSING');
  let u;try{u=new URL(link.href)}catch{throw new Error('PAYPAL_APPROVAL_URL_INVALID')}
  if(u.protocol!=='https:'||!['www.paypal.com','www.sandbox.paypal.com','paypal.com','sandbox.paypal.com'].includes(u.hostname))throw new Error('PAYPAL_APPROVAL_URL_INVALID');
  return u.toString();
}
export async function createTopup(uid,cents){
  await ensureBusiness(uid);
  const config=paypalConfig();
  if(!ready().enabled)throw new Error('PAYMENTS_DISABLED');
  const ticket=randomUUID();
  const total=asUSD(cents);
  const data={
    intent:'CAPTURE',
    purchase_units:[{reference_id:ticket,custom_id:ticket,description:'TaskFlow ADS — recarga de saldo publicitario',amount:{currency_code:CURRENCY,value:total}}],
    payment_source:{paypal:{experience_context:{
      return_url:RETURN_URL+'?tfads_payment=return',
      cancel_url:RETURN_URL+'?tfads_payment=cancel',
      user_action:'PAY_NOW',
      shipping_preference:'NO_SHIPPING'
    }}}
  };
  const order=await paypalApi('/v2/checkout/orders',{method:'POST',body:data,requestId:ticket},config);
  if(!orderRegex.test(String(order.id||'')))throw new Error('PAYPAL_INVALID_ORDER');
  const approval=safeApprovalLink(order);
  await ordersDoc(order.id).create({
    uid,
    amountCents:cents,
    currency:CURRENCY,
    mode:config.mode,
    ticket,
    status:'CREATED',
    createdAt:FieldValue.serverTimestamp()
  });
  return {orderId:order.id,approveUrl:approval,currency:CURRENCY,amount:total};
}
export function verifiedCapture(order,record,config){
  if(order?.id!==record.id||order?.status!=='COMPLETED')throw new Error('PAYMENT_NOT_COMPLETED');
  if(!Array.isArray(order.purchase_units)||order.purchase_units.length!==1)throw new Error('PAYPAL_ORDER_MISMATCH');
  const unit=order.purchase_units[0];
  if(unit.custom_id!==record.ticket||unit.reference_id!==record.ticket)throw new Error('PAYPAL_ORDER_MISMATCH');
  const captures=unit.payments?.captures||[];
  if(captures.length!==1)throw new Error('PAYPAL_CAPTURE_MISMATCH');
  const capture=captures[0];
  if(!refundRegex.test(String(capture.id||''))||capture.status!=='COMPLETED')throw new Error('PAYPAL_CAPTURE_INCOMPLETE');
  const amount=parseCents(capture.amount?.value);
  if(amount!==record.amountCents||capture.amount?.currency_code!==CURRENCY)throw new Error('PAYPAL_AMOUNT_MISMATCH');
  const byEmail=String(unit.payee?.email_address||'').trim().toLowerCase()===config.merchantEmail.trim().toLowerCase();
  const byMerchant=!!config.merchantId&&String(unit.payee?.merchant_id||'')===config.merchantId;
  if(!byEmail&&!byMerchant)throw new Error('PAYPAL_MERCHANT_UNVERIFIED');
  return {captureId:capture.id,amountCents:amount};
}
export async function creditCompletedOrder(orderId){
  const config=paypalConfig();
  const ref=ordersDoc(orderId);
  const snap=await ref.get();
  if(!snap.exists)throw new Error('ORDER_NOT_FOUND');
  const record={...snap.data(),id:orderId};
  if(config.mode!==record.mode)throw new Error('PAYPAL_MODE_MISMATCH');
  // Solo PayPal confirma el resultado; nunca se acredita basándose en URL de retorno.
  const order=await paypalApi('/v2/checkout/orders/'+orderId,{},config);
  const verified=verifiedCapture(order,record,config);
  const captureRef=db().collection('adsPaymentCaptures').doc(verified.captureId);
  const walletRef=walletDoc(record.uid);
  const ledgerRef=db().collection('users').doc(record.uid).collection('adsPaymentLedger').doc(orderId);
  await db().runTransaction(async tx=>{
    const [orderSnap,captureSnap,ledgerSnap]=await Promise.all([tx.get(ref),tx.get(captureRef),tx.get(ledgerRef)]);
    if(!orderSnap.exists||orderSnap.data().uid!==record.uid)throw new Error('ORDER_CHANGED');
    if(orderSnap.data().status==='CREDITED'){
      if(!captureSnap.exists||captureSnap.data().orderId!==orderId)throw new Error('RECONCILIATION_REQUIRED');
      return;
    }
    if(captureSnap.exists||ledgerSnap.exists)throw new Error('DUPLICATE_CAPTURE');
    tx.create(captureRef,{orderId,uid:record.uid,amountCents:verified.amountCents,createdAt:FieldValue.serverTimestamp()});
    tx.create(ledgerRef,{kind:'topup',status:'COMPLETED',currency:CURRENCY,amountCents:verified.amountCents,captureId:verified.captureId,createdAt:FieldValue.serverTimestamp()});
    tx.set(walletRef,{currency:CURRENCY,availableCents:FieldValue.increment(verified.amountCents),totalTopUpCents:FieldValue.increment(verified.amountCents),updatedAt:FieldValue.serverTimestamp()},{merge:true});
    tx.update(ref,{status:'CREDITED',captureId:verified.captureId,creditedAt:FieldValue.serverTimestamp()});
  });
  return {orderId,currency:CURRENCY,amount:asUSD(verified.amountCents),wallet:await walletOverview(record.uid),uid:record.uid};
}
export async function captureTopup(uid,orderId){
  const snap=await ordersDoc(orderId).get();
  if(!snap.exists||snap.data().uid!==uid)throw new Error('ORDER_NOT_FOUND');
  const config=paypalConfig();
  if(!ready().enabled)throw new Error('PAYMENTS_DISABLED');
  if(snap.data().mode!==config.mode)throw new Error('PAYPAL_MODE_MISMATCH');
  if(snap.data().status==='CREDITED'){
    return {credited:true,orderId,wallet:await walletOverview(uid)};
  }
  let order=await paypalApi('/v2/checkout/orders/'+orderId,{},config);
  if(order.status==='APPROVED'){
    try{
      await paypalApi('/v2/checkout/orders/'+orderId+'/capture',{method:'POST',body:{},requestId:'capture-'+orderId.slice(0,30)},config);
    }catch(e){
      // PayPal puede haber capturado aunque se perdiera la respuesta; consultar de nuevo.
      console.warn('TaskFlow ADS PayPal capture status requires reconciliation:',String(e.message||e));
    }
    order=await paypalApi('/v2/checkout/orders/'+orderId,{},config);
  }
  if(order.status!=='COMPLETED')throw new Error('PAYMENT_NOT_COMPLETED');
  const data=await creditCompletedOrder(orderId);
  return {credited:true,orderId,wallet:data.wallet};
}
export async function applyRefundWebhook(event){
  // Retiros y ajustes solo se efectúan después de verificar la firma de PayPal.
  const resource=event?.resource||{};
  const id=String(resource.id||'');
  const captureId=String(resource.supplementary_data?.related_ids?.capture_id||resource.capture_id||'');
  if(!refundRegex.test(id)||!refundRegex.test(captureId))throw new Error('INVALID_REFUND');
  const cents=parseCents(resource.amount?.value);
  if(cents===null||resource.amount?.currency_code!==CURRENCY)throw new Error('INVALID_REFUND_AMOUNT');
  const captureRef=db().collection('adsPaymentCaptures').doc(captureId);
  const adjustmentRef=db().collection('adsPaymentRefunds').doc(id);
  await db().runTransaction(async tx=>{
    const [capture,refund]=await Promise.all([tx.get(captureRef),tx.get(adjustmentRef)]);
    if(refund.exists)return;
    if(!capture.exists)throw new Error('REFUND_REQUIRES_RECONCILIATION');
    const d=capture.data(),uid=d.uid,prior=Number(d.refundedCents||0);
    if(!uidRegex.test(uid)||prior+cents>Number(d.amountCents))throw new Error('REFUND_AMOUNT_EXCEEDS_CAPTURE');
    const walletRef=walletDoc(uid);
    const ledgerRef=db().collection('users').doc(uid).collection('adsPaymentLedger').doc('refund-'+id);
    tx.create(adjustmentRef,{captureId,uid,amountCents:cents,createdAt:FieldValue.serverTimestamp()});
    tx.update(captureRef,{refundedCents:FieldValue.increment(cents)});
    tx.set(walletRef,{availableCents:FieldValue.increment(-cents),updatedAt:FieldValue.serverTimestamp()},{merge:true});
    tx.create(ledgerRef,{kind:'refund',status:'COMPLETED',amountCents:-cents,currency:CURRENCY,createdAt:FieldValue.serverTimestamp()});
  });
}
export function errorResponse(error){
  const code=String(error?.message||'INTERNAL_ERROR');
  const statuses={
    AUTH_REQUIRED:401,AUTH_INVALID:401,ACCOUNT_NOT_FOUND:403,ACCOUNT_NOT_ACTIVE:403,
    INVALID_AMOUNT:400,INVALID_ORDER_ID:400,ORDER_NOT_FOUND:404,PAYMENT_NOT_COMPLETED:409,
    PAYPAL_MODE_MISMATCH:409,PAYPAL_MERCHANT_UNVERIFIED:409,
    PAYMENTS_DISABLED:503,PAYPAL_NOT_CONFIGURED:503,FIREBASE_NOT_CONFIGURED:503,
    INVALID_REFUND:400,INVALID_REFUND_AMOUNT:400
  };
  return {status:statuses[code]||502,error:statuses[code]?code:'PAYMENT_SERVICE_UNAVAILABLE'};
}
