import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCents,asUSD,safeApprovalLink,verifiedCapture} from '../lib/wallet-service.js';

test('conversión monetaria exacta a centavos',()=>{
 assert.equal(parseCents('0.01'),1);
 assert.equal(parseCents('15.75'),1575);
 assert.equal(parseCents('10000.00'),1000000);
 assert.equal(asUSD(1575),'15.75');
 for(const bad of ['0','-1','1.235','10000.01','Infinity','NaN','1e4','01.00',''])assert.equal(parseCents(bad),null,bad);
});
test('solo se aceptan enlaces de aprobación PayPal',()=>{
 const url=safeApprovalLink({links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=ABC'}]});
 assert.match(url,/^https:\/\/www\.sandbox\.paypal\.com\//);
 assert.throws(()=>safeApprovalLink({links:[{rel:'approve',href:'https://www.paypal.com.attacker.example/pay'}]}),/PAYPAL_APPROVAL_URL_INVALID/);
 assert.throws(()=>safeApprovalLink({links:[]}),/PAYPAL_APPROVAL_URL_MISSING/);
});
const config={merchantEmail:'taskflowgt.oficial@gmail.com',merchantId:''};
const record={id:'ORDER1234567890',ticket:'ticket-123',amountCents:1575};
function validOrder(){
 return {
  id:record.id,status:'COMPLETED',
  purchase_units:[{
   custom_id:record.ticket,reference_id:record.ticket,
   payee:{email_address:config.merchantEmail},
   payments:{captures:[{id:'CAPTURE987654321',status:'COMPLETED',amount:{currency_code:'USD',value:'15.75'}}]}
  }]
 };
}
test('la captura válida verifica orden, receptor, moneda e importe',()=>{
 assert.deepEqual(verifiedCapture(validOrder(),record,config),{captureId:'CAPTURE987654321',amountCents:1575});
});
test('rechaza captura sin confirmación',()=>{
 const order=validOrder();order.status='APPROVED';
 assert.throws(()=>verifiedCapture(order,record,config),/PAYMENT_NOT_COMPLETED/);
});
test('rechaza capture pending',()=>{
 const order=validOrder();order.purchase_units[0].payments.captures[0].status='PENDING';
 assert.throws(()=>verifiedCapture(order,record,config),/PAYPAL_CAPTURE_INCOMPLETE/);
});
test('rechaza receptor no autorizado',()=>{
 const order=validOrder();order.purchase_units[0].payee.email_address='attacker@example.com';
 assert.throws(()=>verifiedCapture(order,record,config),/PAYPAL_MERCHANT_UNVERIFIED/);
});
test('rechaza cobros con importe o moneda modificados',()=>{
 const amount=validOrder();amount.purchase_units[0].payments.captures[0].amount.value='155.75';
 assert.throws(()=>verifiedCapture(amount,record,config),/PAYPAL_AMOUNT_MISMATCH/);
 const currency=validOrder();currency.purchase_units[0].payments.captures[0].amount.currency_code='GTQ';
 assert.throws(()=>verifiedCapture(currency,record,config),/PAYPAL_AMOUNT_MISMATCH/);
});
test('rechaza intentos de asociar otra orden',()=>{
 const order=validOrder();order.purchase_units[0].custom_id='different-ticket';
 assert.throws(()=>verifiedCapture(order,record,config),/PAYPAL_ORDER_MISMATCH/);
});
