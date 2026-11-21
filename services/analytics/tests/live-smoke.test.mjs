import test from "node:test";
import assert from "node:assert/strict";

const endpoint="https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-audience";
const allowed="https://novaprimegt-coder.github.io";
const evil="https://untrusted.invalid";
async function call(path,{method="GET",origin=allowed,token,body}={}){
 let last;
 for(let retry=0;retry<3;retry++){
  try{
   const response=await fetch(endpoint+path,{
    method,
    signal:AbortSignal.timeout(20000),
    cache:"no-store",
    headers:{
     "Origin":origin,
     ...(token?{"Authorization":"Bearer "+token}:{}),
     ...(body!==undefined?{"Content-Type":"application/json"}:{})
    },
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
   });
   if([502,503,504,520,522].includes(response.status)&&retry<2){
    await new Promise(resolve=>setTimeout(resolve,1200*(retry+1)));
    continue;
   }
   return response;
  }catch(err){
   last=err;
   if(retry===2)throw err;
   await new Promise(resolve=>setTimeout(resolve,1200*(retry+1)));
  }
 }
 throw last||Error("Unexpected request failure");
}
test("Endpoint activo y preflight del origen autorizado",async()=>{
 const r=await call("/profile",{method:"OPTIONS"});
 assert.equal(r.status,204);
 assert.equal(r.headers.get("access-control-allow-origin"),allowed);
 assert.match(r.headers.get("access-control-allow-methods")||"",/GET/);
});
test("Acceso sin Firebase ID token es rechazado",async()=>{
 const r=await call("/profile");
 assert.equal(r.status,401);
 assert.equal((await r.json()).error,"SESSION_REQUIRED");
 assert.match(r.headers.get("cache-control")||"",/no-store/);
});
test("JWT falso es rechazado con 401, no error 503",async()=>{
 const r=await call("/profile",{token:"a.b.c"});
 assert.equal(r.status,401);
 assert.equal((await r.json()).error,"SESSION_REQUIRED");
});
test("Origen externo bloqueado sin CORS habilitado",async()=>{
 const r=await call("/profile",{origin:evil});
 assert.equal(r.status,403);
 assert.notEqual(r.headers.get("access-control-allow-origin"),evil);
});
test("Reporte administrativo nunca accesible sin sesión",async()=>{
 const r=await call("/admin/summary");
 assert.equal(r.status,401);
});
test("Una escritura no autorizada no puede guardar consentimiento",async()=>{
 const r=await call("/preferences",{method:"POST",body:{activityConsent:true,areaConsent:true,country:"GT",region:"Guatemala"}});
 assert.equal(r.status,401);
});
test("Método HTTP inesperado se rechaza",async()=>{
 const r=await call("/profile",{method:"PUT"});
 assert.equal(r.status,405);
});
