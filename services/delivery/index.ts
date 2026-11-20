// TaskFlow ADS private delivery control. Proprietary ranking logic remains server-side.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
const ORIGIN="https://novaprimegt-coder.github.io";
const PID="taskflow-b0ece";
const JWKS=createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const FIREBASE="https://firestore.googleapis.com/v1/projects/"+PID+"/databases/(default)/documents/";
const VALID=/^[A-Za-z0-9_-]{3,128}$/;
const placements=new Set(["banner","entry","interaction"]);
// La marca de origen distingue elecciones publicitarias de registros históricos.
const DECLARED_AREA_MARKER="__taskflow_declared_ad_area__";
const INTERESTS=["technology","education","sports","food","entertainment","shopping","travel","home","business","culture"];
function interests(values){
 return Array.isArray(values)?INTERESTS.filter(topic=>values.includes(topic)):[];
}
function matchingInterests(target,selected){
 const topics=interests(target);
 return !topics.length||topics.some(topic=>selected.includes(topic));
}
function declaredArea(value){
 if(value==null)return {country:"",region:"",city:"",neighborhood:""};
 const cc=String(value.country||"").trim().toUpperCase();
 const areaName=(v)=>String(v||"").trim().replace(/\s+/g," ");
 const region=areaName(value.region),city=areaName(value.city);
 const valid=/^[\p{L}\p{M} .'’()-]{0,100}$/u;
 if(!/^[A-Z]{2}$/.test(cc)||cc==="ZZ"||!valid.test(region)||!valid.test(city)||city&&!region)throw Error("BAD_INPUT");
 return {country:cc,region,city,neighborhood:""};
}
const today=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Guatemala",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const read=t=>parts.find(x=>x.type===t)?.value||"00";
 return read("year")+"-"+read("month")+"-"+read("day");
};
const decode=v=>{
 if(!v||typeof v!=="object")return null;
 if("stringValue"in v)return v.stringValue;
 if("doubleValue"in v)return Number(v.doubleValue);
 if("integerValue"in v)return Number(v.integerValue);
 if("booleanValue"in v)return v.booleanValue;
 if("timestampValue"in v)return v.timestampValue;
 if(v.arrayValue)return(v.arrayValue.values||[]).map(decode);
 if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,v])=>[k,decode(v)]));
 return null;
};
const docData=x=>Object.fromEntries(Object.entries(x?.fields||{}).map(([k,v])=>[k,decode(v)]));
function client(){
 const url=Deno.env.get("SUPABASE_URL")||"";
 let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!key)try{const v=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");key=v.service_role||v.default||""}catch{}
 if(!url||!key)throw Error("STORE_NOT_READY");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function response(req,status,body){
 const headers=new Headers({"Content-Type":"application/json","Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff","Vary":"Origin"});
 if(req.headers.get("origin")===ORIGIN)headers.set("Access-Control-Allow-Origin",ORIGIN);
 return new Response(JSON.stringify(body),{status,headers});
}
async function body(req){
 const raw=await req.text();
 if(raw.length>3000)throw Error("BAD_INPUT");
 try{return JSON.parse(raw)}catch{throw Error("BAD_INPUT")}
}
async function identity(req){
 const m=(req.headers.get("authorization")||"").match(/^Bearer ([^\s]+)$/);
 if(!m)throw Error("NO_SESSION");
 const {payload}=await jwtVerify(m[1],JWKS,{algorithms:["RS256"],audience:PID,issuer:"https://securetoken.google.com/"+PID});
 if(!VALID.test(String(payload.sub||"")))throw Error("NO_SESSION");
 return {uid:payload.sub,token:m[1],admin:payload.taskflowAdsAdmin===true};
}
async function firestore(path,token){
 const ctrl=new AbortController(),stop=setTimeout(()=>ctrl.abort(),11000);
 try{
  const r=await fetch(FIREBASE+path,{headers:token?{"Authorization":"Bearer "+token}:{},cache:"no-store",signal:ctrl.signal});
  if(r.status===404)return null;
  if(!r.ok)throw Error("FIRESTORE_ACCESS_"+r.status);
  return docData(await r.json());
 }finally{clearTimeout(stop)}
}
function normalize(v){return String(v||"").trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()}
function country(v){const x=normalize(v);return x==="guatemala"?"gt":x}
function eligibleOnPublic(pub,id,placement){
 return !!pub&&pub.campaignId===id&&pub.status==="active"&&pub.approvalStatus==="approved"&&pub.placement===placement&&Array.isArray(pub.ads)&&pub.ads.length>0;
}
// Fecha validada únicamente en el servicio privado; no publica importes ni reglas.
function validBudgetDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return false;
 const stamp=Date.parse(value+"T00:00:00Z");
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value;
}
async function sync(req,db){
 const user=await identity(req),x=await body(req),id=String(x?.campaignId||"");
 if(!VALID.test(id))throw Error("BAD_INPUT");
 const ownerUid=String(x?.ownerUid||user.uid);
 if(!VALID.test(ownerUid)||ownerUid!==user.uid&&!user.admin)throw Error("NO_ACCESS");
 const owner=await firestore("users/"+encodeURIComponent(ownerUid)+"/adsCampaigns/"+encodeURIComponent(id),user.token);
 const ref=db.from("taskflow_ads_delivery_campaigns");
 if(!owner){
  // Keep verified delivery records when the owner removes a campaign.
  const {error}=await ref.update({is_eligible:false,goal_suspended:true,synced_at:new Date().toISOString()})
   .eq("campaign_id",id).eq("owner_uid",ownerUid);
  if(error)throw Error("SYNC_FAILED");
  return {ok:true,eligible:false};
 }
 if(owner.ownerUid&&owner.ownerUid!==ownerUid)throw Error("NO_ACCESS");
 const amount=Number(owner.budget);
 const amountCents=Math.round(amount*100);
 const kind=owner.budgetType==="total"?"total":"daily";
 const strategy=["balanced","reach","steady"].includes(owner.deliveryStrategy)?owner.deliveryStrategy:"balanced";
 const cap=[1,2,3].includes(Number(owner.frequencyCap))?Number(owner.frequencyCap):3;
 const distribution=owner.budgetDistribution==="equal"?"equal":"system";
 const placement=String(owner.placement||"");
 if(!placements.has(placement)||!Number.isSafeInteger(amountCents)||amountCents<100||amountCents>1000000000)throw Error("BAD_CAMPAIGN");
 const publicly=await firestore("adsPublicCampaigns/"+encodeURIComponent(id));
 const ownIds=new Set((Array.isArray(owner.ads)?owner.ads:[]).map(a=>String(a?.id||"")).filter(x=>VALID.test(x)));
 const creatives=Array.isArray(publicly?.ads)?[...new Set(publicly.ads.map(a=>String(a?.id||"")).filter(x=>VALID.test(x)&&ownIds.has(x)))].slice(0,12):[];
 const abTest=owner.abTest===true&&creatives.length>=2;
 const interestTopics=interests(owner.interestTopics);
 const topicsMatch=JSON.stringify(interestTopics)===JSON.stringify(interests(publicly?.interestTopics));
 const requested=Number(owner.requestedImpressions);
 const requestedImpressions=Number.isSafeInteger(requested)&&requested>=0&&requested<=10000000?requested:0;
 const d=String(owner.start||""),e=String(owner.end||"");
 const start=validBudgetDate(d)?d:null,end=validBudgetDate(e)?e:null;
 const scheduled=(!d||!!start)&&(!e||!!end)&&(!start||!end||end>=start)&&(kind!=="total"||!!(start&&end));
 const fingerprintData=[placement,country(owner.country),normalize(owner.region),normalize(owner.city),normalize(owner.neighborhood),Number(owner.ageMin)||18,Number(owner.ageMax)||65,
  start,end,Number(owner.radius)||0,kind,amountCents,strategy,cap,distribution,creatives.slice().sort(),owner.objective||"awareness"];
 if(interestTopics.length)fingerprintData.push(interestTopics);
 const configDigest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(fingerprintData)));
 const configHash=[...new Uint8Array(configDigest)].map(x=>x.toString(16).padStart(2,"0")).join("");
 const {data:old,error:oldError}=await ref.select("impression_goal,goal_config_hash,goal_suspended")
  .eq("campaign_id",id).maybeSingle();
 if(oldError)throw Error("SYNC_FAILED");
 const suspended=!!(old?.goal_suspended||(Number(old?.impression_goal)>0&&old?.goal_config_hash!==configHash));
 const radiusSupported=Number(owner.radius||0)===0;
  const active=owner.status==="active"&&owner.approvalStatus==="approved"&&eligibleOnPublic(publicly,id,placement)&&scheduled&&!suspended&&radiusSupported&&topicsMatch;
 const record={
  campaign_id:id,owner_uid:ownerUid,budget_cents:amountCents,budget_type:kind,delivery_strategy:strategy,frequency_cap:cap,budget_distribution:distribution,ab_test:abTest,creative_ids:creatives,placement,requested_impressions:requestedImpressions,config_hash:configHash,goal_suspended:suspended,
  country:String(owner.country||"").slice(0,10),region:String(owner.region||"").slice(0,110),city:String(owner.city||"").slice(0,110),neighborhood:String(owner.neighborhood||"").slice(0,100),
  age_min:Math.min(120,Math.max(0,Number(owner.ageMin)||18)),age_max:Math.min(120,Math.max(0,Number(owner.ageMax)||65)),
  start_date:start,end_date:end,
  objective:String(owner.objective||"awareness").slice(0,30),is_eligible:active,synced_at:new Date().toISOString()
 };
 // Los datos de elegibilidad comercial se fijan exclusivamente en servidor.
 // La inscripción no depende de la fecha editable del perfil Firestore.
 const {data:enrolledAt,error:enrollError}=await db.rpc("taskflow_ads_enroll_advertiser",{p_owner_uid:ownerUid});
 if(enrollError||!enrolledAt)throw Error("SYNC_FAILED");
 // Un código permanente por creativo, único en todo TaskFlow ADS.
 const {data:codes,error:codesError}=await db.rpc("taskflow_ads_assign_creative_codes",{
  p_campaign_id:id,p_creative_ids:[...ownIds].slice(0,12)
 });
 if(codesError)throw Error("SYNC_FAILED");
 // Cerrar la entrega antes de recalcular la autorización, sin exposición temporal.
 const {error}=await ref.upsert({...record,is_eligible:false},{onConflict:"campaign_id"});
 if(error)throw Error("SYNC_FAILED");
 const {data:billing,error:billingError}=await db.rpc("taskflow_ads_bill_campaign",{
  p_campaign_id:id,p_owner_uid:ownerUid,p_account_created_at:enrolledAt,
  p_owner_enabled:active,p_is_approved:owner.approvalStatus==="approved"
 });
 if(billingError||!Array.isArray(billing)||billing.length!==1)throw Error("SYNC_FAILED");
 const decision=billing[0];
 return {ok:true,eligible:decision.eligible===true,billingState:decision.billing_state,
  trialExpiresAt:decision.trial_expires_at,adCodes:codes||[]};
}
// Recuperación de anuncios desde el propietario autenticado.
// Lee solamente la colección personal autorizada por Firebase; jamás importa
// documentos de terceros, presupuestos sin validar o campañas no aprobadas.
async function syncOwnerCampaigns(req,db){
 const user=await identity(req);
 const base=FIREBASE+"users/"+encodeURIComponent(user.uid)+"/adsCampaigns";
 const list=[],seen=new Set();
 let pageToken="",complete=false;
 for(let page=0;page<3;page++){
  const url=new URL(base);url.searchParams.set("pageSize","75");
  if(pageToken)url.searchParams.set("pageToken",pageToken);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),11000);
  let data;
  try{
   const r=await fetch(url.href,{headers:{"Authorization":"Bearer "+user.token},cache:"no-store",signal:controller.signal});
   if(!r.ok)throw Error("CAMPAIGNS_UNAVAILABLE");
   data=await r.json();
  }finally{clearTimeout(timer)}
  for(const doc of Array.isArray(data.documents)?data.documents:[]){
   const id=String(doc.name||"").split("/").pop();
   if(VALID.test(id)&&!seen.has(id)){seen.add(id);list.push(id)}
  }
  pageToken=String(data.nextPageToken||"");
  if(!pageToken){complete=true;break}
 }
 let synchronized=0,eligible=0,failed=0;
 // Bounded concurrency to respect Firebase read quotas and prevent bursts.
 for(let i=0;i<list.length;i+=3){
  const outcomes=await Promise.all(list.slice(i,i+3).map(async campaignId=>{
   const internal=new Request(req.url,{method:"POST",headers:{"Authorization":"Bearer "+user.token,"Content-Type":"application/json"},body:JSON.stringify({campaignId})});
   try{const result=await sync(internal,db);return {ok:result.ok===true,eligible:result.eligible===true}}
   catch(error){console.warn("ADS owner sync",error?.message||"SYNC_FAILED");return {ok:false,eligible:false}}
  }));
  synchronized+=outcomes.filter(v=>v.ok).length;
  eligible+=outcomes.filter(v=>v.eligible).length;
  failed+=outcomes.filter(v=>!v.ok).length;
 }
 // Retirar de la entrega privada las campañas eliminadas por su propietario.
 // No deshabilitar registros en caso de paginación incompleta.
 if(complete){
  const {data:known,error:readError}=await db.from("taskflow_ads_delivery_campaigns")
   .select("campaign_id").eq("owner_uid",user.uid).limit(1000);
  if(readError)throw Error("SYNC_FAILED");
  const missing=(known||[]).map(x=>x.campaign_id).filter(id=>!seen.has(id));
  if(missing.length){
   const {error:writeError}=await db.from("taskflow_ads_delivery_campaigns")
    .update({is_eligible:false,goal_suspended:true,synced_at:new Date().toISOString()})
    .eq("owner_uid",user.uid).in("campaign_id",missing);
   if(writeError)throw Error("SYNC_FAILED");
  }
 }
 return {ok:failed===0&&complete,checked:list.length,synchronized,eligible,failed,complete};
}

// Solo administradores con claim firmado pueden revisar campañas de anunciantes.
async function reconcileAdminDelivery(req,db){
 const user=await identity(req);
 if(!user.admin)throw Error("NO_ACCESS");
 const url=FIREBASE.slice(0,-1)+":runQuery";
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),17000);
 let records;
 try{
  const r=await fetch(url,{method:"POST",cache:"no-store",signal:controller.signal,
   headers:{"Authorization":"Bearer "+user.token,"Content-Type":"application/json"},
   body:JSON.stringify({structuredQuery:{from:[{collectionId:"adsCampaigns",allDescendants:true}],limit:250}})});
  if(!r.ok)throw Error("CAMPAIGNS_UNAVAILABLE_"+r.status);
  records=await r.json();
 }finally{clearTimeout(timer)}
 if(!Array.isArray(records))throw Error("CAMPAIGNS_UNAVAILABLE");
 let examined=0,approved=0,synced=0,pending=0,failed=0;
 const owners=[];
 for(const entry of records){
  const path=String(entry?.document?.name||"");
  const match=path.match(/\/documents\/users\/([A-Za-z0-9_-]{3,128})\/adsCampaigns\/([A-Za-z0-9_-]{3,128})$/);
  if(!match)continue;
  const data=docData(entry.document);
  examined++;
  if(data.status!=="active"||data.approvalStatus!=="approved"){pending++;continue}
  approved++;owners.push({ownerUid:match[1],campaignId:match[2]});
 }
 for(let i=0;i<owners.length;i+=3){
  const outcomes=await Promise.all(owners.slice(i,i+3).map(async item=>{
   try{
    const internal=new Request(req.url,{method:"POST",headers:{"Authorization":"Bearer "+user.token,"Content-Type":"application/json"},body:JSON.stringify(item)});
    const result=await sync(internal,db);
    return result.ok===true&&result.eligible===true;
   }catch(error){console.warn("ADS admin sync failed",error?.message||"SYNC_FAILED");return false}
  }));
  synced+=outcomes.filter(Boolean).length;failed+=outcomes.filter(v=>!v).length;
 }
 return {ok:failed===0,examined,approved,synchronized:synced,pending,failed,
  truncated:records.filter(x=>x.document).length>=250};
}

function comparableArea(value,kind){
 const normalized=normalize(value);
 if(kind==="region")return normalized.replace(/^(?:departamento\s+de(?:l)?|departamento|depto\.?|provincia\s+de|provincia|estado\s+de|estado|region\s+de|region)\s+/,"").trim();
 if(kind==="city")return normalized.replace(/^(?:municipio\s+de|municipio|ciudad\s+de|ciudad)\s+/,"").trim();
 return normalized;
}
function eligibleCandidate(c,context,day){
 if(!c.is_eligible||c.start_date&&c.start_date>day||c.end_date&&c.end_date<day)return false;
 if(country(c.country)&&country(c.country)!=="all"&&country(c.country)!==country(context.country))return false;
 if(c.region&&comparableArea(c.region,"region")!==comparableArea(context.region,"region"))return false;
 if(c.city&&comparableArea(c.city,"city")!==comparableArea(context.city,"city"))return false;
 if(c.neighborhood&&normalize(c.neighborhood)!==normalize(context.neighborhood))return false;
 // The bridge cannot verify the user's age. Do not advertise age verification.
 if(!Number.isFinite(context.age)){
   // No servir segmentaciones de edad reducidas sin un dato de edad verificable.
   return Number(c.age_min)<=18&&Number(c.age_max)>=65;
  }
 return context.age>=Number(c.age_min)&&context.age<=Number(c.age_max);
}
function dailyEquivalent(c){
 const budget=Math.max(1,Number(c.budget_cents)/100);
 if(c.budget_type==="daily")return budget;
 if(!c.start_date||!c.end_date)return null;
 const s=Date.parse(c.start_date+"T00:00:00Z"),e=Date.parse(c.end_date+"T00:00:00Z");
 if(!Number.isFinite(s)||!Number.isFinite(e)||e<s)return null;
 const days=Math.max(1,Math.round((e-s)/86400000)+1);
 return budget/days;
}
function sample(pool,counts,signals={}){
 const best=[];
 for(const item of pool){
  const k=item.campaign_id,shown=counts[k]||0;
  const amount=dailyEquivalent(item)||1;
  // Strategy weights modify selection opportunities only, never financial charges.
  const mode=item.delivery_strategy==="reach"?"reach":item.delivery_strategy==="steady"?"steady":"balanced";
  const exponent=mode==="reach"?.65:mode==="steady"?.45:.5;
  const repeatPenalty=mode==="reach"?.45:mode==="steady"?2:1;
  const scale=Math.pow(amount,exponent);
  const outstanding=Math.max(0,(Number(item.impression_goal)||0)-(Number(item.goal_delivered)||0));
  const daysLeft=item.end_date?Math.max(1,Math.round((Date.parse(item.end_date+"T00:00:00Z")-Date.parse(today()+"T00:00:00Z"))/86400000)+1):1;
  // Capped priority assists an authorized, outstanding goal without bypassing eligibility or frequency rules.
  const deliveryPace=outstanding>0?1+Math.min(3,Math.log1p(outstanding/daysLeft)/Math.log(15)):1;
  const measured=signals[k]||{impressions:0,clicks:0,conversions:0};
  // Objective-specific learning uses verified activity and a neutral cold-start prior.
  const clickRate=(Number(measured.clicks)+2)/(Number(measured.impressions)+100);
  const outcomeRate=(Number(measured.conversions)+.2)/(Number(measured.clicks)+50);
  const objective=String(item.objective||"awareness");
  const connected=measured.trackingConfigured===true;
  // No comercial optimization claim without measured and authenticated outcomes.
  const ratio=objective==="engagement"&&Number(measured.impressions)>=30?clickRate/.02:
   objective==="traffic"&&connected&&Number(measured.clicks)>=20?outcomeRate/.004:
   ["sales","leads","app"].includes(objective)&&connected&&Number(measured.clicks)>=20?outcomeRate/.004:1;
  const performance=Math.max(.75,Math.min(1.8,Math.sqrt(Math.max(.1,ratio))));
  const share=scale*deliveryPace*performance/(1+shown*repeatPenalty);
  // No advertiser receives a hard guarantee: exposure opportunities are finite.
  const random=-Math.log(Math.max(1e-12,crypto.getRandomValues(new Uint32Array(1))[0]/4294967296));
  const score=random/Math.max(.01,share);
  best.push({item,score});
 }
 return best.sort((a,b)=>a.score-b.score).map(x=>x.item);
}

async function presenceKey(uid){
 const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(secret.length<24)throw Error("STORE_NOT_READY");
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("taskflow-presence-v1|"+secret+"|"+uid));
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function saveDeclaredArea(req,db){
 const user=await identity(req),input=await body(req);
 if(input?.consent!==true||!input.area)throw Error("BAD_INPUT");
 const area=declaredArea(input.area);
 const {data:ok,error}=await db.rpc("taskflow_ads_audience_presence_record",{
  p_hash:await presenceKey(user.uid),p_country:area.country,p_region:area.region,p_city:area.city,p_neighborhood:DECLARED_AREA_MARKER
 });
 if(error||ok!==true)throw Error("PRESENCE_FAILED");
 return {ok:true};
}
async function presenceWithdraw(req,db){
 const user=await identity(req);
 const {error}=await db.rpc("taskflow_ads_audience_presence_withdraw",{p_hash:await presenceKey(user.uid)});
 if(error)throw Error("PRESENCE_FAILED");
 return {ok:true};
}
async function declaredAreaInventory(db){
 const since=new Date(Date.now()-30*86400000).toISOString();
 const groups=new Map();
 const count=(level,country,region="",city="")=>{
  const key=JSON.stringify([level,country,region,city]);
  const group=groups.get(key);
  if(group)group.count++;
  else groups.set(key,{level,country,region,city,neighborhood:"",count:1});
 };
 const pageSize=1000;
 for(let start=0;start<10000;start+=pageSize){
  const {data,error}=await db.from("taskflow_ads_audience_presence").select("country,region,city")
   .eq("neighborhood",DECLARED_AREA_MARKER).gte("last_seen",since).order("user_hash").range(start,start+pageSize-1);
  if(error)throw Error("GEO_UNAVAILABLE");
  for(const area of data||[]){
   count("country",area.country);
   if(area.region)count("region",area.country,area.region);
   if(area.region&&area.city)count("city",area.country,area.region,area.city);
  }
  if(!data||data.length<pageSize)break;
 }
 return [...groups.values()].filter(g=>g.count>=(g.level==="city"?5:1))
  .map(({count,...area})=>area);
}
async function availableGeoInventory(req,db){
 await identity(req);
 const areas=await declaredAreaInventory(db);
 return {source:"consented-active-taskflow-users",basis:"declared-ad-areas",activeWithinDays:30,
  thresholds:{country:1,region:1,city:5},areas};
}
function campaignGeoAvailable(c,geos){
 const countryCode=String(c.country||"").trim().toUpperCase();
 const region=normalize(c.region),city=normalize(c.city),neighborhood=normalize(c.neighborhood);
 const allCountries=countryCode==="ALL"||!countryCode;
 return geos.some(a=>{
  if(!allCountries&&a.country!==countryCode)return false;
  if(neighborhood)return a.level==="neighborhood"&&normalize(a.neighborhood)===neighborhood&&normalize(a.region)===region&&normalize(a.city)===city;
  if(city)return a.level==="city"&&normalize(a.city)===city&&normalize(a.region)===region;
  if(region)return a.level==="region"&&normalize(a.region)===region;
  return a.level==="country";
 });
}

async function choose(req,db){
 const x=await body(req);
 const placement=String(x.placement||""),slot=String(x.slot||"");
 const rawSession=String(x.sessionId||"");
 if(!placements.has(placement)||! /^[A-Za-z0-9_-]{2,50}$/.test(slot)||! /^[a-fA-F0-9-]{24,80}$/.test(rawSession))throw Error("BAD_INPUT");
 try{await identity(req)}catch(_){return {campaignId:null}}
 const context=declaredArea(x.audienceVersion===1?x.area:null);
 const selectedInterests=interests(x.audienceVersion===1?x.interests:null);
 // No aceptar edades autodeclaradas por el navegador como verificación de edad.
 const d=today(),hashArray=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(rawSession+"|"+d));
 const hash=[...new Uint8Array(hashArray)].map(x=>x.toString(16).padStart(2,"0")).join("");
 // Filtrar el país en la base privada antes del límite, para que las campañas
 // internacionales no queden desplazadas por campañas de otras geografías.
 const geoCountry=/^[A-Z]{2}$/.test(String(context.country||"").toUpperCase())?String(context.country).toUpperCase():"";
 const geoFilter=["ALL","all",""];
 if(geoCountry){geoFilter.push(geoCountry,geoCountry.toLowerCase());if(geoCountry==="GT")geoFilter.push("Guatemala","guatemala")}
 const {data:rows,error}=await db.from("taskflow_ads_delivery_campaigns")
  .select("campaign_id,placement,country,region,city,neighborhood,age_min,age_max,start_date,end_date,budget_cents,budget_type,delivery_strategy,frequency_cap,budget_distribution,ab_test,creative_ids,is_eligible,objective,impression_goal,goal_delivered,goal_suspended,billing_state,billing_trial_expires_at,billing_last_checked_at")
  .eq("is_eligible",true).eq("placement",placement).in("country",geoFilter).limit(180);
 if(error)throw Error("SELECT_FAILED");
 // La zona publicitaria se elige voluntariamente y no deriva del reloj ni del GPS.
 let pool=(rows||[]).filter(c=>{
  if(c.billing_state==="trial"&&(!c.billing_trial_expires_at||Date.parse(c.billing_trial_expires_at)<=Date.now()))return false;
  if(c.billing_state==="paid"){
   const checked=String(c.billing_last_checked_at||"");
   const day=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Guatemala",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
   const checkDay=checked?new Intl.DateTimeFormat("en-CA",{timeZone:"America/Guatemala",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(checked)):"";
   if(day!==checkDay)return false;
  }
  return !c.goal_suspended&&(!c.impression_goal||Number(c.goal_delivered)<Number(c.impression_goal))&&eligibleCandidate(c,context,d)&&dailyEquivalent(c)!==null;
 });
 if(!pool.length)return {campaignId:null};
 const ids=pool.map(c=>c.campaign_id);
 const {data:recent,error:recerr}=await db.from("taskflow_ads_delivery_selections")
  .select("campaign_id").eq("session_hash",hash).eq("day",d).not("impression_at","is",null).in("campaign_id",ids).limit(500);
 if(recerr)throw Error("SELECT_FAILED");
 const counts=Object.create(null);
 for(const c of recent||[])counts[c.campaign_id]=(counts[c.campaign_id]||0)+1;
 pool=pool.filter(c=>(counts[c.campaign_id]||0)<([1,2,3].includes(Number(c.frequency_cap))?Number(c.frequency_cap):3));
 if(!pool.length)return {campaignId:null};
 const [signalsResponse,keysResponse]=await Promise.all([
  db.rpc("taskflow_ads_recent_quality",{p_ids:ids,p_since:new Date(Date.now()-14*86400000).toISOString()}),
  db.from("taskflow_ads_conversion_keys").select("campaign_id").in("campaign_id",ids)
 ]);
 if(signalsResponse.error||keysResponse.error)throw Error("SELECT_FAILED");
 const connected=new Set((keysResponse.data||[]).map(x=>x.campaign_id));
 const quality=Object.fromEntries((signalsResponse.data||[]).map(x=>[x.campaign_id,
  {...x,trackingConfigured:connected.has(x.campaign_id)}]));
 for(const campaign of sample(pool,counts,quality).slice(0,8)){
  const pub=await firestore("adsPublicCampaigns/"+encodeURIComponent(campaign.campaign_id));
  if(!eligibleOnPublic(pub,campaign.campaign_id,placement))continue;
  if(!matchingInterests(pub.interestTopics,selectedInterests))continue;
  // Verify the published targeting as well, not only the synchronized record.
  if(!eligibleCandidate({...campaign,...{
   country:pub.country||"",region:pub.region||"",city:pub.city||"",neighborhood:pub.neighborhood||"",
   age_min:Number(pub.ageMin)||18,age_max:Number(pub.ageMax)||65,
   start_date:pub.start||null,end_date:pub.end||null,
   is_eligible:true
  }},context,d))continue;
  const owned=new Set(Array.isArray(campaign.creative_ids)?campaign.creative_ids:[]);
  const usable=(Array.isArray(pub.ads)?pub.ads:[]).filter(a=>VALID.test(String(a?.id||""))&&owned.has(String(a.id)));
  if(!usable.length)continue;
  // Stable A/B assignment per session and campaign; never expose weighting.
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(hash+"|"+campaign.campaign_id+"|creative"));
  const seed=new DataView(digest).getUint32(0,false);
  const choices=(campaign.ab_test||campaign.budget_distribution==="equal")?usable:usable.filter(a=>Number(a.width)>0&&Number(a.width)===Math.max(...usable.map(v=>Number(v.width)||0)));
  const variants=choices.length?choices:usable;
  const creative=variants[seed%variants.length];
  const audienceCountry=/^[A-Z]{2}$/.test(String(context.country||"").toUpperCase())?String(context.country).toUpperCase():"";
  const {data:token,error:failed}=await db.rpc("taskflow_ads_register_international_selection",
   {p_hash:hash,p_campaign_id:campaign.campaign_id,p_placement:placement,p_slot:slot,p_creative_id:String(creative.id),p_audience_country:audienceCountry});
  if(failed)throw Error("SELECT_FAILED");
  if(typeof token==="string"&&/^[a-f0-9-]{36}$/i.test(token)){
   const {data:registered,error:codeError}=await db.from("taskflow_ads_creative_codes")
    .select("ad_code").eq("campaign_id",campaign.campaign_id)
    .eq("creative_id",String(creative.id)).maybeSingle();
   if(codeError)throw Error("SELECT_FAILED");
   if(!/^[0-9]{6}$/.test(String(registered?.ad_code||"")))continue;
   return {campaignId:campaign.campaign_id,adId:String(creative.id),
    adCode:String(registered.ad_code),selectionToken:token};
  }
 }
 return {campaignId:null};
}

async function confirmDelivery(req,db){
 const x=await body(req);
 const token=String(x?.selectionToken||""),id=String(x?.campaignId||""),
  creative=String(x?.adId||""),slot=String(x?.slot||""),session=String(x?.sessionId||"");
 const type=String(x?.event||"");
 if(!/^[a-f0-9-]{36}$/i.test(token)||!VALID.test(id)||!VALID.test(creative)
  ||!/^[A-Za-z0-9_-]{2,50}$/.test(slot)||!/^[a-fA-F0-9-]{24,80}$/.test(session)
  ||!["impression","click"].includes(type))throw Error("BAD_INPUT");
 const {data:row,error}=await db.from("taskflow_ads_delivery_selections")
  .select("session_hash,campaign_id,creative_id,slot,day,selected_at,impression_at,click_at")
  .eq("selection_token",token).maybeSingle();
 if(error)throw Error("CONFIRM_FAILED");
 if(!row||row.campaign_id!==id||row.creative_id!==creative||row.slot!==slot)return {ok:false};
 const signed=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(session+"|"+row.day));
 const hash=[...new Uint8Array(signed)].map(b=>b.toString(16).padStart(2,"0")).join("");
 if(hash!==row.session_hash)return {ok:false};
 if(type==="impression"&&!row.impression_at){
  const pub=await firestore("adsPublicCampaigns/"+encodeURIComponent(id));
  if(!pub||pub.status!=="active"||pub.approvalStatus!=="approved"
    ||!Array.isArray(pub.ads)||!pub.ads.some(a=>a.id===creative))return {ok:false};
 }
 // Single atomic database transaction performs deduplication, quota and click-order enforcement.
 const {data:status,error:writeError}=await db.rpc("taskflow_ads_confirm_creative_selection",
  {p_token:token,p_hash:hash,p_campaign_id:id,p_creative_id:creative,p_slot:slot,p_event:type});
 if(writeError)throw Error("CONFIRM_FAILED");
 if(status==="recorded"||status==="duplicate")return {ok:true,duplicate:status==="duplicate"};
 return {ok:false,reason:status==="quota_reached"?"LIMIT_REACHED":"NOT_CONFIRMED"};
}

// Metrics backed only by confirmed selection records. Prior unverified logs remain separate.
async function verifiedMetrics(req,db){
 const user=await identity(req),query=new URL(req.url).searchParams;
 const ids=[...new Set(String(query.get("campaignIds")||"").split(",").filter(Boolean))];
 if(!ids.length||ids.length>12||ids.some(id=>!VALID.test(id)))throw Error("BAD_INPUT");
 const campaigns={},authorized=[];
 for(const id of ids){
  if(user.admin||await firestore("users/"+encodeURIComponent(user.uid)+"/adsCampaigns/"+encodeURIComponent(id),user.token))
   authorized.push(id);
  else campaigns[id]={error:"Sin acceso"};
 }
 if(!authorized.length)return {periodDays:30,campaigns,source:"verified-selections",exact:true};
 // SQL computes exact counts without a page cap; source is confirmed ledger, never selections alone.
 const {data:rows,error}=await db.rpc("taskflow_ads_metrics_exact",
  {p_ids:authorized,p_since:new Date(Date.now()-30*86400000).toISOString()});
 if(error)throw Error("METRICS_FAILED");
 const {data:targets,error:targetError}=await db.from("taskflow_ads_delivery_campaigns")
  .select("campaign_id,owner_uid,requested_impressions,impression_goal,goal_delivered,goal_approved_at,goal_suspended,is_eligible,end_date")
  .in("campaign_id",authorized);
 if(targetError)throw Error("METRICS_FAILED");
 const [goals,keys]=await Promise.all([
  db.rpc("taskflow_ads_goal_metrics",{p_ids:authorized,p_since:new Date(Date.now()-30*86400000).toISOString()}),
  db.from("taskflow_ads_conversion_keys").select("campaign_id").in("campaign_id",authorized)
 ]);
 if(goals.error||keys.error)throw Error("METRICS_FAILED");
 const perGoal=Object.fromEntries((goals.data||[]).map(x=>[x.campaign_id,x]));
 const configured=new Set((keys.data||[]).map(x=>x.campaign_id));
 const quota=Object.fromEntries((targets||[]).map(x=>[x.campaign_id,x]));
 for(const id of authorized){
  const row=(rows||[]).find(x=>x.campaign_id===id);
  if(!row)throw Error("METRICS_FAILED");
  const t=quota[id],imps=Number(row.impressions)||0,clicks=Number(row.clicks)||0;
  const requested=Math.max(0,Number(t?.requested_impressions)||0);
  const goal=Math.max(0,Number(t?.impression_goal)||0),delivered=Math.max(0,Number(t?.goal_delivered)||0);
  const overdue=goal>0&&delivered<goal&&t?.end_date&&t.end_date<today();
  const status=!t?"not_synced":overdue?"overdue":t.goal_suspended?"suspended":goal>0?(delivered>=goal?"completed":"authorized"):requested>0?"requested":"no_goal";
  campaigns[id]={
   impressions:imps,clicks,ctr:imps?Math.round(clicks*10000/imps)/100:0,
   byAd:row.by_ad||{},byDay:row.by_day||{},partial:false,
   requestedImpressions:requested,authorizedGoal:goal,deliveredSinceAuthorization:delivered,
   outstandingImpressions:goal>0?Math.max(0,goal-delivered):null,
   goalStatus:status,goalApprovedAt:t?.goal_approved_at||null,scheduledEnd:t?.end_date||null,
   distributionSynchronized:!!t,
   trackingConfigured:configured.has(id),
   goalEvents:{visits:Number(perGoal[id]?.visits)||0,leads:Number(perGoal[id]?.leads)||0,
    purchases:Number(perGoal[id]?.purchases)||0,installs:Number(perGoal[id]?.installs)||0,
    revenueGtqMinor:Number(perGoal[id]?.revenue_gtq_minor)||0}
  };
 }
 return {periodDays:30,campaigns,source:"verified-selections",exact:true};
}


// Capacity authorization is restricted to verified ADS administrators.
// Authorization enables a capped delivery target, not a fabricated past result.
async function authorizeImpressions(req,db){
 const admin=await identity(req);
 if(!admin.admin)throw Error("NO_ACCESS");
 const x=await body(req),id=String(x?.campaignId||""),uid=String(x?.ownerUid||"");
 if(!VALID.test(id)||!VALID.test(uid))throw Error("BAD_INPUT");
 const owner=await firestore("users/"+encodeURIComponent(uid)+"/adsCampaigns/"+encodeURIComponent(id),admin.token);
 if(!owner||owner.ownerUid!==uid)return {ok:false,reason:"CAMPAIGN_NOT_FOUND"};
 if(owner.status!=="active"||owner.approvalStatus!=="approved")
  return {ok:false,reason:"CAMPAIGN_NOT_APPROVED"};
 // The application cannot verify precise age or distance. Never authorize
 // contracted targets against unsupported radius/age assertions.
 if((Number(owner.radius)||0)!==0||(Number(owner.ageMin)||18)!==18||(Number(owner.ageMax)||65)!==65)
  return {ok:false,reason:"AUDIENCE_NOT_PROVEN"};
 const pub=await firestore("adsPublicCampaigns/"+encodeURIComponent(id));
 if(!eligibleOnPublic(pub,id,String(owner.placement||"")))
  return {ok:false,reason:"CAMPAIGN_NOT_PUBLISHED"};
 // The SQL procedure serializes approvals competing for the same placement,
 // requires seven days of confirmed events, and rejects unsupported targeting.
 const {data:status,error}=await db.rpc("taskflow_ads_authorize_impression_goal",
  {p_campaign_id:id,p_owner_uid:uid});
 if(error)throw Error("GOAL_FAILED");
 return {ok:status==="AUTHORIZED"||status==="ALREADY_AUTHORIZED",
  reason:typeof status==="string"?status:"GOAL_FAILED"};
}


async function digestHex(value){
 const raw=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return [...new Uint8Array(raw)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
async function conversionSetup(req,db){
 const user=await identity(req),x=await body(req),id=String(x?.campaignId||"");
 const action=String(x?.action||"create");
 if(!VALID.test(id)||!["create","rotate"].includes(action))throw Error("BAD_INPUT");
 const owner=await firestore("users/"+encodeURIComponent(user.uid)+"/adsCampaigns/"+encodeURIComponent(id),user.token);
 if(!owner||owner.ownerUid!==user.uid)throw Error("NO_ACCESS");
 if(!["traffic","sales","leads","app"].includes(String(owner.objective||"")))
  return {ok:false,reason:"OBJECTIVE_NOT_SUPPORTED"};
 const {data:distribution,error:syncError}=await db.from("taskflow_ads_delivery_campaigns")
  .select("campaign_id").eq("campaign_id",id).eq("owner_uid",user.uid).maybeSingle();
 if(syncError)throw Error("STORE_NOT_READY");
 if(!distribution)return {ok:false,reason:"SYNCHRONIZATION_REQUIRED"};
 const {data:present,error}=await db.from("taskflow_ads_conversion_keys").select("campaign_id").eq("campaign_id",id).maybeSingle();
 if(error)throw Error("STORE_NOT_READY");
 if(present&&action==="create")return {ok:true,configured:true,created:false};
 const secret="tfads_v1_"+[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,"0")).join("");
 const {error:write}=await db.from("taskflow_ads_conversion_keys").upsert({
  campaign_id:id,owner_uid:user.uid,secret_hash:await digestHex(secret),rotated_at:new Date().toISOString()
 },{onConflict:"campaign_id"});
 if(write)throw Error("STORE_NOT_READY");
 return {ok:true,configured:true,created:true,apiKey:secret};
}
async function conversionRecord(req,db){
 const bearer=(req.headers.get("authorization")||"").match(/^Bearer (tfads_v1_[a-f0-9]{64})$/);
 if(!bearer)throw Error("NO_ACCESS");
 const x=await body(req),id=String(x?.campaignId||""),token=String(x?.clickId||"");
 const event=String(x?.event||""),externalId=String(x?.externalId||"").trim();
 const currency=String(x?.currency||"GTQ").toUpperCase(),amount=Number(x?.valueMinor??0);
 if(!VALID.test(id)||!/^[a-f0-9-]{36}$/i.test(token)||!["visit","lead","purchase","install"].includes(event)
 ||externalId.length<4||externalId.length>128||!Number.isSafeInteger(amount)||amount<0||amount>1000000000000
 ||!/^[A-Z]{3}$/.test(currency))throw Error("BAD_INPUT");
 const {data:stored,error}=await db.from("taskflow_ads_conversion_keys").select("secret_hash").eq("campaign_id",id).maybeSingle();
 if(error)throw Error("STORE_NOT_READY");
 if(!stored)return {ok:false};
 const check=await digestHex(bearer[1]),reference=String(stored.secret_hash||"");
 let diff=0;for(let i=0;i<64;i++)diff|=check.charCodeAt(i)^reference.charCodeAt(i);
 if(diff!==0||reference.length!==64)return {ok:false};
 // Merchant references are hashed before storage; no email, phone or customer ID is stored.
 const referenceHash=await digestHex(id+"|"+event+"|"+externalId);
 const {data:status,error:saveError}=await db.rpc("taskflow_ads_record_goal_event",{
  p_campaign_id:id,p_token:token,p_event:event,p_external_hash:referenceHash,p_value_minor:amount,p_currency:currency
 });
 if(saveError)throw Error("RECORD_FAILED");
 return {ok:status==="RECORDED"||status==="DUPLICATE",
  duplicate:status==="DUPLICATE",reason:status==="RECORDED"||status==="DUPLICATE"?undefined:"NOT_ATTRIBUTED"};
}


// Identificador para reportes, visible solo al propietario o administrador acreditado.
async function readCreativeCodes(req,db){
 const user=await identity(req),x=await body(req),id=String(x?.campaignId||"");
 if(!VALID.test(id))throw Error("BAD_INPUT");
 const ownerUid=user.admin&&VALID.test(String(x?.ownerUid||""))?String(x.ownerUid):user.uid;
 const owned=await firestore("users/"+encodeURIComponent(ownerUid)+"/adsCampaigns/"+encodeURIComponent(id),user.token);
 if(!owned)throw Error("NO_ACCESS");
 const {data,error}=await db.from("taskflow_ads_creative_codes")
  .select("creative_id,ad_code").eq("campaign_id",id).limit(12);
 if(error)throw Error("SELECT_FAILED");
 return {campaignId:id,ads:data||[]};
}

async function accountAdvertiserStatus(req,db){
 const user=await identity(req);
 const {data:campaigns,error}=await db.from("taskflow_ads_delivery_campaigns")
  .select("campaign_id,billing_state,billing_trial_expires_at,is_eligible")
  .eq("owner_uid",user.uid).limit(250);
 if(error)throw Error("SELECT_FAILED");
 const ids=(campaigns||[]).map(c=>c.campaign_id);
 let codes=[];
 if(ids.length){
  const {data,error:codesError}=await db.from("taskflow_ads_creative_codes")
   .select("campaign_id,creative_id,ad_code").in("campaign_id",ids).limit(3000);
  if(codesError)throw Error("SELECT_FAILED");
  codes=data||[];
 }
 const {data:grant,error:grantError}=await db.from("taskflow_ads_trial_grants")
  .select("campaign_id,created_at,expires_at").eq("owner_uid",user.uid).maybeSingle();
 if(grantError)throw Error("SELECT_FAILED");
 return {campaigns:campaigns||[],adCodes:codes,trial:grant||null};
}

async function findAdByReportCode(req,db){
 const user=await identity(req);
 if(!user.admin)throw Error("NO_ACCESS");
 const code=String(new URL(req.url).searchParams.get("code")||"");
 if(!/^[0-9]{6}$/.test(code))throw Error("BAD_INPUT");
 const {data,error}=await db.from("taskflow_ads_creative_codes")
   .select("campaign_id,creative_id,assigned_at").eq("ad_code",code).maybeSingle();
 if(error)throw Error("SELECT_FAILED");
 const campaignId=data?.campaign_id||null;
 let ownerUid=null;
 if(campaignId){
  const {data:entry,error:ownerError}=await db.from("taskflow_ads_delivery_campaigns")
   .select("owner_uid").eq("campaign_id",campaignId).maybeSingle();
  if(ownerError)throw Error("SELECT_FAILED");
  ownerUid=entry?.owner_uid||null;
 }
 return {code,found:!!data,campaignId,ownerUid,
  adId:data?.creative_id||null,assignedAt:data?.assigned_at||null};
}

Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 if(origin&&origin!==ORIGIN)return response(req,403,{error:"NOT_ALLOWED"});
 if(req.method==="OPTIONS"){
  const headers=new Headers({"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Authorization,Content-Type","Cache-Control":"no-store"});
  return new Response(null,{status:204,headers});
 }
 const path=new URL(req.url).pathname;
 if(path.endsWith("/geo/presence"))return response(req,410,{error:"LOCATION_IS_LOCAL"});
 if(req.method!=="POST"&&!(req.method==="GET"&&(path.endsWith("/metrics")||path.endsWith("/geo/available")||path.endsWith("/admin/report-code"))))return response(req,405,{error:"METHOD_NOT_ALLOWED"});
 try{
  const db=client();
  if(req.method==="GET"&&path.endsWith("/metrics"))return response(req,200,await verifiedMetrics(req,db));
  if(req.method==="GET"&&path.endsWith("/geo/available"))return response(req,200,await availableGeoInventory(req,db));
  if(req.method==="GET"&&path.endsWith("/admin/report-code"))return response(req,200,await findAdByReportCode(req,db));
  if(path.endsWith("/codes"))return response(req,200,await readCreativeCodes(req,db));
  if(path.endsWith("/account/status"))return response(req,200,await accountAdvertiserStatus(req,db));
  if(path.endsWith("/audience/area"))return response(req,200,await saveDeclaredArea(req,db));
  if(path.endsWith("/geo/withdraw"))return response(req,200,await presenceWithdraw(req,db));
  if(path.endsWith("/sync/owned"))return response(req,200,await syncOwnerCampaigns(req,db));
  if(path.endsWith("/sync/admin"))return response(req,200,await reconcileAdminDelivery(req,db));
  if(path.endsWith("/sync"))return response(req,200,await sync(req,db));
  if(path.endsWith("/choose")||path.endsWith("/choose/v161"))return response(req,200,await choose(req,db));
  if(path.endsWith("/confirm"))return response(req,200,await confirmDelivery(req,db));
  if(path.endsWith("/goal/authorize"))return response(req,200,await authorizeImpressions(req,db));
  if(path.endsWith("/conversion/setup"))return response(req,200,await conversionSetup(req,db));
  if(path.endsWith("/conversion/record"))return response(req,200,await conversionRecord(req,db));
  return response(req,404,{error:"NOT_FOUND"});
 }catch(e){
  // Do not disclose campaign budgets, rules, internals, error strings or payment data.
  console.warn("ADS private delivery:",e?.message||"unknown");
  return response(req,e?.message==="BAD_INPUT"?400:e?.message==="NO_SESSION"?401:e?.message==="NO_ACCESS"?403:503,{error:"REQUEST_UNAVAILABLE"});
 }
});
