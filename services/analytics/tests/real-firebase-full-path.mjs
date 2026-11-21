// Prueba real con identidad Firebase efímera; no usa cuentas de clientes.
// Crea un usuario técnico temporal, comprueba el flujo y lo elimina en finally.
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";

const PROJECT="https://novaprimegt-coder.github.io/TaskFlow_Sistem";
const ORIGIN="https://novaprimegt-coder.github.io";
const SUPABASE="https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1";
let token=null,uid=null,key=null,cleanupFailed=false;
let completed=0;

function pass(name){completed++;console.log("PASS: "+name)}
async function request(url,{method="GET",json,auth,origin=false}={}){
 const response=await fetch(url,{
  method,signal:AbortSignal.timeout(18000),cache:"no-store",
  headers:{
   ...(json!==undefined?{"Content-Type":"application/json"}:{}),
   ...(auth?{"Authorization":"Bearer "+auth}:{}),
   ...(origin?{"Origin":ORIGIN}:{})
  },
  ...(json!==undefined?{body:JSON.stringify(json)}:{})
 });
 let body={};try{body=await response.json()}catch{}
 return {status:response.status,body};
}
async function authApi(action,json){
 const r=await request("https://identitytoolkit.googleapis.com/v1/"+action+"?key="+encodeURIComponent(key),{method:"POST",json});
 if(r.status!==200)throw Error("FIREBASE_"+action+"_"+r.status+"_"+String(r.body?.error?.message||"UNKNOWN"));
 return r.body;
}
async function api(service,path,json){
 return request(SUPABASE+"/"+service+"/"+path,{method:json===undefined?"GET":"POST",json,auth:token,origin:true});
}
async function retryCleanup(action){
 let last;
 for(let k=0;k<3;k++){
  try{
   await action();
   return true;
  }catch(e){last=e;if(k<2)await new Promise(r=>setTimeout(r,1000*(k+1)))}
 }
 console.error("CLEANUP_FAILED "+String(last?.message||last).slice(0,180));
 cleanupFailed=true;return false;
}
try{
 const source=await fetch(PROJECT+"/taskflow-firebase-v108.js",{signal:AbortSignal.timeout(15000)}).then(r=>r.text());
 const match=source.match(/\bapiKey:'([^']+)'/);
 assert.ok(match,"Missing public Firebase app configuration");
 key=match[1];
 const random=randomUUID().replace(/-/g,"");
 const email="qa-taskflow-"+random+"@example.invalid";
 const password="TQa1!"+randomBytes(24).toString("base64url");
 const account=await authApi("accounts:signUp",{email,password,returnSecureToken:true});
 token=account.idToken;uid=account.localId;
 assert.ok(token&&/^[A-Za-z0-9_-]{3,128}$/.test(uid),"Invalid generated account");
 console.log("SYNTHETIC_QA_UID="+uid); // No es un identificador de cliente; limpiar su fila al finalizar.

 let r=await api("taskflow-ads-audience","profile");
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.adultEligible,false);
 pass("El perfil nuevo no puede usar analítica sin edad declarada");

 r=await api("taskflow-ads-audience","preferences",{activityConsent:true,areaConsent:false});
 assert.equal(r.status,403,JSON.stringify(r));
 pass("No se concede permiso a una cuenta sin edad adulta declarada");

 r=await api("taskflow-ads-delivery","profile/set",{age:21,personalizationConsent:false});
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.age,21);
 pass("Edad adulta declarada registrada por el servicio oficial");

 r=await api("taskflow-ads-audience","profile");
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.adultEligible,true);
 assert.equal(r.body.activityConsent,false);
 pass("El adulto comienza sin consentimiento para analítica");

 r=await api("taskflow-ads-audience","preferences",{activityConsent:true,areaConsent:true,country:"GT",region:"Huehuetenango"});
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.profile.activityConsent,true);
 assert.equal(r.body.profile.areaConsent,true);
 pass("Acepta voluntariamente los dos permisos independientes");

 r=await api("taskflow-ads-audience","profile");
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.region,"Huehuetenango");
 assert.equal(r.body.country,"GT");
 pass("Recupera la región declarada solo para el usuario autenticado");

 const session=randomUUID();
 r=await api("taskflow-ads-audience","heartbeat",{sessionId:session});
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.recorded,true);
 pass("El servicio registra un minuto de actividad real con token firmado");

 r=await api("taskflow-ads-audience","heartbeat",{sessionId:session});
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.recorded,false);
 pass("No duplica un minuto al repetir un latido");

 r=await api("taskflow-ads-audience","forget",{});
 assert.equal(r.status,200,JSON.stringify(r));
 r=await api("taskflow-ads-audience","profile");
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.activityConsent,false);
 assert.equal(r.body.areaConsent,false);
 assert.equal(r.body.region,"");
 pass("Borra la actividad y la región al retirar el consentimiento");

 r=await api("taskflow-ads-audience","heartbeat",{sessionId:randomUUID()});
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.recorded,false);
 pass("Después de borrar no vuelve a registrar actividad sin permiso");

 r=await api("taskflow-ads-audience","preferences",{activityConsent:true,areaConsent:false,country:"",region:""});
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.profile.areaConsent,false);
 pass("Permite consentir actividad sin autorizar residencia");

 r=await api("taskflow-ads-delivery","profile/set",{age:17,personalizationConsent:false});
 assert.equal(r.status,200,JSON.stringify(r));
 r=await api("taskflow-ads-audience","profile");
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.adultEligible,false);
 assert.equal(r.body.activityConsent,false);
 pass("Al cambiar a menor de edad desaparece la autorización");

 r=await api("taskflow-ads-audience","heartbeat",{sessionId:randomUUID()});
 assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.recorded,false);
 pass("El servicio no registra actividad de menores");
 console.log("FULL_PATH_TESTS_PASSED="+completed);
}catch(e){
 console.error("E2E_FAILURE="+String(e?.message||e).slice(0,900));
 process.exitCode=1;
}finally{
 if(token){
  await retryCleanup(async()=>{
   const r=await api("taskflow-ads-audience","forget",{});
   if(r.status!==200)throw Error("AUDIENCE_FORGET_"+r.status);
  });
  await retryCleanup(async()=>{
   const r=await api("taskflow-ads-delivery","profile/set",{age:17,personalizationConsent:false});
   if(r.status!==200)throw Error("AD_PROFILE_DISABLE_"+r.status);
  });
  await retryCleanup(async()=>{await authApi("accounts:delete",{idToken:token})});
 }
 console.log("QA_SYNTHETIC_ACCOUNT="+(uid||"NONE")+" AUTH_CLEANUP="+(cleanupFailed?"FAILED":"COMPLETED"));
 if(cleanupFailed)process.exitCode=1;
}