import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {webcrypto} from "node:crypto";
import {TextEncoder} from "node:util";

const edge=readFileSync(new URL("../supabase-edge/index.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../audience_v1.sql",import.meta.url),"utf8");

function setup({age=21,declaredAt=new Date().toISOString(),admin=false,optins=null}={}){
 const calls=[];
 const profile={declared_age:age,age_declared_at:declaredAt};
 const permissions=optins??{activity_consent:true,area_consent:true,residence_country:"GT",residence_region:"Huehuetenango"};
 const db={
  from(table){
   const row=table==="taskflow_ads_user_profiles"?profile:permissions;
   return {
    select(){return this},
    eq(){return this},
    async maybeSingle(){return {data:row,error:null}},
    delete(){return {async eq(){calls.push({kind:"delete",table});return {error:null}}}}
   };
  },
  async rpc(name,args){calls.push({kind:"rpc",name,args});return {data:name==="taskflow_ads_audience_report"?{usersWithActivityConsent:null}:true,error:null}}
 };
 let handler;
 const Deno={
  env:{get(name){return name==="SUPABASE_URL"?"https://example.supabase.co":
    name==="SUPABASE_SERVICE_ROLE_KEY"?"fake_key_for_offline_tests":
    name==="TF_ADS_ACTIVITY_HASH_KEY"?"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ":""}},
  serve(fn){handler=fn}
 };
 const ctx={Deno,createClient:()=>db,createRemoteJWKSet:()=>({}),
  jwtVerify:async(token)=>{if(token!=="valid")throw Error("Invalid signature");
   return {payload:{sub:"account123",taskflowAdsAdmin:admin}};},
  Headers,Response,URL,TextEncoder,crypto:webcrypto,console:{warn(){}}
 };
 const source=edge.replace(/^import\s+.*?;\s*$/gm,"");
 runInNewContext(source+"\nglobalThis.__api={eligible,ownProfile,preferences,heartbeat,forget,adminReport};",ctx);
 return {api:ctx.__api,handler,db,calls};
}
function req(path,{method="GET",token="valid",origin="https://novaprimegt-coder.github.io",payload}={}){
 const headers=new Headers({"Origin":origin});
 if(token)headers.set("Authorization","Bearer "+token);
 if(payload!==undefined)headers.set("Content-Type","application/json");
 return new Request("https://example.supabase.co/functions/v1/taskflow-ads-audience"+path,
  {method,headers,...(payload!==undefined?{body:JSON.stringify(payload)}:{})});
}

test("Edad: solo perfiles adultos recientes resultan elegibles",async()=>{
 assert.equal(await setup({age:21}).api.eligible(setup().db,"account123"),true);
 const minor=setup({age:17});
 assert.equal(await minor.api.eligible(minor.db,"account123"),false);
 const old=setup({age:21,declaredAt:"2020-01-01T00:00:00Z"});
 assert.equal(await old.api.eligible(old.db,"account123"),false);
});
test("Privacidad: edad insuficiente nunca revela región ni permisos",async()=>{
 const h=setup({age:17});
 const p=await h.api.ownProfile(h.db,"account123");
 assert.equal(p.adultEligible,false);
 assert.equal(p.activityConsent,false);
 assert.equal(p.areaConsent,false);
 assert.equal(p.country,"");
 assert.equal(p.region,"");
});
test("Consentimiento: menores no pueden activar analítica",async()=>{
 const h=setup({age:17});
 await assert.rejects(()=>h.api.preferences(h.db,"account123",
  {text:async()=>JSON.stringify({activityConsent:true,areaConsent:false})}),/NOT_ELIGIBLE/);
 assert.equal(h.calls.length,0);
});
test("Validación: región o país inválidos son rechazados antes de guardar",async()=>{
 const h=setup();
 await assert.rejects(()=>h.api.preferences(h.db,"account123",
  {text:async()=>JSON.stringify({activityConsent:false,areaConsent:true,country:"GT",region:"1 Calle 23, apto 5#"})}),/BAD_INPUT/);
 assert.equal(h.calls.length,0);
});
test("Autenticación: sin token o firma inválida no consulta datos",async()=>{
 const h=setup();
 assert.equal((await h.handler(req("/profile",{token:null}))).status,401);
 assert.equal((await h.handler(req("/profile",{token:"forged"}))).status,401);
 assert.equal(h.calls.length,0);
});
test("CORS: origen ajeno no accede a la API",async()=>{
 const h=setup();
 assert.equal((await h.handler(req("/profile",{origin:"https://malicioso.example"}))).status,403);
});
test("Separación: usuario normal no accede a reporte administrativo",async()=>{
 const h=setup({admin:false});
 assert.equal((await h.handler(req("/admin/summary"))).status,403);
 assert.equal(h.calls.filter(x=>x.name==="taskflow_ads_audience_report").length,0);
});
test("Eliminación: el usuario solo puede eliminar su autorización validada",async()=>{
 const h=setup();
 assert.equal((await h.handler(req("/forget",{method:"POST",payload:{}}))).status,200);
 assert.equal(h.calls.find(x=>x.kind==="delete")?.table,"taskflow_ads_audience_optins");
});
test("Latidos: identificador se guarda como HMAC y no como UUID visible",async()=>{
 const h=setup();
 const sessionId="a5b682d1-16bc-4949-98ff-2bc3ad1bb171";
 const result=await h.api.heartbeat(h.db,"account123",{text:async()=>JSON.stringify({sessionId})});
 const call=h.calls.find(x=>x.name==="taskflow_ads_audience_heartbeat");
 assert.equal(result.recorded,true);
 assert.match(call.args.p_session_digest,/^[a-f0-9]{64}$/);
 assert.notEqual(call.args.p_session_digest,sessionId);
});
test("SQL: RLS, caducidad, borrado de cuenta y grupos protegidos",()=>{
 for(const table of ["taskflow_ads_audience_optins","taskflow_ads_audience_daily_activity"]){
  assert.ok(sql.includes("ALTER TABLE public."+table+" ENABLE ROW LEVEL SECURITY;"));
 }
 assert.ok(sql.includes("AFTER UPDATE OF declared_age OR DELETE ON public.taskflow_ads_user_profiles"));
 assert.ok(sql.includes("IF TG_OP='DELETE' THEN"));
 assert.ok(sql.includes("WHEN users>=5 THEN ROUND(seconds::numeric/60,1)"));
 assert.ok(sql.includes("WHEN users>=5 THEN sessions"));
 assert.ok(sql.includes("activity_day < (current_timestamp AT TIME ZONE 'UTC')::date - 89"));
 assert.ok(!sql.includes("SECURITY DEFINER"));
});
