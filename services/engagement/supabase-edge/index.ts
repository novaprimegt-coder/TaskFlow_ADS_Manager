// TaskFlow ADS V183 · Servicio PRIVADO para datos opcionales y resumidos.
// Requiere Firebase ID token autenticado; jamás publicar SUPABASE_SERVICE_ROLE_KEY.
import {createClient} from "npm:@supabase/supabase-js@2.57.0";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@6.1.0";
const PID="taskflow-b0ece",ORIGIN="https://novaprimegt-coder.github.io";
const POLICY="2026-11-21.v183";
const JWKS=createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const uidPattern=/^[A-Za-z0-9_-]{3,128}$/;
const isoCountry=/^[A-Z]{2}$/;
const regionPattern=/^[\p{L}\p{M} .-]{2,64}$/u;
const blocks=new Set(["night","morning","afternoon","evening"]);
function cors(req){
 const h=new Headers({"Content-Type":"application/json","Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff","Vary":"Origin"});
 if(req.headers.get("origin")===ORIGIN)h.set("Access-Control-Allow-Origin",ORIGIN);
 return h;
}
function reply(req,status,body){return new Response(JSON.stringify(body),{status,headers:cors(req)})}
async function identity(req){
 const m=(req.headers.get("authorization")||"").match(/^Bearer ([^\s]+)$/);
 if(!m)throw Error("NO_SESSION");
 const {payload}=await jwtVerify(m[1],JWKS,{audience:PID,issuer:"https://securetoken.google.com/"+PID,algorithms:["RS256"]});
 const uid=String(payload.sub||"");
 if(!uidPattern.test(uid))throw Error("NO_SESSION");
 return uid;
}
function service(){
 const url=Deno.env.get("SUPABASE_URL")||"";
 let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!key)try{const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");key=keys.service_role||keys.default||""}catch{}
 if(!url||!key)throw Error("NOT_READY");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function payload(req){
 const text=await req.text();if(text.length>900)throw Error("BAD_INPUT");
 try{return JSON.parse(text)}catch{throw Error("BAD_INPUT")}
}
async function consent(db,uid){
 const {data,error}=await db.from("taskflow_ads_user_profiles")
 .select("declared_age,age_declared_at,profiling_consent").eq("uid",uid).maybeSingle();
 if(error)throw Error("STORE_NOT_READY");
 const age=Number(data?.declared_age),time=Date.parse(data?.age_declared_at||"");
 return !!data&&Number.isInteger(age)&&age>=18&&age<=120&&data.profiling_consent===true
 &&Number.isFinite(time)&&time>Date.now()-365*86400000;
}
async function current(db,uid){
 if(!await consent(db,uid))return {ok:true,residenceConsent:false,activityConsent:false,country:"",region:""};
 const {data,error}=await db.from("taskflow_ads_engagement_preferences")
 .select("residence_consent,activity_consent,country,region,policy_version")
 .eq("uid",uid).maybeSingle();
 if(error)throw Error("STORE_NOT_READY");
 const current=data?.policy_version===POLICY;
 return {ok:true,residenceConsent:current&&data?.residence_consent===true,
  activityConsent:current&&data?.activity_consent===true,
  country:current&&data?.residence_consent===true?String(data.country||""):"",
  region:current&&data?.residence_consent===true?String(data.region||""):""};
}
async function save(db,uid,x){
 if(!await consent(db,uid))throw Error("CONSENT_REQUIRED");
 if(typeof x?.residenceConsent!=="boolean"||typeof x?.activityConsent!=="boolean")throw Error("BAD_INPUT");
 const residence=x.residenceConsent===true,activity=x.activityConsent===true;
 const country=residence?String(x.country||"").trim().toUpperCase():"";
 const region=residence?String(x.region||"").trim().replace(/\s+/g," "):"";
 if(residence&&(!isoCountry.test(country)||!regionPattern.test(region)))throw Error("BAD_INPUT");
 const {data:old,error:lookup}=await db.from("taskflow_ads_engagement_preferences")
 .select("residence_consent,activity_consent,policy_version").eq("uid",uid).maybeSingle();
 if(lookup)throw Error("STORE_NOT_READY");
 const fields={
  uid,country,region,residence_consent:residence,activity_consent:activity,policy_version:POLICY,
  updated_at:new Date().toISOString(),
  residence_consented_at:residence?(old?.residence_consent&&old?.policy_version===POLICY?undefined:new Date().toISOString()):null,
  activity_consented_at:activity?(old?.activity_consent&&old?.policy_version===POLICY?undefined:new Date().toISOString()):null
 };
 // No anular la fecha de consentimiento anterior cuando permanece activo.
 if(fields.residence_consented_at===undefined)delete fields.residence_consented_at;
 if(fields.activity_consented_at===undefined)delete fields.activity_consented_at;
 const {error}=await db.from("taskflow_ads_engagement_preferences").upsert(fields,{onConflict:"uid"});
 if(error)throw Error("STORE_NOT_READY");
 // Retirar el permiso de actividad borra el histórico inmediatamente.
 if(!activity){
  const [a,b]=await Promise.all([
   db.from("taskflow_ads_engagement_daily").delete().eq("uid",uid),
   db.from("taskflow_ads_engagement_receipts").delete().eq("uid",uid)
  ]);
  if(a.error||b.error)throw Error("STORE_NOT_READY");
 }
 return current(db,uid);
}
async function clear(db,uid){
 // El borrado debe funcionar aunque se haya revocado el permiso principal.
 for(const table of ["taskflow_ads_engagement_receipts","taskflow_ads_engagement_daily","taskflow_ads_engagement_preferences"]){
  const {error}=await db.from(table).delete().eq("uid",uid);
  if(error)throw Error("STORE_NOT_READY");
 }
 return {ok:true,residenceConsent:false,activityConsent:false,country:"",region:""};
}
async function record(db,uid,x){
 if(!await consent(db,uid))throw Error("CONSENT_REQUIRED");
 const id=String(x?.eventId||""),seconds=Number(x?.seconds),block=String(x?.block||"");
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
 ||!Number.isInteger(seconds)||seconds<30||seconds>90||!blocks.has(block))throw Error("BAD_INPUT");
 const {data:allowed,error:prefErr}=await db.from("taskflow_ads_engagement_preferences")
 .select("activity_consent,policy_version").eq("uid",uid).maybeSingle();
 if(prefErr)throw Error("STORE_NOT_READY");
 if(!allowed?.activity_consent||allowed.policy_version!==POLICY)throw Error("CONSENT_REQUIRED");
 const {data:ok,error}=await db.rpc("taskflow_ads_engagement_record",{
  p_uid:uid,p_event_id:id,p_seconds:seconds,p_block:block
 });
 if(error)throw Error("STORE_NOT_READY");
 if(ok!==true)throw Error("CONSENT_REQUIRED");
 return {ok:true};
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 if(origin&&origin!==ORIGIN)return reply(req,403,{ok:false,error:"NOT_ALLOWED"});
 if(req.method==="OPTIONS"){
  const h=cors(req);h.set("Access-Control-Allow-Methods","POST,OPTIONS");
  h.set("Access-Control-Allow-Headers","Authorization,Content-Type");
  return new Response(null,{status:204,headers:h});
 }
 if(req.method!=="POST")return reply(req,405,{ok:false,error:"METHOD_NOT_ALLOWED"});
 try{
  const uid=await identity(req),db=service(),path=new URL(req.url).pathname;
  if(path.endsWith("/preferences/get"))return reply(req,200,await current(db,uid));
  if(path.endsWith("/preferences/set"))return reply(req,200,await save(db,uid,await payload(req)));
  if(path.endsWith("/preferences/clear"))return reply(req,200,await clear(db,uid));
  if(path.endsWith("/session/record"))return reply(req,200,await record(db,uid,await payload(req)));
  return reply(req,404,{ok:false,error:"NOT_FOUND"});
 }catch(e){
  const reason=e?.message||"FAILED";
  const access=reason==="NO_SESSION",choice=reason==="CONSENT_REQUIRED",bad=reason==="BAD_INPUT";
  console.warn("ADS optional engagement request rejected",access?"NO_SESSION":choice?"CONSENT_REQUIRED":bad?"BAD_INPUT":"SERVICE_REJECTED");
  return reply(req,access?401:choice?403:bad?400:503,{ok:false,error:access?"NO_SESSION":choice?"CONSENT_REQUIRED":bad?"BAD_INPUT":"SERVICE_UNAVAILABLE"});
 }
});
