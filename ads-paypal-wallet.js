/* TaskFlow ADS: recargas individuales PayPal, saldo leído exclusivamente del servidor. */
(()=>{'use strict';
const BASE='https://taskflow-ads-payments.vercel.app';
const BOUND=new WeakSet();
let api=null,busy=false,returning=false,processed='';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message={
 PAYMENTS_DISABLED:'Los cobros todavía no están habilitados.',
 PAYMENT_NOT_COMPLETED:'PayPal todavía no confirma esta recarga.',
 ORDER_NOT_FOUND:'Esta orden no pertenece a la cuenta actual.',
 PAYPAL_MERCHANT_UNVERIFIED:'No fue posible comprobar al receptor del pago.',
 AUTH_INVALID:'La sesión no pudo verificarse.',
 ACCOUNT_NOT_ACTIVE:'Esta cuenta no está activa.',
 PAYMENT_SERVICE_UNAVAILABLE:'El servicio de pagos no pudo confirmar la operación.'
};
function fail(err){return message[err?.message]||'No fue posible completar la operación. Revisa la conexión.'}
function eligible(){return !!api?.currentUser?.id&&api.fbAuth?.currentUser?.uid===api.currentUser.id}
async function call(route,method='GET',body,auth=true){
 const headers={'Accept':'application/json'};
 if(auth){if(!eligible())throw Error('AUTH_INVALID');headers.Authorization='Bearer '+await api.fbAuth.currentUser.getIdToken()}
 if(body!==undefined)headers['Content-Type']='application/json';
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),16000);
 try{
  const res=await fetch(BASE+'/api/'+route,{method,headers,credentials:'omit',cache:'no-store',signal:abort.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.error||'PAYMENT_SERVICE_UNAVAILABLE');
  return data;
 }finally{clearTimeout(timer)}
}
function shell(){
 return '<section id="tfAdsPayPalWallet" class="tf-wallet-panel" aria-label="Saldo publicitario">'+
 '<header class="tf-wallet-head"><div class="tf-wallet-logo" aria-hidden="true">P</div><div><small>FACTURACIÓN · PAYPAL</small><h3>Saldo publicitario</h3></div><span>USD</span></header>'+
 '<div class="tf-wallet-main"><small>Saldo acreditado</small><strong id="tfWalletAmount">—</strong><p id="tfWalletState" role="status">Verificando el saldo de tu cuenta…</p></div>'+
 '<div class="tf-wallet-columns"><div class="tf-wallet-recharge"><h4>Recargar saldo</h4><p>Elige la cantidad que deseas pagar. Confirmarás cada compra en PayPal.</p>'+
 '<form id="tfWalletRechargeForm"><label for="tfWalletInputUSD">Cantidad en dólares estadounidenses</label><div class="tf-wallet-input"><span>US$</span><input id="tfWalletInputUSD" name="amount" type="number" inputmode="decimal" required min="0.01" max="10000" step="0.01" placeholder="0.00"></div>'+
 '<button id="tfWalletPayButton" type="submit" disabled>Verificando PayPal…</button></form></div>'+
 '<div class="tf-wallet-movements"><div class="tf-wallet-movement-head"><h4>Movimientos confirmados</h4><button type="button" id="tfWalletRefreshButton">Actualizar</button></div><div id="tfWalletMovements">Consultando movimientos…</div></div></div>'+
 '<p class="tf-wallet-feedback" id="tfWalletFeedback" role="status" aria-live="polite"></p>'+
 '<footer class="tf-wallet-footnote">Solo se acredita dinero después de una captura verificada. Las campañas mantienen presupuestos en GTQ; este saldo se registra en USD, sin conversiones ni descuentos publicitarios automáticos mientras no exista una tarifa definida.</footer></section>';
}
function text(id,value){const x=document.getElementById(id);if(x)x.textContent=value}
function notice(value){text('tfWalletFeedback',value)}
function state(label,allowed){text('tfWalletState',label);const button=document.getElementById('tfWalletPayButton');if(button){button.disabled=!allowed||busy;button.textContent=allowed?'Pagar con PayPal':'Recargas no disponibles'}}
function history(items){
 const box=document.getElementById('tfWalletMovements');if(!box)return;
 if(!Array.isArray(items)){box.textContent='Movimientos no disponibles.';return}
 if(!items.length){box.textContent='Todavía no hay recargas confirmadas.';return}
 box.innerHTML=items.map(item=>'<div class="tf-wallet-movement"><div><b>'+esc(item.kind==='refund'?'Reembolso o ajuste':'Recarga PayPal')+'</b><small>'+esc(item.createdAt?new Date(item.createdAt).toLocaleDateString('es-GT'):'Confirmada')+'</small></div><strong>'+esc(item.kind==='refund'?'':'+' )+' US$ '+esc(item.amount)+'</strong></div>').join('');
}
async function refresh(){
 if(!eligible()||!document.getElementById('tfAdsPayPalWallet'))return;
 const uid=api.currentUser.id;
 state('Consultando saldo en el servidor…',false);
 let status;
 try{status=await call('status','GET',undefined,false)}
 catch(e){state('Servicio de PayPal no disponible.',false);notice(fail(e));return}
 if(!eligible()||api.currentUser.id!==uid)return;
 try{
  const wallet=await call('wallet');
  if(!eligible()||api.currentUser.id!==uid)return;
  text('tfWalletAmount','US$ '+wallet.balance);
  history(wallet.transactions);
  state(status.checkoutAvailable?'Saldo verificado':'Saldo verificado; cobros aún no habilitados.',!!status.checkoutAvailable);
  notice(status.checkoutAvailable?'':'El servidor de cobros necesita sus credenciales privadas de PayPal y Firebase.');
 }catch(e){state('Saldo pendiente de verificación.',false);notice(fail(e));history(null)}
}
async function pay(form){
 if(busy||!eligible())return;
 const amount=String(form.elements.amount.value||'').trim();
 if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(amount)||Number(amount)<.01||Number(amount)>10000){
  notice('Introduce de US$ 0.01 a US$ 10,000.00, con máximo dos decimales.');return;
 }
 busy=true;state('Creando la solicitud de pago…',false);notice('PayPal solicitará tu autorización antes de cualquier cobro.');
 try{
  const result=await call('orders','POST',{amount});
  const u=new URL(result.approveUrl);
  if(u.protocol!=='https:'||!['www.paypal.com','www.sandbox.paypal.com','paypal.com','sandbox.paypal.com'].includes(u.hostname))throw Error('PAYMENT_SERVICE_UNAVAILABLE');
  window.location.assign(u.toString());
 }catch(e){busy=false;state('La recarga no fue iniciada.',true);notice(fail(e))}
}
function clearQuery(){
 const u=new URL(location.href);for(const key of ['tfads_payment','token','PayerID'])u.searchParams.delete(key);
 historyReplace(u.pathname+u.search+u.hash);
}
function historyReplace(relative){window.history.replaceState(window.history.state,'',relative)}
async function afterReturn(ctx,manual=false){
 if(!ctx?.currentUser?.id||returning)return;
 const u=new URL(window.location.href),mode=u.searchParams.get('tfads_payment');
 if(mode!=='return'&&mode!=='cancel')return;
 api=ctx;
 if(mode==='cancel'){clearQuery();api.showView?.('billing');notice('Operación cancelada: no se añadió saldo.');return}
 const orderId=String(u.searchParams.get('token')||'');
 if(!/^[a-zA-Z0-9]{10,40}$/.test(orderId))return;
 if(processed===orderId&&!manual)return;
 processed=orderId;returning=true;
 api.showView?.('billing');notice('Confirmando el pago con PayPal…');
 try{
  const result=await call('capture','POST',{orderId});
  if(result.credited){
   clearQuery();await refresh();notice('PayPal confirmó el pago. Saldo acreditado correctamente.');
  }else throw Error('PAYMENT_NOT_COMPLETED');
 }catch(e){notice(fail(e)+' Sin confirmación, no se añade saldo.');const note=document.getElementById('tfWalletFeedback');if(note){const button=document.createElement('button');button.type='button';button.id='tfWalletRetryPayment';button.textContent='Volver a verificar el pago';note.appendChild(button)}}
 finally{returning=false}
}
function bind(root){
 if(BOUND.has(root))return;BOUND.add(root);
 root.addEventListener('submit',e=>{if(e.target.id==='tfWalletRechargeForm'){e.preventDefault();void pay(e.target)}});
 root.addEventListener('click',e=>{if(e.target.closest('#tfWalletRefreshButton'))void refresh();if(e.target.closest('#tfWalletRetryPayment'))void afterReturn(api,true)});
}
function mount(ctx){
 if(!ctx?.root||!ctx?.currentUser)return;
 api=ctx;bind(ctx.root);
 if(!ctx.root.querySelector('#tfAdsPayPalWallet'))ctx.root.insertAdjacentHTML('afterbegin',shell());
 void refresh();
}
function onAuth(ctx){
 if(!ctx?.currentUser)return;api=ctx;
 if(new URL(window.location.href).searchParams.has('tfads_payment'))void afterReturn(ctx);
}
window.TaskFlowADSWallet=Object.freeze({mount,onAuth});
})();
