import {put,list} from '@vercel/blob';
import {createHash} from 'node:crypto';
import {jwtVerify,createRemoteJWKSet} from 'jose';
const PID='taskflow-b0ece',ORIGIN='https://novaprimegt-coder.github.io',BASE='tfads-metrics/v1/';
const PRIVATE_CONFIRM='https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-delivery/confirm';
const URL_BASE='https://firestore.googleapis.com/v1/projects/'+PID+'/databases/(default)/documents/';
const JWKS=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const valid=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{3,128}$/.test(x);
const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Cache-Control':'no-store','Vary':'Origin'};
function output(res,status,data){Object.entries(headers).forEach(([k,v])=>res.setHeader(k,v));res.status(status);return status===204?res.end():res.json(data)}
function value(v){if(!v||typeof v!=='object')return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('arrayValue'in v)return(v.arrayValue.values||[]).map(value);if('mapValue'in v){const o={};for(const[k,x]of Object.entries(v.mapValue.fields||{}))o[k]=value(x);return o}return null}
function decode(doc){const o={};for(const[k,v]of Object.entries(doc?.fields||{}))o[k]=value(v);return o}
async function doc(path,token){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);try{return await fetch(URL_BASE+path,{headers:token?{Authorization:'Bearer '+token}:{},cache:'no-store',signal:ctrl.signal})}finally{clearTimeout(timer)}}
async function identity(req){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return null;try{const token=h.slice(7),v=await jwtVerify(token,JWKS,{algorithms:['RS256'],issuer:'https://securetoken.google.com/'+PID,audience:PID,clockTolerance:15}),uid=String(v.payload.sub||'');return valid(uid)?{uid,token,admin:v.payload.taskflowAdsAdmin===true}:null}catch(_){return null}}
async function liveCampaign(id){const r=await doc('adsPublicCampaigns/'+encodeURIComponent(id));if(!r.ok)return null;const c=decode(await r.json());return c.status==='active'&&c.approvalStatus==='approved'&&Array.isArray(c.ads)?c:null}
async function collect(id){let cursor='',more=true,pages=0;const result={impressions:0,clicks:0,byAd:{},byDay:{},partial:false},cutoff=Date.now()-30*86400000;
 while(more&&pages<30){
  const p=await list({prefix:BASE+id+'/',limit:1000,...(cursor?{cursor}:{})});
  for(const file of p.blobs||[]){
   const parts=String(file.pathname||'').split('/'),day=parts[3],type=parts[4],ad=parts[5];
   if(parts.length!==7||!/^\d{8}$/.test(day)||!valid(ad)||!['impression','click'].includes(type))continue;
   const stamp=Date.UTC(Number(day.slice(0,4)),Number(day.slice(4,6))-1,Number(day.slice(6,8)));
   if(stamp<cutoff-86400000)continue;
   const key=type==='impression'?'impressions':'clicks';result[key]++;
   if(!result.byAd[ad])result.byAd[ad]={impressions:0,clicks:0};result.byAd[ad][key]++;
   if(!result.byDay[day])result.byDay[day]={impressions:0,clicks:0};result.byDay[day][key]++;
  }
  more=!!p.hasMore&&!!p.cursor;cursor=p.cursor;pages++;
 }
 result.partial=more;result.ctr=result.impressions?Math.round(result.clicks/result.impressions*10000)/100:0;
 return result;
}
export default async function handler(req,res){
 if(req.method==='OPTIONS')return output(res,204);
 if(req.headers.origin&&req.headers.origin!==ORIGIN)return output(res,403,{error:'Origen no autorizado'});
 if(req.method==='POST'){
  if(req.headers.origin!==ORIGIN)return output(res,403,{error:'Origen inválido'});
  const x=req.body||{},id=x.campaignId,ad=x.adId,type=x.event,slot=x.slot,session=x.sessionId,token=x.selectionToken;
  if(!valid(id)||!valid(ad)||!['impression','click'].includes(type)||typeof slot!=='string'||! /^[a-zA-Z0-9_-]{2,50}$/.test(slot)||typeof session!=='string'||! /^[a-f0-9-]{24,80}$/i.test(session)||typeof token!=='string'||! /^[a-f0-9-]{36}$/i.test(token))return output(res,400,{error:'Evento inválido'});
  try{
   const c=await liveCampaign(id);if(!c||!c.ads.some(x=>x.id===ad))return output(res,404,{error:'Campaña no publicada'});
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9000);
   let verified;
   try{const response=await fetch(PRIVATE_CONFIRM,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selectionToken:token,campaignId:id,adId:ad,slot,sessionId:session,event:type}),signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('UNCONFIRMED');verified=await response.json()}finally{clearTimeout(timeout)}
   if(verified?.ok!==true)return output(res,403,{error:'Entrega no confirmada'});
   const day=new Date().toISOString().slice(0,10).replace(/-/g,'');
   const key=createHash('sha256').update([id,ad,slot,token,type].join(':')).digest('hex');
   const path=BASE+id+'/'+day+'/'+type+'/'+ad+'/'+key+'.json';
   try{await put(path,JSON.stringify({campaignId:id,adId:ad,placement:c.placement,type,at:new Date().toISOString()}),{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false})}
   catch(e){if(/conflict|exists|overwrite|409/i.test(String(e.message||'')))return output(res,200,{stored:true,duplicate:true});throw e}
   return output(res,200,{stored:true});
  }catch(e){console.warn('ADS telemetry:',String(e.message||e));return output(res,503,{error:'No se registró el evento'})}
 }
 if(req.method==='GET'){
  const user=await identity(req);if(!user)return output(res,401,{error:'Autenticación requerida'});
  const ids=[...new Set(String(req.query.campaignIds||'').split(',').filter(Boolean))].slice(0,12);
  if(!ids.length||ids.some(id=>!valid(id)))return output(res,400,{error:'Campañas inválidas'});
  const campaigns={};
  for(const id of ids){
   try{
    if(!user.admin){const r=await doc('users/'+encodeURIComponent(user.uid)+'/adsCampaigns/'+encodeURIComponent(id),user.token);if(!r.ok){campaigns[id]={error:'Sin acceso'};continue}}
    campaigns[id]=await collect(id);
   }catch(e){campaigns[id]={error:'Métricas temporalmente no disponibles'};console.warn('ADS metric read:',String(e.message||e))}
  }
  return output(res,200,{periodDays:30,campaigns,description:'Eventos registrados durante 30 días, no personas únicas ni ventas.'});
 }
 return output(res,405,{error:'Método no admitido'});
}
