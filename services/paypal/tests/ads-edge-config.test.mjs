import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../supabase-edge/index.ts', import.meta.url), 'utf8');
const from = source.indexOf('const ORIGIN =');
const to = source.indexOf('const baseHeaders', from);
assert.ok(from >= 0 && to > from, 'Debe existir el bloque de configuración aislada');
const setup = new Function('Deno', 'createRemoteJWKSet', 'URL',
  source.slice(from, to) + '\nreturn {mode:MODE,enabled:ENABLE_CHECKOUT};'
);
const config = vars => setup({env:{get:key=>vars[key]}},()=>null,class FakeURL{});
const sandbox = {
 TF_PAYPAL_ADS_SANDBOX_CLIENT_ID:'sandbox-id',
 TF_PAYPAL_ADS_SANDBOX_CLIENT_SECRET:'sandbox-secret',
 TF_PAYPAL_ADS_SANDBOX_MERCHANT_EMAIL:'seller@example.test',
 TF_PAYPAL_ADS_SANDBOX_WEBHOOK_ID:'sandbox-hook'
};
const live = {
 TF_PAYPAL_ADS_MODE:'live',
 TF_PAYPAL_ADS_LIVE_CLIENT_ID:'live-id',
 TF_PAYPAL_ADS_LIVE_CLIENT_SECRET:'live-secret',
 TF_PAYPAL_ADS_LIVE_MERCHANT_EMAIL:'seller@example.test',
 TF_PAYPAL_ADS_LIVE_WEBHOOK_ID:'live-hook'
};
test('ADS arranca deshabilitado y no reutiliza claves de TaskFlow sin anuncios', ()=>{
 assert.deepEqual(config({}),{mode:'sandbox',enabled:false});
 assert.deepEqual(config({TF_PAYPAL_MODE:'live',TF_PAYPAL_CLIENT_ID:'shared',
   TF_PAYPAL_CLIENT_SECRET:'shared'}),{mode:'sandbox',enabled:false});
});
test('Sandbox exige sus cuatro variables independientes',()=>{
 assert.deepEqual(config({...sandbox,TF_PAYPAL_ADS_SANDBOX_WEBHOOK_ID:''}),
   {mode:'sandbox',enabled:false});
 assert.deepEqual(config(sandbox),{mode:'sandbox',enabled:true});
});
test('Live permanece bloqueado sin autorización expresa',()=>{
 assert.deepEqual(config(live),{mode:'live',enabled:false});
 assert.deepEqual(config({...live,TF_PAYPAL_ADS_ENABLE_LIVE:'true'}),
   {mode:'live',enabled:true});
});
test('El status requiere OAuth válido y se verifican firmas de webhooks',()=>{
 assert.match(source,/await accessToken\(\);available=true/);
 assert.match(source,/verify-webhook-signature/);
 assert.match(source,/verification_status!=="SUCCESS"/);
});
