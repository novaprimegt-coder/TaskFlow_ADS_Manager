// TaskFlow ADS Audience V1 — backend propio, opt-in para adultos, sin ubicación GPS/IP.
// PREPARADO: no está desplegado. Los secretos van en el panel privado de Supabase.
import {createClient} from "npm:@supabase/supabase-js@2.57.0";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@6.1.0";

const ALLOWED_ORIGIN="https://novaprimegt-coder.github.io";
const FIREBASE_PROJECT="taskflow-b0ece";
const JWKS=createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const UID=/^[A-Za-z0-9_-]{3,128}$/;
const SESSION=/^[a-fA-F0-9-]{24,80}$/;
const COUNTRY=/^[A-Z]{2}$/;
const REGION=/^[\p{L}\p{M} .'’()-]{2,80}$/u;
const encoder=new TextEncoder();

function json(req,status,object){
 const headers=new Headers({"Content-Type":"application/json","Cache-Control":"private,no-store","X-Content-Type-Options":"nosniff","Vary":"Origin"});
 if(req.headers.get("origin")===ALLOWED_ORIGIN)headers.set("Access-Control-Allow-Origin",ALLOWED_ORIGIN);
 return new Response(JSON.stringify(object),{status,headers});
}
function store(){
 const url=Deno.env.get("SUPABASE_URL")||"";
 let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 try{
  const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
  key=keys.default||key;
 }catch(_){/* Fallback para proyectos que conservan la clave heredada. */}
 if(!url||!key)throw Error("STORE_NOT_READY");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function authenticate(req){
 const auth=(req.headers.get("authorization")||"").match(/^Bearer ([^\s]+)$/);
 if(!auth)throw Error("NO_SESSION");
 let payload;
 try{
  ({payload}=await jwtVerify(auth[1],JWKS,{
   algorithms:["RS256"],audience:FIREBASE_PROJECT,issuer:"https://securetoken.google.com/"+FIREBASE_PROJECT
  }));
 }catch(_){
  // Token inválido, vencido o con firma incorrecta: 401, no error 503.
  throw Error("NO_SESSION");
 }
 if(!UID.test(String(payload.sub||"")))throw Error("NO_SESSION");
 return {uid:String(payload.sub),admin:payload.taskflowAdsAdmin===true};
}
async function input(req){
 const raw=await req.text();
 if(raw.length>1300)throw Error("BAD_INPUT");
 try{const value=JSON.parse(raw);if(!value||typeof value!=="object"||Array.isArray(value))throw Error();return value}
 catch{throw Error("BAD_INPUT")}
}
async function eligible(db,uid){
 const {data,error}=await db.from("taskflow_ads_user_profiles")
  .select("declared_age,age_declared_at").eq("uid",uid).maybeSingle();
 if(error)throw Error("PROFILE_UNAVAILABLE");
 return Number.isInteger(Number(data?.declared_age))&&Number(data.declared_age)>=18
  &&Date.parse(String(data?.age_declared_at||""))>Date.now()-365*86400000;
}
async function ownProfile(db,uid){
 const {data,error}=await db.from("taskflow_ads_audience_optins")
  .select("activity_consent,area_consent,residence_country,residence_region,consented_at")
  .eq("uid",uid).maybeSingle();
 if(error)throw Error("PROFILE_UNAVAILABLE");
 // No devolver permisos ni región previamente guardados si la edad ya no
 // acredita una cuenta adulta; el backend vuelve a comprobar cada lectura.
 const adultEligible=await eligible(db,uid);
 const activityConsent=adultEligible&&data?.activity_consent===true;
 const areaConsent=adultEligible&&data?.area_consent===true;
 return {
  adultEligible,
  activityConsent,
  areaConsent,
  country:areaConsent?data.residence_country||"": "",
  region:areaConsent?data.residence_region||"": ""
 };
}
async function preferences(db,uid,request){
 const value=await input(request);
 if(typeof value.activityConsent!=="boolean"||typeof value.areaConsent!=="boolean")throw Error("BAD_INPUT");
 const country=String(value.country||"").trim().toUpperCase(),region=String(value.region||"").trim().replace(/\s+/g," ");
 if(value.areaConsent&&(!COUNTRY.test(country)||!REGION.test(region)))throw Error("BAD_INPUT");
 if((value.areaConsent||value.activityConsent)&&!(await eligible(db,uid)))throw Error("NOT_ELIGIBLE");
 const {data,error}=await db.rpc("taskflow_ads_audience_preferences",{
  p_uid:uid,p_activity:value.activityConsent,p_area:value.areaConsent,
  p_country:value.areaConsent?country:"",p_region:value.areaConsent?region:""
 });
 if(error)throw Error("SAVE_FAILED");
 if(data!==true)throw Error("NOT_ELIGIBLE");
 return {ok:true,profile:await ownProfile(db,uid)};
}
async function digest(uid,sessionId){
 const secret=Deno.env.get("TF_ADS_ACTIVITY_HASH_KEY")||"";
 if(secret.length<32)throw Error("HASH_KEY_NOT_CONFIGURED");
 const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const result=await crypto.subtle.sign("HMAC",key,encoder.encode(uid+"|"+sessionId));
 return [...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
async function heartbeat(db,uid,req){
 const value=await input(req),sessionId=String(value.sessionId||"");
 if(!SESSION.test(sessionId))throw Error("BAD_INPUT");
 // El backend consulta consentimiento y edad EN LA BASE, no cree en el navegador.
 const hash=await digest(uid,sessionId);
 const {data,error}=await db.rpc("taskflow_ads_audience_heartbeat",{
  p_uid:uid,p_session_digest:hash
 });
 if(error)throw Error("SAVE_FAILED");
 return {ok:true,recorded:data===true}; // Un minuto deduplicado; no hay facturación.
}
async function forget(db,uid){
 // Eliminación en cascada: preferencias, región declarada y actividad diaria.
 const {error}=await db.from("taskflow_ads_audience_optins").delete().eq("uid",uid);
 if(error)throw Error("DELETE_FAILED");
 return {ok:true};
}
async function adminReport(db,user){
 if(!user.admin)throw Error("NO_ACCESS");
 const {data,error}=await db.rpc("taskflow_ads_audience_report");
 if(error)throw Error("REPORT_UNAVAILABLE");
 return data;
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 if(origin&&origin!==ALLOWED_ORIGIN)return json(req,403,{error:"NOT_ALLOWED"});
 if(req.method==="OPTIONS"){
  return new Response(null,{status:204,headers:{
   "Access-Control-Allow-Origin":ALLOWED_ORIGIN,
   "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
   "Access-Control-Allow-Headers":"Content-Type,Authorization",
   "Cache-Control":"no-store"
  }});
 }
 const endpoint=new URL(req.url).pathname;
 if(!["GET","POST"].includes(req.method))return json(req,405,{error:"METHOD_NOT_ALLOWED"});
 try{
  const user=await authenticate(req),db=store();
  if(req.method==="GET"&&endpoint.endsWith("/profile"))
   return json(req,200,await ownProfile(db,user.uid));
  if(req.method==="POST"&&endpoint.endsWith("/preferences"))
   return json(req,200,await preferences(db,user.uid,req));
  if(req.method==="POST"&&endpoint.endsWith("/heartbeat"))
   return json(req,200,await heartbeat(db,user.uid,req));
  if(req.method==="POST"&&endpoint.endsWith("/forget"))
   return json(req,200,await forget(db,user.uid));
  if(req.method==="GET"&&endpoint.endsWith("/admin/summary"))
   return json(req,200,await adminReport(db,user));
  return json(req,404,{error:"NOT_FOUND"});
 }catch(err){
  const reason=err?.message||"";
  const status=reason==="BAD_INPUT"?400:reason==="NO_SESSION"?401:reason==="NO_ACCESS"?403:
   reason==="NOT_ELIGIBLE"?403:503;
  console.warn("TaskFlow ADS Audience:",reason);
  return json(req,status,{error:status===400?"INVALID_DATA":status===401?"SESSION_REQUIRED":
    status===403?"NOT_AUTHORIZED":"SERVICE_UNAVAILABLE"});
 }
});
