/* TaskFlow ADS Manager · módulos operativos. Cada módulo posee una función distinta. */
(function(){
'use strict';
const METRICS_URL='https://taskflow-ads-media.vercel.app/api/analytics';
const VERIFIED_METRICS_URL='https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-delivery/metrics';
const PUBLIC_URL='https://firestore.googleapis.com/v1/projects/taskflow-b0ece/databases/(default)/documents/adsPublicCampaigns?pageSize=100';
const number=v=>new Intl.NumberFormat('es-GT').format(Number(v)||0);
const money=v=>new Intl.NumberFormat('es-GT',{style:'currency',currency:'GTQ'}).format(Number(v)||0);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=v=>{try{const u=new URL(String(v||''));return u.protocol==='https:'&&!u.username&&!u.password?u.href:''}catch(_){return ''}};
const objective={awareness:'Reconocimiento',traffic:'Tráfico',engagement:'Interacción',leads:'Clientes potenciales',sales:'Ventas',app:'Aplicación'};
const cta={awareness:'Conocer la marca',traffic:'Visitar sitio web',engagement:'Participar',leads:'Solicitar información',sales:'Comprar ahora',app:'Descargar aplicación'};
const specs={banner:'1200×180 / 2400×360',entry:'1080×1920 / 2160×3840',interaction:'1080×1920 / 2160×3840'};
let current=null,view='',metricCache=null,metricOwner='',metricKey='',metricAt=0,pendingMetrics=null,revision=0,campaignMetricsRevision=0;
let audiencePresets=[],audienceOwner='',audienceLoaded=false;
const mounted=new WeakSet();
function section(title,body){return '<section class="tf-tool-panel"><div class="tf-tool-heading"><h3>'+esc(title)+'</h3></div>'+body+'</section>'}
function mini(value,label,small){return '<article class="tf-tool-kpi"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(small?'<small>'+esc(small)+'</small>':'')+'</article>'}
function wrap(title,description,body){return body}
function campaignIds(api){return [...new Set(api.campaigns.map(x=>x.id).filter(id=>/^[a-zA-Z0-9_-]{3,128}$/.test(id)))];}
async function getMetrics(api,refresh){
 const owner=api.currentUser?.id||'';
 if(!owner||!api.fbAuth?.currentUser||api.fbAuth.currentUser.uid!==owner)throw new Error('Sesión no disponible.');
 const ids=campaignIds(api),key=ids.slice().sort().join(',');
 if(!refresh&&metricCache&&metricOwner===owner&&metricKey===key&&Date.now()-metricAt<45000)return metricCache;
 if(!refresh&&pendingMetrics&&metricOwner===owner&&metricKey===key)return pendingMetrics;
 metricOwner=owner;metricKey=key;
 const job=(async()=>{
  const token=await api.fbAuth.currentUser.getIdToken(),all={},failures=[];
  for(let i=0;i<ids.length;i+=12){
   const batch=ids.slice(i,i+12);
   try{
    const controller=new AbortController(),stop=setTimeout(()=>controller.abort(),20000);
    let response;
    try{response=await fetch(METRICS_URL+'?campaignIds='+encodeURIComponent(batch.join(',')),{headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',signal:controller.signal})}
    finally{clearTimeout(stop)}
    if(!response.ok)throw new Error('Servidor HTTP '+response.status);
    const data=await response.json();
    for(const id of batch){const item=data.campaigns?.[id];if(item&&!item.error)all[id]=item;else failures.push(id)}
   }catch(e){failures.push(...batch);console.warn('TaskFlow ADS métricas:',e.message||e)}
  }
  const result={campaigns:all,failed:failures,at:Date.now(),periodDays:30};
  if(metricOwner===owner&&metricKey===key){metricCache=result;metricAt=Date.now()}
  return result;
 })();
 pendingMetrics=job;
 try{return await job}finally{if(pendingMetrics===job)pendingMetrics=null}
}

/* Rendimiento por campaña y por anuncio:
   se utiliza únicamente la medición confirmada del servidor, sin combinar campañas. */
function campaignPerformanceMarkup(m,adId){
 if(!m||m.error)return '<span class="tf-performance-unavailable" title="No se pudo verificar la medición">— <small>Sin datos verificados</small></span>';
 const src=adId?(m.byAd&&m.byAd[adId]||{impressions:0,clicks:0}):m;
 const impressions=Number(src.impressions),clicks=Number(src.clicks);
 if(!Number.isFinite(impressions)||!Number.isFinite(clicks)||impressions<0||clicks<0)return '<span class="tf-performance-unavailable">— <small>Datos no disponibles</small></span>';
 const ctr=impressions>0?100*clicks/impressions:0;
 const stat=(label,value)=>'<span class="tf-performance-stat"><small>'+label+'</small><b>'+esc(value)+'</b></span>';
 return '<span class="tf-performance-stats" aria-label="Impresiones '+esc(number(impressions))+', clics '+esc(number(clicks))+', CTR '+esc(ctr.toFixed(2))+' por ciento">'+
 stat('Impresiones',number(impressions))+stat('Clics',number(clicks))+stat('CTR',ctr.toFixed(2)+' %')+'</span>'+
 '<small class="tf-performance-foot'+(m.partial?' tf-performance-partial':'')+'">'+
 (m.partial?'Medición parcial: faltan eventos':'Últimos 30 días · confirmados')+'</small>';
}
async function paintCampaignMetrics(api,refresh=false){
 const holder=document.getElementById('campaignBody');
 if(!holder||!api?.currentUser?.id||!holder.querySelector('[data-tf-campaign-metric]'))return;
 const owner=api.currentUser.id,ticket=++campaignMetricsRevision;
 try{
  const data=await getVerifiedMetrics(api);
  if(ticket!==campaignMetricsRevision||!holder.isConnected||owner!==current?.currentUser?.id)return;
  holder.querySelectorAll('[data-tf-campaign-metric]').forEach(cell=>{
   const id=cell.getAttribute('data-tf-campaign-metric');
   const adId=cell.getAttribute('data-tf-ad-metric')||'';
   if(!api.campaigns.some(c=>c.id===id&&(adId?Array.isArray(c.ads)&&c.ads.some(a=>a.id===adId):true)))return;
   cell.innerHTML=campaignPerformanceMarkup(data.campaigns[id],adId);
  });
 }catch(error){
  if(ticket!==campaignMetricsRevision||!holder.isConnected)return;
  holder.querySelectorAll('[data-tf-campaign-metric]').forEach(cell=>{
   cell.innerHTML='<span class="tf-performance-unavailable">— <small>No fue posible consultar el servidor</small></span>';
  });
  console.warn('TaskFlow ADS rendimiento por campaña:',error?.message||error);
 }
}

function totals(metrics){
 const r={impressions:0,clicks:0,known:0,partial:false};
 for(const m of Object.values(metrics.campaigns)){r.known++;r.impressions+=Number(m.impressions)||0;r.clicks+=Number(m.clicks)||0;if(m.partial)r.partial=true}
 r.ctr=r.impressions?r.clicks/r.impressions*100:0;return r;
}
function metricValue(m,key){return m&&!m.error&&Number.isFinite(Number(m[key]))?number(m[key]):'—'}
function csvCell(s){return '"'+String(s==null?'':s).replace(/"/g,'""')+'"'}
function csvDownload(name,rows){const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),3000)}

/* Resultados recientes por campaña: reutiliza únicamente la consulta verificada del Resumen. */
function paintRecentCampaignMetrics(data){
 document.querySelectorAll('[data-tf-recent-metric]').forEach(node=>{
  const id=node.getAttribute('data-tf-recent-metric');
  const m=data?.campaigns?.[id];
  const impressions=Number(m?.impressions),clicks=Number(m?.clicks);
  if(!m||m.error||!Number.isFinite(impressions)||!Number.isFinite(clicks)||impressions<0||clicks<0){
   node.innerHTML='<small>Resultados no disponibles</small>';
   return;
  }
  const ctr=impressions>0?100*clicks/impressions:0;
  node.innerHTML='<small>Últimos 30 días</small><strong>'+esc(number(impressions))+' impresiones · '+esc(number(clicks))+' clics</strong>'+
   '<small>CTR '+esc(ctr.toFixed(2))+' %'+(m.partial?' · Datos parciales':'')+'</small>';
 });
}

async function paintOverview(api,refresh){current=api;
 const overview=document.getElementById('overviewView');if(!overview||!api.currentUser)return;
 let slot=document.getElementById('tfAdsLiveOverview');
 if(!slot){slot=document.createElement('section');slot.id='tfAdsLiveOverview';slot.className='tf-tool-overview';const anchor=overview.querySelector('.dashboard');if(anchor)anchor.insertAdjacentElement('beforebegin',slot);else overview.appendChild(slot)}
 const token=++revision;slot.innerHTML='<div class="tf-tool-topline"><strong>Rendimiento publicitario real · últimos 30 días</strong><span><button type="button" data-tf-overview-refresh>Actualizar estadísticas</button> <button type="button" data-tf-overview-delivery>Comprobar entrega</button></span></div><div class="tf-tool-kpis">'+mini('…','Impresiones')+mini('…','Clics en anuncios')+mini('…','CTR')+'</div>';
 if(!mounted.has(slot)){mounted.add(slot);slot.addEventListener('click',e=>{if(e.target.closest('[data-tf-overview-refresh]'))void paintOverview(current,true);else if(e.target.closest('[data-tf-overview-delivery]'))void checkDelivery(current);else{const b=e.target.closest('[data-tf-delivery-resync]');if(b)void resyncDelivery(current,b)}})}
 try{
  const data=await getVerifiedMetrics(api);
  if(token!==revision||!slot.isConnected||api.currentUser.id!==current?.currentUser?.id)return;
  const t=totals(data),empty=!api.campaigns.length;
  slot.innerHTML='<div class="tf-tool-topline"><strong>Rendimiento publicitario real · últimos 30 días</strong><span><button type="button" data-tf-overview-refresh>Actualizar estadísticas</button> <button type="button" data-tf-overview-delivery>Comprobar entrega</button></span></div><div class="tf-tool-kpis">'+mini(empty?'0':t.known?number(t.impressions):'—','Impresiones','Confirmadas por el servidor')+mini(empty?'0':t.known?number(t.clicks):'—','Clics en anuncios','Confirmados por el servidor')+mini(empty?'0 %':t.known?t.ctr.toFixed(2)+' %':'—','CTR','Clics ÷ impresiones')+'</div>'+(data.failed.length?'<p class="tf-tool-warning">No se pudieron consultar '+data.failed.length+' campaña(s). Los valores no disponibles no se han inventado.</p>':'')+(t.partial?'<p class="tf-tool-warning">El servicio devolvió una medición parcial.</p>':'')+'<p class="tf-tool-note">Los clics no acreditan ventas, formularios enviados ni instalaciones. Sin costo de entrega confirmado no se calcula CPC o gasto.</p>';
  paintRecentCampaignMetrics(data);
 }catch(e){paintRecentCampaignMetrics({campaigns:{}});if(slot.isConnected)slot.innerHTML='<div class="tf-tool-error">No se pudieron consultar las métricas: '+esc(e.message)+'</div>'}
}

async function resyncDelivery(api,button){
 const c=api.campaigns.find(x=>x.id===button.dataset.tfDeliveryResync);
 if(!c||c.status!=='active'||c.approvalStatus!=='approved')return;
 button.disabled=true;button.textContent='Resincronizando…';
 try{await api.syncPublicCampaign(c);api.toast('Publicación actualizada. Verificando…');await checkDelivery(api)}
 catch(e){button.disabled=false;button.textContent='Resincronizar publicación';api.toast('No se pudo sincronizar: '+(e.message||'Comprueba la conexión.'))}
}
async function assetWorks(ad,placement){
 const url=safe(ad?.src),meta=ad?.mediaMeta||{};
 if(!url||placement==='banner'&&meta.kind==='video')return false;
 return await new Promise(resolve=>{
  let ended=false,media=null;
  const done=ok=>{if(ended)return;ended=true;clearTimeout(timer);if(media){media.onload=null;media.onerror=null;media.onloadedmetadata=null;if(media.tagName==='VIDEO'){media.removeAttribute('src');media.load()}}resolve(ok)};
  const timer=setTimeout(()=>done(false),9500);
  media=meta.kind==='video'?document.createElement('video'):new Image();
  if(meta.kind==='video'){
   media.preload='metadata';
   media.onloadedmetadata=()=>done(placement!=='banner'&&[1080,2160].includes(media.videoWidth)&&media.videoHeight===media.videoWidth*16/9&&Number.isFinite(media.duration)&&media.duration>=9.95&&media.duration<=180.05);
  }else{
   media.onload=()=>done(placement==='banner'?([1200,2400].includes(media.naturalWidth)&&media.naturalHeight===media.naturalWidth*.15):([1080,2160].includes(media.naturalWidth)&&media.naturalHeight===media.naturalWidth*16/9));
  }
  media.onerror=()=>done(false);
  media.src=url;
 });
}
async function checkDelivery(api){
 if(!api?.currentUser)return;
 const owner=api.currentUser.id,overview=document.getElementById('tfAdsLiveOverview');
 if(!overview)return;
 let target=document.getElementById('tfAdsDeliveryCheck');
 if(!target){target=document.createElement('div');target.id='tfAdsDeliveryCheck';overview.appendChild(target)}
 target.innerHTML='<p class="tf-tool-loading">Comprobando catálogo público y archivos de los anuncios…</p>';
 try{
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),13000);
  let resp;try{resp=await fetch(PUBLIC_URL,{method:'GET',credentials:'omit',cache:'no-store',signal:ctrl.signal})}finally{clearTimeout(timeout)}
  if(!resp.ok)throw new Error('El catálogo público respondió HTTP '+resp.status);
  const data=await resp.json(),ids=new Set((data.documents||[]).map(d=>String(d.name||'').split('/').pop()));
  if(api.currentUser.id!==owner||!target.isConnected)return;
  const rows=[];
  for(const c of api.campaigns){
   let message='',kind='warn',canRepair=false;
   if(c.status!=='active')message='Borrador o pausada. No se entrega.';
   else if(c.approvalStatus!=='approved')message='Falta aprobación administrativa. No se entrega.';
   else if(!ids.has(c.id)){message='Aprobada, pero no figura en el catálogo público.';canRepair=true}
   else if(!Array.isArray(c.ads)||!c.ads.length)message='No hay anuncios con archivos.';
   else{
    const checks=await Promise.all(c.ads.slice(0,12).map(a=>assetWorks(a,c.placement)));
    if(checks.every(Boolean)){message='Publicada. Todos los archivos cargaron correctamente.';kind='ok'}
    else message='Publicada, pero algún archivo no carga o incumple las dimensiones.';
   }
   rows.push('<article class="tf-tool-delivery-row"><div><b>'+esc(c.name)+'</b><span class="'+(kind==='ok'?'tf-tool-success':'tf-tool-warning')+'">'+esc(message)+'</span></div>'+(canRepair?'<button type="button" data-tf-delivery-resync="'+esc(c.id)+'">Resincronizar publicación</button>':'')+'</article>');
  }
  target.innerHTML='<div class="tf-tool-delivery-panel"><h3>Comprobación del catálogo</h3><p class="tf-tool-note">Estado de publicación y de carga de archivos. Fechas, permisos y ubicación pueden limitar la entrega final.</p>'+(rows.join('')||'<p class="tf-tool-empty">No hay campañas para comprobar.</p>')+'</div>';
 }catch(e){target.innerHTML='<p class="tf-tool-error">Comprobación no completada: '+esc(e.message||'Error de conexión')+'</p>'}
}

function audienceRows(api,filter){
 const list=api.campaigns.filter(c=>([c.name,c.country,c.region,c.city].join(' ')).toLocaleLowerCase('es').includes(filter.toLocaleLowerCase('es')));
 return list.map(c=>{
  const peers=api.campaigns.filter(p=>p.id!==c.id&&p.country===c.country&&p.region===c.region&&p.city===c.city&&Math.max(Number(p.ageMin)||18,Number(c.ageMin)||18)<=Math.min(Number(p.ageMax)||65,Number(c.ageMax)||65));
  const geo=[c.city,c.region,c.country].filter(Boolean).join(', ')||'Sin región';
  return '<article class="tf-tool-row"><div><b>'+esc(c.name)+'</b><span>'+esc(geo)+' · Edades '+esc((c.ageMin||18)+'–'+(c.ageMax||65))+'</span><small>'+esc(c.status)+' · '+esc(c.approvalStatus==='approved'?'Aprobada':c.approvalStatus==='rejected'?'Rechazada':'Pendiente de aprobación')+' · '+esc(objective[c.objective]||c.objective||'')+'</small>'+(peers.length?'<small class="tf-tool-warning">Coincide en zona y edades con '+peers.length+' campaña(s); revisa si compiten por el mismo público.</small>':'')+'</div><button type="button" data-tf-action="audience-edit" data-id="'+esc(c.id)+'">Ajustar segmentación</button></article>'
 }).join('')||'<p class="tf-tool-empty">No hay campañas para este filtro.</p>';
}
function audiences(api){
 const locs=new Set(api.campaigns.map(c=>[c.country,c.region,c.city].join('|')));
 const overlap=api.campaigns.reduce((n,c,i)=>n+api.campaigns.slice(i+1).filter(p=>p.country===c.country&&p.region===c.region&&p.city===c.city&&Math.max(Number(p.ageMin)||18,Number(c.ageMin)||18)<=Math.min(Number(p.ageMax)||65,Number(c.ageMax)||65)).length,0);
 return wrap('Editor de audiencias','Compara zonas, edades y posibles solapamientos. Modifica la segmentación de una campaña desde este módulo.',
 '<div class="tf-tool-kpis">'+mini(api.campaigns.length,'Campañas segmentadas')+mini(locs.size,'Zonas configuradas')+mini(overlap,'Cruces de segmentación','Coincidencias de ubicación y edades')+'</div>'+
 section('Zonas geográficas disponibles','<p class="tf-tool-note">Se muestran únicamente países y zonas con actividad reciente de usuarios autenticados que autorizaron su ubicación. País y región: desde 1 usuario; ciudades: desde 5; barrios: desde 10. No representa descargas totales, audiencia contratada ni impresiones garantizadas.</p><button type="button" data-tf-action="geo-refresh">Actualizar zonas ahora</button><div id="tfAdsLiveGeoAreas" aria-live="polite"><p class="tf-tool-loading">Consultando zonas activas…</p></div>')+
 section('Audiencias guardadas','<div id="tfAdsAudiencePresets"><p class="tf-tool-loading">Consultando audiencias guardadas…</p></div>')+
 section('Segmentación por campaña','<label class="tf-tool-search">Buscar campaña o ubicación<input type="search" data-tf-search="audiences" placeholder="Nombre, departamento o municipio" autocomplete="off"></label><div data-tf-results="audiences">'+audienceRows(api,'')+'</div>')+
 '<p class="tf-tool-note">Las coincidencias son una comparación de configuración, no un cálculo de tamaño de audiencia ni de personas únicas.</p>');
}


const LIVE_GEO_AREAS_URL='https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-delivery/geo/available';

let geoAreasWatch=0,verifiedGeoAreas=[],verifiedGeoAt=0,verifiedGeoUid='',verifiedGeoLoading=null;
function activeGeoAreas(api){
 return api?.currentUser?.id===verifiedGeoUid&&Date.now()-verifiedGeoAt<120000?verifiedGeoAreas:[];
}
function isVerifiedAudienceGeo(areas,country,region,city){
 if(!/^[A-Z]{2}$/.test(country)||!areas.some(a=>a.level==='country'&&a.country===country))return false;
 if(city&&!region)return false;
 if(region&&!areas.some(a=>a.level==='region'&&a.country===country&&a.region===region))return false;
 if(city&&!areas.some(a=>a.level==='city'&&a.country===country&&a.region===region&&a.city===city))return false;
 return true;
}
async function fetchActiveGeoAreas(api,force=false){
 const uid=api?.currentUser?.id,user=api?.fbAuth?.currentUser;
 if(!uid||user?.uid!==uid)throw Error('Inicia sesión para consultar ubicaciones reales.');
 if(verifiedGeoUid!==uid){verifiedGeoUid=uid;verifiedGeoAreas=[];verifiedGeoAt=0;verifiedGeoLoading=null}
 if(!force&&Date.now()-verifiedGeoAt<60000)return verifiedGeoAreas;
 if(verifiedGeoLoading)return verifiedGeoLoading;
 verifiedGeoLoading=(async()=>{
  const token=await user.getIdToken(),ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),14000);
  let response;
  try{response=await fetch(LIVE_GEO_AREAS_URL,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',signal:ctrl.signal,headers:{Authorization:'Bearer '+token}})}
  finally{clearTimeout(timer)}
  if(!response.ok)throw Error('Inventario geográfico no disponible.');
  const data=await response.json();
  if(data?.source!=='consented-active-taskflow-users'||data.activeWithinDays!==30||!Array.isArray(data.areas))
   throw Error('El inventario recibido no tiene verificación suficiente.');
  const valid=data.areas.filter(a=>a&&['country','region','city','neighborhood'].includes(a.level)&&/^[A-Z]{2}$/.test(String(a.country||'')));
  const countries=new Set(valid.filter(a=>a.level==='country').map(a=>a.country));
  const verified=valid.filter(a=>{
   if(!countries.has(a.country))return false;
   if(a.level==='region')return typeof a.region==='string'&&a.region.length>0;
   if(a.level==='city')return typeof a.city==='string'&&a.city.length>0&&valid.some(p=>p.level==='region'&&p.country===a.country&&p.region===a.region);
   if(a.level==='neighborhood')return typeof a.neighborhood==='string'&&a.neighborhood.length>0&&valid.some(p=>p.level==='city'&&p.country===a.country&&p.region===a.region&&p.city===a.city);
   return true;
  });
  if(verifiedGeoUid!==uid||api.fbAuth?.currentUser?.uid!==uid)throw Error('Cambió la sesión.');
  verifiedGeoAreas=verified;verifiedGeoAt=Date.now();
  return verified;
 })().catch(e=>{if(verifiedGeoUid===uid){verifiedGeoAreas=[];verifiedGeoAt=0}throw e})
  .finally(()=>{verifiedGeoLoading=null});
 return verifiedGeoLoading;
}
function fillVerifiedAudienceSelect(select,values,placeholder){
 if(!select)return;
 const selected=select.value;
 const entries=[{value:'',label:placeholder},...values];
 select.replaceChildren(...entries.map(v=>{const o=document.createElement('option');o.value=v.value;o.textContent=v.label;return o}));
 select.value=values.some(x=>x.value===selected)?selected:'';
 select.disabled=!values.length;
}
function hydrateAudienceGeoForm(api){
 const form=api.root.querySelector('#tfAudiencePresetForm');if(!form)return;
 const areas=activeGeoAreas(api),country=form.elements.namedItem('country'),
  region=form.elements.namedItem('region'),city=form.elements.namedItem('city');
 if(!country||!region||!city)return;
 const countryCodes=[...new Set(areas.filter(a=>a.level==='country').map(a=>a.country))];
 let names;try{names=new Intl.DisplayNames(['es'],{type:'region'})}catch(_){}
 const countries=countryCodes.map(v=>({value:v,label:(names?.of(v)||v)+' ('+v+')'})).sort((a,b)=>a.label.localeCompare(b.label,'es'));
 fillVerifiedAudienceSelect(country,countries,'Sin países con usuarios verificados');
 const regions=[...new Set(areas.filter(a=>a.level==='region'&&a.country===country.value).map(a=>a.region))]
  .map(v=>({value:v,label:v})).sort((a,b)=>a.label.localeCompare(b.label,'es'));
 fillVerifiedAudienceSelect(region,regions,'Todo el país');
 const cities=[...new Set(areas.filter(a=>a.level==='city'&&a.country===country.value&&a.region===region.value).map(a=>a.city))]
  .map(v=>({value:v,label:v})).sort((a,b)=>a.label.localeCompare(b.label,'es'));
 fillVerifiedAudienceSelect(city,cities,'Toda la región');
 // Los campos de región y ciudad pueden quedar vacíos para escoger una audiencia amplia.
 region.disabled=!country.value||!regions.length;city.disabled=!region.value||!cities.length;
 const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=!country.value||!areas.length;
 if(!form.dataset.verifiedGeoEvents){
  form.dataset.verifiedGeoEvents='1';
  form.addEventListener('change',e=>{
   if(e.target?.name==='country'){region.value='';city.value='';hydrateAudienceGeoForm(api)}
   else if(e.target?.name==='region'){city.value='';hydrateAudienceGeoForm(api)}
  });
 }
}
function refreshSavedAudienceEvidence(api){
 const areas=activeGeoAreas(api);
 for(const p of audiencePresets){
  const node=api.root.querySelector('[data-tf-preset-geo="'+String(p.id).replace(/[^A-Za-z0-9_-]/g,'')+'"]');
  if(node)node.textContent=isVerifiedAudienceGeo(areas,String(p.country||'').toUpperCase(),String(p.region||''),String(p.city||''))
   ?'Destino actualmente verificado':'Destino guardado: sin usuarios verificados en la zona';
 }
}
async function loadLiveGeoAreas(api){
 const target=api.root.querySelector('#tfAdsLiveGeoAreas'),uid=api.currentUser?.id;
 if(!target)return;
 target.innerHTML='<p class="tf-tool-loading">Comprobando ubicaciones autorizadas recientes…</p>';
 try{
  const active=await fetchActiveGeoAreas(api,true);
  if(view!=='audiences'||current?.currentUser?.id!==uid||!target.isConnected)return;
  const countryCodes=[...new Set(active.filter(x=>x.level==='country').map(x=>x.country))];
  let names=null;try{names=new Intl.DisplayNames(['es'],{type:'region'})}catch(_){}
  const cards=countryCodes.sort((a,b)=>String(names?.of(a)||a).localeCompare(String(names?.of(b)||b),'es'))
   .map(code=>{
    const lines=active.filter(x=>x.country===code&&x.level!=='country').map(x=>{
     const label=x.level==='region'?'Región':x.level==='city'?'Ciudad':'Localidad / barrio';
     return '<span class="tf-geo-inventory-area"><b>'+label+':</b> '+esc([x.region,x.city,x.neighborhood].filter(Boolean).join(' · '))+'</span>';
    });
    return '<article class="tf-tool-row"><div><b>'+esc(names?.of(code)||code)+' ('+esc(code)+')</b><small>País con actividad reciente verificada</small><div class="tf-geo-inventory-areas">'+(lines.join('')||'<small>Sin zonas más específicas habilitadas.</small>')+'</div></div></article>';
   }).join('');
  target.innerHTML='<div class="tf-tool-kpis">'+mini(countryCodes.length,'Países verificados')+
   mini(active.filter(x=>x.level==='region').length,'Regiones verificadas')+
   mini(active.filter(x=>x.level==='city').length,'Ciudades verificadas')+
   mini(active.filter(x=>x.level==='neighborhood').length,'Barrios verificados')+'</div>'+
   (cards||'<p class="tf-tool-empty">No existen países con presencia verificada en los últimos 30 días. Esto no demuestra que no haya descargas.</p>');
  hydrateAudienceGeoForm(api);refreshSavedAudienceEvidence(api);
 }catch(_){
  if(target.isConnected)target.innerHTML='<p class="tf-tool-warning">No se pudo verificar la actividad real. Países y zonas no verificados no están disponibles para crear o aplicar audiencias.</p>';
  if(view==='audiences'&&current?.currentUser?.id===uid){hydrateAudienceGeoForm(api);refreshSavedAudienceEvidence(api)}
 }
}

function watchLiveGeoAreas(){
 if(geoAreasWatch)return;
 geoAreasWatch=setInterval(()=>{if(view==='audiences'&&current)void loadLiveGeoAreas(current)},180000);
}
function presetRef(api){return api.fbDb.collection('users').doc(api.currentUser.id).collection('adsManager').doc('business')}

function presetMarkup(api){
 const choices=api.campaigns.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
 const active=activeGeoAreas(api);
 const rows=audiencePresets.map(p=>{
  const supported=isVerifiedAudienceGeo(active,String(p.country||'').toUpperCase(),String(p.region||''),String(p.city||''));
  return '<article class="tf-tool-row"><div><b>'+esc(p.name)+'</b><span>'+esc([p.city,p.region,p.country].filter(Boolean).join(', ')||'Ubicación general')+' · Edades '+esc(p.ageMin+'–'+p.ageMax)+'</span><small data-tf-preset-geo="'+esc(p.id)+'">'+(supported?'Destino actualmente verificado':'Destino guardado: sin usuarios verificados en la zona')+'</small></div><div class="tf-tool-budget-edit"><label>Campaña destinataria<select data-tf-preset-target="'+esc(p.id)+'"><option value="">Seleccionar campaña</option>'+choices+'</select></label><button type="button" data-tf-action="audience-apply" data-id="'+esc(p.id)+'" '+(!api.campaigns.length?'disabled':'')+'>Aplicar segmentación</button><button type="button" data-tf-action="audience-delete" data-id="'+esc(p.id)+'">Eliminar plantilla</button></div></article>';
 }).join('');
 return '<div class="tf-tool-kpis">'+mini(audiencePresets.length,'Audiencias guardadas','No son usuarios activos')+'</div>'+
 '<form class="tf-tool-form tf-tool-audience-form" id="tfAudiencePresetForm"><label>Nombre de audiencia<input name="presetName" maxlength="80" required placeholder="Ej. Huehuetenango · 18–35"></label><div class="tf-tool-form-grid"><label>País<select name="country" required disabled><option value="">Consultando países verificados…</option></select></label><label>Departamento<select name="region" disabled><option value="">Toda la nación</option></select></label><label>Ciudad o municipio<select name="city" disabled><option value="">Toda la región</option></select></label><label>Edad mínima<input name="ageMin" type="number" min="18" max="65" value="18" required></label><label>Edad máxima<input name="ageMax" type="number" min="18" max="65" value="65" required></label></div><button type="submit" disabled>Guardar nueva audiencia</button><p role="status" id="tfAudiencePresetMessage" class="tf-tool-note">Solo se pueden crear audiencias en zonas con actividad reciente verificada.</p></form>'+
 '<div class="tf-tool-preset-list">'+(rows||'<p class="tf-tool-empty">No hay audiencias guardadas. Solo podrás crearlas cuando exista presencia geográfica verificada.</p>')+'</div>';
}

async function loadAudiencePresets(api,force){
 const uid=api.currentUser.id;
 if(audienceOwner!==uid){audienceOwner=uid;audiencePresets=[];audienceLoaded=false}
 if(!audienceLoaded||force){
  try{
   const snap=await api.withDeadline(presetRef(api).get({source:'server'}),14000,'No se pudo consultar las audiencias.');
   if(audienceOwner!==uid)return;
   const rows=snap.data()?.audiencePresets;
   audiencePresets=Array.isArray(rows)?rows.filter(x=>x&&/^[a-zA-Z0-9_-]{3,128}$/.test(String(x.id||''))).slice(0,50):[];
   audienceLoaded=true;
  }catch(e){
   console.warn('ADS audiencias guardadas:',e);
   const target=api.root.querySelector('#tfAdsAudiencePresets');
   if(target){target.innerHTML='<p class="tf-tool-warning">No se pudieron consultar las audiencias guardadas. Comprueba la conexión e inténtalo nuevamente.</p>'}
   return;
  }
 }
 const target=api.root.querySelector('#tfAdsAudiencePresets');
 if(target&&view==='audiences'&&current?.currentUser.id===uid){target.innerHTML=presetMarkup(api);hydrateAudienceGeoForm(api)}
}
async function saveAudiencePreset(){
 const api=current,form=api.root.querySelector('#tfAudiencePresetForm'),label=api.root.querySelector('#tfAudiencePresetMessage');
 if(!form)return;
 const d=new FormData(form),name=String(d.get('presetName')||'').trim(),country=String(d.get('country')||'').trim(),region=String(d.get('region')||'').trim(),city=String(d.get('city')||'').trim(),ageMin=Number(d.get('ageMin')),ageMax=Number(d.get('ageMax'));
 if(name.length<3||!country||country.length>40||!Number.isInteger(ageMin)||!Number.isInteger(ageMax)||ageMin<18||ageMax>65||ageMin>ageMax){label.textContent='Revisa el nombre, el país y las edades de 18 a 65 años.';return}
 if(audiencePresets.length>=50){label.textContent='Se alcanzó el máximo de 50 audiencias guardadas.';return}
 const btn=form.querySelector('[type="submit"]');btn.disabled=true;label.textContent='Guardando audiencia…';
 const newPreset={id:'aud_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9),name,country,region,city,ageMin,ageMax};
 const uid=api.currentUser.id,ref=presetRef(api);
 try{
  const areas=await fetchActiveGeoAreas(api,true);
  if(!isVerifiedAudienceGeo(areas,country.toUpperCase(),region,city))throw Error('GEO_AUDIENCE_UNVERIFIED');
  if(current?.currentUser?.id!==uid)throw Error('ACCOUNT_CHANGED');
  let saved=[];
  await api.withDeadline(api.fbDb.runTransaction(async tx=>{
   const snap=await tx.get(ref);
   const stored=snap.exists&&Array.isArray(snap.data()?.audiencePresets)?snap.data().audiencePresets:[];
   if(snap.exists&&snap.data()?.ownerUid!==uid)throw new Error('ACCOUNT_OWNERSHIP_MISMATCH');
   if(stored.length>=50)throw new Error('AUDIENCE_LIMIT_REACHED');
   saved=[...stored,newPreset];
   const updatedAt=firebase.firestore.FieldValue.serverTimestamp();
   if(snap.exists){
    tx.update(ref,{audiencePresets:saved,updatedAt});
   }else{
    // Restablece el documento comercial faltante con el propietario autenticado.
    tx.set(ref,{
     ownerUid:uid,ownerName:api.currentUser.name||'',
     ownerEmail:api.currentUser.email||'',businessName:api.currentUser.company||'',
     country:'GT',accountStatus:'active',
     audiencePresets:saved,createdAt:updatedAt,updatedAt
    });
   }
  }),20000,'No se confirmó el guardado.');
  if(current?.currentUser.id!==uid)return;
  audiencePresets=saved;
  api.root.querySelector('#tfAdsAudiencePresets').innerHTML=presetMarkup(api);
  api.toast('Audiencia guardada y disponible para otras campañas.');
 }catch(e){
  console.warn('ADS guardado de audiencias:',e?.code||e?.message);
  label.textContent=e?.message==='GEO_AUDIENCE_UNVERIFIED'?'No existe actividad real verificada en esa ubicación. No se guardó ninguna audiencia.':
   e?.message==='AUDIENCE_LIMIT_REACHED'?'Se alcanzó el máximo de 50 audiencias guardadas.':
   e?.code==='permission-denied'?'No tienes permiso para guardar esta audiencia. Comprueba la sesión.':
   'No se pudo guardar la audiencia. Comprueba la conexión e inténtalo nuevamente.';
  btn.disabled=false;
 }
}
async function deleteAudiencePreset(button,id){
 const api=current,p=audiencePresets.find(x=>x.id===id);if(!p)return;
 if(button.dataset.confirm!=='true'){button.dataset.confirm='true';button.textContent='Confirmar eliminación';return}
 button.disabled=true;const next=audiencePresets.filter(x=>x.id!==id);
 try{await api.withDeadline(presetRef(api).update({audiencePresets:next,updatedAt:firebase.firestore.FieldValue.serverTimestamp()}),20000,'No se confirmó la eliminación.');audiencePresets=next;api.root.querySelector('#tfAdsAudiencePresets').innerHTML=presetMarkup(api);api.toast('Plantilla de audiencia eliminada.')}
 catch(e){console.warn('ADS eliminación de audiencia:',e?.code||e?.message);api.toast('No se pudo eliminar la audiencia. Comprueba la conexión e inténtalo nuevamente.');button.disabled=false;button.dataset.confirm='false';button.textContent='Eliminar plantilla'}
}
async function applyAudiencePreset(button,id){
 const api=current,p=audiencePresets.find(x=>x.id===id);
 const select=api.root.querySelector('[data-tf-preset-target="'+id+'"]'),c=api.campaigns.find(x=>x.id===select?.value);
 if(!p||!c){api.toast('Selecciona una campaña para aplicar la audiencia.');return}
 button.disabled=true;button.textContent='Aplicando…';
 const data={country:String(p.country||'').toUpperCase(),region:p.region||'',city:p.city||'',ageMin:p.ageMin,ageMax:p.ageMax,updatedAt:new Date().toISOString()};
 if(c.approvalStatus==='approved')data.approvalStatus='pending';
 try{
  const areas=await fetchActiveGeoAreas(api,true);
  if(!isVerifiedAudienceGeo(areas,data.country,data.region,data.city))throw Error('No existen usuarios recientes verificados en la zona guardada.');
  const ref=api.fbDb.collection('users').doc(api.currentUser.id).collection('adsCampaigns').doc(c.id);
  const batch=api.fbDb.batch();batch.update(ref,data);
  if(c.approvalStatus==='approved')batch.delete(api.fbDb.collection('adsPublicCampaigns').doc(c.id));
  await api.withDeadline(batch.commit(),20000,'La segmentación no pudo confirmarse.');
  Object.assign(c,data);const synced=await api.syncPrivateDelivery?.(c.id);api.saveCampaigns();api.renderAll();if(!synced)console.warn('ADS: audiencia aplicada; sincronización privada aún sin confirmar');api.toast('Audiencia aplicada. '+(data.approvalStatus==='pending'?'La campaña requiere nueva aprobación.':'Configuración actualizada.'));
  if(view==='audiences'){api.root.innerHTML=audiences(api);void loadAudiencePresets(api,false)}
 }catch(e){api.toast('No se pudo aplicar: '+(e.message||'Comprueba la conexión.'));button.disabled=false;button.textContent='Aplicar segmentación'}
}

function creativeData(api){const arr=[];api.campaigns.forEach(c=>(c.ads||[]).forEach(a=>arr.push({campaign:c,ad:a,media:a.mediaMeta||{}})));return arr}
function creativeRows(api,filter){
 const entries=creativeData(api).filter(x=>([x.ad.name,x.campaign.name,x.campaign.placement,x.media.kind].join(' ')).toLowerCase().includes(filter.toLowerCase()));
 return entries.map(({campaign:c,ad:a,media:m})=>{
  const src=safe(a.src),image=src&&m.kind!=='video',video=src&&m.kind==='video',spec=specs[c.placement]||'Formato sin definir';
  const valid=!!src&&((c.placement==='banner'&&([1200,2400].includes(Number(m.width))&&Number(m.height)===Number(m.width)*.15))||(c.placement!=='banner'&&([1080,2160].includes(Number(m.width))&&Number(m.height)===Number(m.width)*16/9)))&&(m.kind!=='video'||(Number(m.duration)>=9.95&&Number(m.duration)<=180.05));
  return '<article class="tf-tool-creative"><div class="tf-tool-media">'+(image?'<img loading="lazy" decoding="async" alt="Creativo de '+esc(c.name)+'" src="'+esc(src)+'">':video?'<span class="tf-tool-play">VIDEO</span>':'<span>Sin archivo</span>')+'</div><div class="tf-tool-creative-data"><b>'+esc(a.name||'Anuncio')+'</b><span>'+esc(c.name)+'</span><small>'+esc((m.width||'—')+' × '+(m.height||'—'))+' · '+esc(spec)+'</small><small>'+esc(c.placement==='banner'?'Banner':c.placement==='entry'?'Ingreso':'Interacción')+' · '+esc(objective[c.objective]||'')+'</small><strong class="'+(valid?'tf-tool-success':'tf-tool-warning')+'">'+(valid?'Archivo conforme a formato':'Archivo pendiente o no conforme')+'</strong><div class="tf-tool-buttons"><button type="button" data-tf-action="creative-preview" data-id="'+esc(c.id)+'" data-ad="'+esc(a.id)+'" '+(!src?'disabled':'')+'>Vista previa</button><button type="button" data-tf-action="creative-edit" data-id="'+esc(c.id)+'" data-ad="'+esc(a.id)+'">Editar creativo</button></div></div></article>'
 }).join('')||'<p class="tf-tool-empty">No hay anuncios que coincidan.</p>';
}

/* Conjuntos: cada conjunto es una campaña operativa con segmentación y presupuesto propios.
   campaignGroup solo agrupa los conjuntos de una campaña superior, sin publicar metadatos. */
function adSets(api){
 const grouped=new Map();
 for(const c of api.campaigns){
  const name=String(c.campaignGroup||c.name||'Sin agrupar').trim().slice(0,120)||'Sin agrupar';
  if(!grouped.has(name))grouped.set(name,[]);
  grouped.get(name).push(c);
 }
 const cards=[...grouped.entries()].map(([name,sets])=>{
  const daily=sets.filter(c=>c.budgetType==='daily'&&c.status==='active').reduce((sum,c)=>sum+(Number(c.budget)||0),0);
  const rows=sets.map(c=>{
   const id=esc(c.id);
   return '<article class="tf-adset-entry"><div class="tf-adset-entry-title"><b>'+esc(c.name)+'</b><small>'+esc(c.status==='active'?'Activa':c.status==='paused'?'Pausada':'Borrador')+' · '+esc(c.approvalStatus==='approved'?'Aprobado':c.approvalStatus==='rejected'?'Rechazado':'En revisión')+'</small></div>'+
    '<div class="tf-adset-details">'+esc(c.placement||'—')+' · '+esc(c.budgetType==='total'?'Total':'Diario')+' '+esc(money(c.budget))+' · '+esc([c.city,c.region,c.country].filter(Boolean).join(', ')||'Ubicación general')+'</div>'+
    '<div class="tf-adset-entry-tools"><label>Campaña superior<input data-tf-adset-group="'+id+'" maxlength="120" value="'+esc(c.campaignGroup||c.name||'')+'" aria-label="Agrupación de '+esc(c.name)+'"></label>'+
    '<button type="button" data-tf-action="adset-group-save" data-id="'+id+'">Guardar grupo</button>'+
    '<button type="button" data-tf-action="adset-edit" data-id="'+id+'">Editar conjunto</button>'+
    '<button type="button" data-tf-action="adset-duplicate" data-id="'+id+'">Duplicar</button></div></article>';
  }).join('');
  return '<section class="tf-tool-panel tf-adset-group"><div class="tf-tool-heading"><h3>'+esc(name)+'</h3></div><p class="tf-tool-note">'+sets.length+' conjunto(s) · '+money(daily)+' en presupuestos diarios activos. Los presupuestos totales se contabilizan por separado.</p><div class="tf-adset-group-entries">'+rows+'</div><button type="button" data-tf-action="adset-new" data-group="'+esc(name)+'">Crear conjunto en este grupo</button></section>';
 }).join('');
 return '<div class="tf-tool-kpis">'+mini(grouped.size,'Campañas superiores')+mini(api.campaigns.length,'Conjuntos operativos')+mini(api.campaigns.filter(c=>c.status==='active'&&c.approvalStatus==='approved').length,'Conjuntos activos y aprobados')+'</div>'+
 '<p class="tf-tool-note">Cada conjunto conserva su propia audiencia, presupuesto, calendario, formato y anuncios. La agrupación es administrativa; no combina ni redistribuye presupuestos de diferentes conjuntos.</p>'+
 '<div class="tf-adsets-groups">'+(cards||'<p class="tf-tool-empty">Todavía no hay conjuntos. Crea una campaña para configurar el primero.</p>')+'</div>'+
 '<button type="button" data-tf-action="adset-new">Crear conjunto nuevo</button>';
}
async function saveAdSetGroup(btn,id){
 const api=current,c=api?.campaigns.find(x=>x.id===id);
 if(!api||!c||!api.currentUser)return;
 const input=api.root.querySelector('[data-tf-adset-group="'+CSS.escape(id)+'"]');
 const name=String(input?.value||'').trim();
 if(!name||name.length>120){api.toast('Escribe el nombre de la campaña superior.');return}
 if(name===(c.campaignGroup||c.name)){api.toast('El conjunto ya pertenece a ese grupo.');return}
 btn.disabled=true;
 try{
  const ref=api.fbDb.collection('users').doc(api.currentUser.id).collection('adsCampaigns').doc(id);
  await api.withDeadline(ref.update({campaignGroup:name,updatedAt:new Date().toISOString()}),20000,'No se pudo guardar la agrupación.');
  c.campaignGroup=name;api.saveCampaigns();api.renderAll();
  if(view==='adsets')api.root.innerHTML=adSets(api);
  api.toast('Conjunto agrupado correctamente.');
 }catch(e){api.toast('No se pudo actualizar la agrupación: '+(e.message||'Error de conexión'))}
 finally{if(btn.isConnected)btn.disabled=false}
}
function creatives(api){
 const entries=creativeData(api);
 return wrap('Biblioteca de creativos','Previsualiza archivos reales, comprueba tamaños y abre directamente el editor del anuncio seleccionado.',
 '<div class="tf-tool-kpis">'+mini(entries.length,'Anuncios')+mini(entries.filter(x=>x.media.kind==='video').length,'Videos')+mini(entries.filter(x=>x.campaign.placement==='banner').length,'Banners')+'</div>'+
 section('Archivos por campaña','<label class="tf-tool-search">Buscar creativo<input type="search" data-tf-search="creatives" placeholder="Creativo, campaña o formato"></label><div class="tf-tool-gallery" data-tf-results="creatives">'+creativeRows(api,'')+'</div>'));
}


async function getVerifiedMetrics(api){
 const ids=campaignIds(api);if(!ids.length)return {periodDays:30,campaigns:{},failed:[],source:"verified-selections",exact:true};
 const owner=api.currentUser?.id;
 if(!owner||api.fbAuth?.currentUser?.uid!==owner)throw Error("Sesión no disponible");
 const token=await api.fbAuth.currentUser.getIdToken();
 const output={campaigns:{},periodDays:30,failed:[],exact:true,source:"verified-selections"};
 for(let i=0;i<ids.length;i+=12){
  const chunk=ids.slice(i,i+12),ctrl=new AbortController(),stop=setTimeout(()=>ctrl.abort(),17000);
  try{
   const u=VERIFIED_METRICS_URL+'?campaignIds='+encodeURIComponent(chunk.join(','));
   const r=await fetch(u,{method:'GET',mode:'cors',headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',signal:ctrl.signal});
   if(!r.ok)throw Error("El servicio privado no respondió");
   const data=await r.json();
   if(data.source!=="verified-selections"||data.exact!==true)throw Error("No se pudo confirmar la exactitud del registro.");
   for(const id of chunk){const m=data.campaigns?.[id];if(m&&!m.error)output.campaigns[id]=m;else output.failed.push(id)}
  }finally{clearTimeout(stop)}
 }
 return output;
}

const CONVERSION_SETUP_URL='https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-delivery/conversion/setup';
let conversionOneTimeKey='';
function goalResult(c,m){
 const fields={awareness:['Impresiones visibles','impressions'],traffic:['Visitas al sitio','visits'],
  engagement:['Clics','clicks'],leads:['Contactos','leads'],sales:['Compras','purchases'],app:['Instalaciones','installs']};
 const goal=fields[c.objective]||fields.awareness;
 if(!m)return {name:goal[0],value:'—',proof:'No disponible'};
 const merchant=['traffic','leads','sales','app'].includes(c.objective);
 if(merchant&&!m.trackingConfigured)return {name:goal[0],value:'—',proof:'Necesita conectar el servidor del anunciante'};
 const n=Number(['impressions','clicks'].includes(goal[1])?m[goal[1]]:m.goalEvents?.[goal[1]]);
 return {name:goal[0],value:Number.isSafeInteger(n)&&n>=0?number(n):'—',
  proof:merchant?'Notificado desde la integración autenticada':'Confirmado por TaskFlow'};
}
function conversions(api){
 conversionOneTimeKey='';
 const campaigns=api.campaigns.filter(c=>['traffic','leads','sales','app'].includes(c.objective));
 const buttons=campaigns.map(c=>'<tr><td><b>'+esc(c.name)+'</b></td><td>'+esc(objective[c.objective]||c.objective)+'</td><td><button type="button" data-tf-action="conversion-setup" data-id="'+esc(c.id)+'">Crear clave</button> <button type="button" data-tf-action="conversion-rotate" data-id="'+esc(c.id)+'">Rotar</button></td></tr>').join('');
 return section('Resultados vinculados al objetivo',
  '<p class="tf-tool-note">Una impresión y un clic no significan una compra ni una visita completada. Cada objetivo muestra únicamente el resultado que puede comprobarse. Las ventas y visitas finales requieren integración del servidor del anunciante.</p>'+
  '<div id="tfAdsObjectiveResults">Consultando resultados confirmados…</div>')+
  section('Conectar tu sitio o tienda',
  '<p class="tf-tool-note">El enlace del anuncio incorpora <code>tf_ads_click</code> para atribuir la visita. Genera una clave privada y consérvala únicamente en el servidor de tu sitio, nunca en HTML público ni JavaScript visible. La clave se muestra una sola vez al generarse y deja de funcionar si la rotas.</p>'+
  '<div class="tf-tool-table-scroll"><table class="tf-tool-table"><thead><tr><th>Campaña</th><th>Objetivo</th><th>Integración</th></tr></thead><tbody>'+
  (buttons||'<tr><td colspan="3">No existen campañas que requieran conexión comercial.</td></tr>')+'</tbody></table></div>'+
  '<p id="tfAdsConversionStatus" role="status" class="tf-tool-note"></p><div id="tfAdsConversionKeyWrap" hidden>'+
  '<p class="tf-tool-warning">Clave privada de un solo uso. Guárdala de inmediato como variable de entorno en el servidor de tu tienda.</p>'+
  '<code id="tfAdsConversionKey" class="tf-ads-private-key"></code><button type="button" data-tf-action="conversion-copy">Copiar clave privada</button></div>')+
  section('Confirmación por el servidor del anunciante',
  '<p class="tf-tool-note">El sitio envía un POST HTTPS a <code>https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-delivery/conversion/record</code> con <code>Authorization: Bearer CLAVE_PRIVADA</code> y estos campos: <code>campaignId</code>, <code>clickId</code> (valor recibido en <code>tf_ads_click</code>), <code>event</code> (visit, lead, purchase o install), <code>externalId</code> (identificador único de la operación), <code>valueMinor</code> (centavos) y <code>currency</code> (p. ej. GTQ). Las compras deben confirmarse antes del envío; las compras duplicadas no se vuelven a contar.</p>');
}
async function paintConversions(api){
 const target=api.root.querySelector('#tfAdsObjectiveResults'),owner=api.currentUser?.id;
 if(!target)return;
 try{
  const data=await getVerifiedMetrics(api);
  if(view!=='conversions'||owner!==current?.currentUser?.id||!target.isConnected)return;
  target.innerHTML=(data.failed.length?'<p class="tf-tool-warning">No se pudo comprobar '+data.failed.length+' campaña(s).</p>':'')+
  '<div class="tf-tool-table-scroll"><table class="tf-tool-table"><thead><tr><th>Campaña</th><th>Objetivo</th><th>Indicador</th><th>Resultado 30 días</th><th>Estado de medición</th></tr></thead><tbody>'+
  (api.campaigns.map(c=>{const m=data.campaigns[c.id],r=goalResult(c,m);
   const revenue=c.objective==='sales'&&m?.trackingConfigured&&Number(m.goalEvents?.revenueGtqMinor)>0?
    '<small>Valor de compras GTQ: '+esc(money(Number(m.goalEvents.revenueGtqMinor)/100))+'</small>':'';
   return '<tr><td><b>'+esc(c.name)+'</b></td><td>'+esc(objective[c.objective]||c.objective||'')+'</td><td>'+esc(r.name)+'</td><td><b>'+esc(r.value)+'</b>'+revenue+'</td><td>'+esc(r.proof)+'</td></tr>'
  }).join('')||'<tr><td colspan="5">No hay campañas.</td></tr>')+'</tbody></table></div>';
 }catch(e){if(target.isConnected)target.textContent='No fue posible obtener un informe exacto del servidor.'}
}
async function setupConversion(api,id,rotate){
 if(api?.fbAuth?.currentUser?.uid!==api?.currentUser?.id)throw Error('Sesión no disponible.');
 const token=await api.fbAuth.currentUser.getIdToken(),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),16000);
 try{
  const r=await fetch(CONVERSION_SETUP_URL,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',signal:abort.signal,
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
   body:JSON.stringify({campaignId:id,action:rotate?'rotate':'create'})});
  if(!r.ok)throw Error('Servicio de integración no disponible.');
  return await r.json();
 }finally{clearTimeout(timer)}
}

function impressionStatus(m){
 if(!m)return 'No disponible';
 return {
  not_synced:'Sin sincronización · sin compromiso',
  overdue:'Plazo vencido: faltan impresiones confirmadas',
  suspended:'Entrega suspendida · necesita nueva evaluación',
  authorized:'Meta autorizada · aún no completada',
  completed:'Meta completada según registro confirmado',
  requested:'Solicitud en evaluación · sin compromiso',
  no_goal:'Sin meta solicitada'
 }[m.goalStatus]||'Estado no disponible';
}
function verifiedSection(api,verified){
 if(!verified||verified.exact!==true)return section('Entrega confirmada',
  '<p class="tf-tool-warning">No fue posible obtener un conteo exacto del registro privado. No se muestran cifras estimadas.</p>');
 let impressions=0,clicks=0;
 for(const m of Object.values(verified.campaigns)){impressions+=Number(m.impressions)||0;clicks+=Number(m.clicks)||0}
 const rows=api.campaigns.map(c=>{
  const m=verified.campaigns[c.id];const goal=Number(m?.authorizedGoal)||0,delivered=Number(m?.deliveredSinceAuthorization)||0,result=goalResult(c,m);
  return '<tr><td><b>'+esc(c.name)+'</b><small>'+esc(impressionStatus(m))+'</small></td>'+
   '<td>'+metricValue(m,'impressions')+'</td><td>'+metricValue(m,'clicks')+'</td>'+
   '<td>'+(m?esc((Number(m.ctr)||0).toFixed(2))+' %':'—')+'</td>'+
   '<td>'+(m?number(m.requestedImpressions):'—')+'</td>'+
   '<td>'+(m&&goal?number(goal):'—')+'</td>'+
   '<td>'+(m&&goal?number(delivered):'—')+'</td>'+
   '<td>'+(m&&goal?number(Math.max(0,goal-delivered)):'—')+'</td>'+
   '<td>'+(m&&goal?(100*Math.min(goal,delivered)/goal).toFixed(2)+' %':'—')+'</td>'+
    '<td>'+esc(result.value)+' '+esc(result.name)+'</td><td>'+esc(result.proof)+'</td></tr>';
 }).join('');
 return section('Entrega confirmada por TaskFlow',
  '<p class="tf-tool-note">Criterio técnico de impresión: material cargado, al menos 50 % del área visible de forma continua durante un segundo y confirmación única del servidor. Son eventos, no personas únicas ni certificación externa. Las cifras de los últimos 30 días se separan de las entregas acumuladas desde la autorización. Una solicitud no es un compromiso y una meta incompleta no se considera entregada.</p>'+
  '<div class="tf-tool-kpis">'+mini(number(impressions),'Impresiones confirmadas · 30 días')+
  mini(number(clicks),'Clics confirmados · 30 días')+
  mini(impressions?(100*clicks/impressions).toFixed(2)+' %':'0.00 %','CTR confirmado')+'</div>'+
  (verified.failed.length?'<p class="tf-tool-warning">'+verified.failed.length+' campaña(s) sin datos exactos disponibles.</p>':'')+
  '<div class="tf-tool-table-scroll"><table class="tf-tool-table"><thead><tr><th>Campaña y estado</th><th>Impresiones (30 días)</th><th>Clics (30 días)</th><th>CTR</th><th>Solicitadas</th><th>Autorizadas</th><th>Entregadas desde autorización</th><th>Pendientes</th><th>Cumplimiento</th><th>Resultado del objetivo</th><th>Origen de medición</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
  '<p class="tf-tool-note">No se garantizan ventas, instalaciones, clientes ni resultados futuros. Si la meta no se completa dentro del período, el informe debe mostrar el déficit real.</p>');
}
function localDeliveryEvidence(){
 try{
  const info=JSON.parse(localStorage.getItem('taskflow_ads_analytics_delivery_v1')||'null');
  if(!info||!info.lastAt||Date.now()-Number(info.lastAt)>30*86400000)return '';
  const attempted=Number(info.attempted?.click)||0;
  const acknowledged=Number(info.acknowledged?.click)||0;
  const failed=Number(info.failed?.click)||0;
  const total=Number(info.attempted?.impression)||0;
  if(!attempted&&!total)return '';
  return '<div class="tf-tool-delivery-evidence">'+
   '<strong>Diagnóstico local de envío</strong>'+
   '<p>En este navegador, desde que se activó el diagnóstico: '+number(attempted)+' intento(s) de registrar clics, '+number(acknowledged)+' respuesta(s) aceptada(s) por el servidor y '+number(failed)+' envío(s) sin confirmar.</p>'+
   (info.lastError&&failed?'<p class="tf-tool-warning">Último problema: '+esc(info.lastError)+'</p>':'')+
   '<p class="tf-tool-note">Estas cifras NO se suman al informe: un intento o una respuesta HTTP no garantizan un evento único almacenado. Los totales oficiales se consultan exclusivamente en el servicio de métricas.</p></div>';
 }catch(_){return ''}
}

function reportContent(api,data){
 const t=totals(data),hasAny=api.campaigns.length>0,allAvailable=data.failed.length===0;
 const daily={};
 for(const m of Object.values(data.campaigns))for(const [day,row] of Object.entries(m.byDay||{})){if(!/^\d{8}$/.test(day))continue;const d=daily[day]||(daily[day]={impressions:0,clicks:0});d.impressions+=Number(row.impressions)||0;d.clicks+=Number(row.clicks)||0}
 const days=Object.keys(daily).sort().slice(-14),max=Math.max(1,...days.map(d=>daily[d].impressions));
 const bars=days.map(day=>'<div class="tf-tool-bar-item" title="'+esc(day)+' · '+esc(number(daily[day].impressions))+' impresiones / '+esc(number(daily[day].clicks))+' clics"><i style="height:'+Math.max(2,Math.round(daily[day].impressions/max*100))+'%"></i><small>'+day.slice(6,8)+'/'+day.slice(4,6)+'</small></div>').join('');
 const rows=api.campaigns.map(c=>{const m=data.campaigns[c.id];return '<tr><td><b>'+esc(c.name)+'</b><small>'+esc(objective[c.objective]||c.objective||'')+'</small>'+(m?.partial?'<small class="tf-tool-warning">Datos parciales</small>':'')+'</td><td>'+metricValue(m,'impressions')+'</td><td>'+metricValue(m,'clicks')+'</td><td>'+(m?esc((Number(m.ctr)||0).toFixed(2))+' %':'—')+'</td><td>'+esc(c.placement||'—')+'</td></tr>'}).join('');
 const perAd=api.campaigns.flatMap(c=>{const m=data.campaigns[c.id];return (c.ads||[]).map(a=>({c,a,m:m?(m.byAd?.[a.id]||{impressions:0,clicks:0}):null}))}).map(({c,a,m})=>'<tr><td>'+esc(a.name||'Anuncio')+'<small>'+esc(c.name)+'</small></td><td>'+metricValue(m,'impressions')+'</td><td>'+metricValue(m,'clicks')+'</td><td>'+(m&&Number(m.impressions)?(100*Number(m.clicks||0)/Number(m.impressions)).toFixed(2)+' %':m?'0.00 %':'—')+'</td></tr>').join('');

 // Datos confirmados; grupos no disponibles se muestran sin atribuciones inventadas.
 const breakdownRows=(field,labels,values)=>values.map(key=>{
  const group=api.campaigns.filter(c=>(c[field]||'')===key),known=group.filter(c=>data.campaigns[c.id]);
  const impressions=known.reduce((sum,c)=>sum+(Number(data.campaigns[c.id].impressions)||0),0);
  const clicks=known.reduce((sum,c)=>sum+(Number(data.campaigns[c.id].clicks)||0),0);
  const partial=known.length<group.length||known.some(c=>data.campaigns[c.id].partial);
  const has=known.length>0;
  return '<tr><td><b>'+esc(labels[key]||key)+'</b><small>'+group.length+' campaña(s) · '+known.length+' con métricas'+(partial?' · parcial':'')+'</small></td><td>'+(has?number(impressions):group.length?'—':'0')+'</td><td>'+(has?number(clicks):group.length?'—':'0')+'</td><td>'+(has?((impressions?100*clicks/impressions:0).toFixed(2))+' %':group.length?'—':'0.00 %')+'</td></tr>';
 }).join('');
 const breakdownTable=rows=>'<div class="tf-tool-table-scroll"><table class="tf-tool-table"><thead><tr><th>Grupo</th><th>Impresiones</th><th>Clics</th><th>CTR</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
 const formatBreakdown=breakdownTable(breakdownRows('placement',{banner:'Banner',entry:'Ingreso',interaction:'Interacción'},['banner','entry','interaction']));
 const objectiveBreakdown=breakdownTable(breakdownRows('objective',objective,Object.keys(objective)));
 return '<div class="tf-tool-kpis">'+mini(hasAny&&!t.known?'—':number(t.impressions),'Impresiones','Eventos confirmados')+mini(hasAny&&!t.known?'—':number(t.clicks),'Clics','Clics confirmados')+mini(hasAny&&!t.known?'—':t.ctr.toFixed(2)+' %','CTR','Clics / impresiones')+mini(t.known+'/'+api.campaigns.length,'Campañas consultadas')+'</div>'+
 (data.failed.length?'<p class="tf-tool-warning">'+data.failed.length+' campaña(s) con métricas no disponibles. No se muestran datos estimados.</p>':'')+
 (t.partial?'<p class="tf-tool-warning">La consulta de eventos llegó al límite de paginación; algunas cifras pueden ser parciales.</p>':'')+
 localDeliveryEvidence()+
 section('Actividad registrada por día',days.length?'<div class="tf-tool-bars">'+bars+'</div><small class="tf-tool-note">Últimos 14 días con actividad dentro de los últimos 30 días · impresiones</small>':'<p class="tf-tool-empty">Todavía no hay impresiones registradas.</p>')+
 section('Rendimiento por campaña','<div class="tf-tool-table-scroll"><table class="tf-tool-table"><thead><tr><th>Campaña</th><th>Impresiones</th><th>Clics</th><th>CTR</th><th>Formato</th></tr></thead><tbody>'+rows+'</tbody></table></div>')+
 section('Desglose por formato',formatBreakdown)+
 section('Desglose por objetivo',objectiveBreakdown)+
 section('Desglose por anuncio','<div class="tf-tool-table-scroll"><table class="tf-tool-table"><thead><tr><th>Anuncio</th><th>Impresiones</th><th>Clics</th><th>CTR</th></tr></thead><tbody>'+perAd+'</tbody></table></div>')+
 '<p class="tf-tool-note">Este archivo recoge eventos del método histórico sin verificación de selección. No acredita metas autorizadas ni equivale a impresiones verificadas. Los clics anteriores al inicio de la medición, o que no llegaron al servidor, no pueden reconstruirse ni contarse como reales. No se atribuyen conversiones, ventas, instalaciones, personas únicas ni gastos. '+(!allAvailable?'La descarga incluirá únicamente datos efectivamente disponibles.':'')+'</p>';
}
async function reports(api,refresh){
 const holder=document.getElementById('tfAdsReportsPayload');if(!holder)return;
 const version=view,owner=api.currentUser.id;
 holder.innerHTML='<div class="tf-tool-loading">Consultando entrega verificada e historial publicitario…</div>';
 const [historical,privateReport]=await Promise.allSettled([getMetrics(api,refresh),getVerifiedMetrics(api)]);
 if(view!==version||version!=='reports'||owner!==current?.currentUser?.id||!holder.isConnected)return;
 const verified=privateReport.status==='fulfilled'?privateReport.value:null;
 const history=historical.status==='fulfilled'?reportContent(api,historical.value):section('Histórico de eventos','<p class="tf-tool-warning">El registro histórico no está disponible; los datos de entrega confirmada se muestran por separado.</p>');
 holder.innerHTML=verifiedSection(api,verified)+'<details class="tf-ads-legacy-history"><summary>Consultar histórico anterior (no verificado)</summary>'+section('Historial anterior (sin comprobación de selección)','<p class="tf-tool-note">Estos registros se almacenaron con el método anterior. No se suman a la entrega verificada ni acreditan metas contratadas.</p>'+history)+'</details>';
}
function budgetDayCount(start,end){
 const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(start)||!valid(end))return 0;
 const days=Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
 return days>=1?days:0;
}
function budgetRows(api){
 return api.campaigns.map(c=>{
  const id=esc(c.id),name=esc(c.name),kind=c.budgetType==='total'?'total':'daily';
  const days=budgetDayCount(c.start,c.end);
  const avg=kind==='total'?(days?'Equivalente diario orientativo: '+money(Number(c.budget||0)/days)+' durante '+days+' día(s).':'Falta un período válido: este presupuesto total no permite calcular la entrega.'):'Límite configurado por día: '+money(c.budget);
  return '<article class="tf-tool-row tf-budget-row"><div><b>'+name+'</b>'+
   '<span>'+esc(kind==='daily'?'Presupuesto diario':'Presupuesto total')+' · '+esc(c.status)+' · '+esc(objective[c.objective]||'')+'</span>'+
   '<small>'+esc(avg)+'</small>'+
   '<small>Distribución de creativos: '+esc(c.budgetDistribution==='equal'?'Partes iguales':'Automática')+'</small></div>'+
   '<div class="tf-tool-budget-edit">'+
   '<label>Importe (GTQ)<input aria-label="Presupuesto para '+name+'" data-tf-budget="'+id+'" type="number" min="1" max="10000000" step="0.01" value="'+esc((Number(c.budget)||0).toFixed(2))+'"></label>'+
   '<label>Tipo<select aria-label="Tipo de presupuesto para '+name+'" data-tf-budget-type="'+id+'">'+
   '<option value="daily"'+(kind==='daily'?' selected':'')+'>Diario</option><option value="total"'+(kind==='total'?' selected':'')+'>Total</option></select></label>'+
   '<label>Inicio<input aria-label="Inicio para '+name+'" data-tf-budget-start="'+id+'" type="date" value="'+esc(c.start||'')+'"></label>'+
   '<label>Finalización<input aria-label="Finalización para '+name+'" data-tf-budget-end="'+id+'" type="date" value="'+esc(c.end||'')+'"></label>'+
   '<label>Estrategia<select aria-label="Estrategia de entrega para '+name+'" data-tf-budget-strategy="'+id+'"><option value="balanced"'+(!['reach','steady'].includes(c.deliveryStrategy)?' selected':'')+'>Equilibrada</option><option value="reach"'+(c.deliveryStrategy==='reach'?' selected':'')+'>Maximizar oportunidades</option><option value="steady"'+(c.deliveryStrategy==='steady'?' selected':'')+'>Reducir repeticiones</option></select></label>'+
   '<label>Frecuencia<select aria-label="Máximo de selecciones por sesión para '+name+'" data-tf-budget-frequency="'+id+'">'+[1,2,3].map(n=>'<option value="'+n+'"'+(n===([1,2,3].includes(Number(c.frequencyCap))?Number(c.frequencyCap):3)?' selected':'')+'>'+n+' por sesión y día</option>').join('')+'</select></label>'+
   '<label class="tf-budget-ab-toggle">Prueba A/B<input aria-label="Prueba A/B para '+name+'" data-tf-budget-abtest="'+id+'" type="checkbox"'+(c.abTest===true?' checked':'')+((c.ads||[]).length<2?' disabled':'')+'></label>'+
   '<button data-tf-action="budget-save" data-id="'+id+'" type="button">Guardar presupuesto</button></div>'+
    '<div class="tf-impression-request-row"><label>Meta de impresiones solicitada<input type="number" min="0" max="10000000" step="1" inputmode="numeric" aria-label="Impresiones solicitadas para '+name+'" data-tf-impression-request="'+id+'" value="'+esc(Number(c.requestedImpressions)||0)+'"></label><button type="button" data-tf-action="impression-request" data-id="'+id+'">Solicitar evaluación</button><small>No es una garantía: se valida el inventario histórico antes de autorizar un cupo.</small></div></article>';
 }).join('')||'<p class="tf-tool-empty">No hay campañas con presupuesto.</p>';
}
function budgets(api){
 const active=api.campaigns.filter(c=>c.status==='active');
 const day=active.filter(c=>c.budgetType==='daily').reduce((s,c)=>s+(Number(c.budget)||0),0);
 const total=api.campaigns.filter(c=>c.budgetType==='total').reduce((s,c)=>s+(Number(c.budget)||0),0);
 const totalActive=active.filter(c=>c.budgetType==='total');
 const validTotal=totalActive.filter(c=>budgetDayCount(c.start,c.end)>0);
 const invalidTotal=totalActive.length-validTotal.length;
 return wrap('Planificador de presupuestos','Control privado de importes y vigencia.',
  '<div class="tf-tool-kpis">'+mini(money(day),'Presupuestos diarios configurados','Campañas activas; no es gasto')+
  mini(money(day*7),'Proyección de 7 días','Solo de presupuestos diarios')+
  mini(money(total),'Presupuestos totales','Importes configurados; no son cobros')+
  mini(validTotal.length+'/'+totalActive.length,'Presupuestos totales programados',invalidTotal?'Revisar fechas faltantes':'Con fechas válidas')+'</div>'+
  section('Asignación por campaña','<p class="tf-tool-note">Para presupuestos totales son obligatorias las fechas de inicio y finalización. Modificar un presupuesto aprobado lo devuelve a revisión y suspende su publicación hasta una nueva aprobación.</p><div data-tf-budget-list>'+budgetRows(api)+'</div>')+
  section('Integridad de entrega','<p class="tf-tool-note">Verifica que todas las campañas aprobadas y activas estén sincronizadas con el distribuidor privado. Sin esa confirmación, su publicación no puede darse por operativa.</p><button type="button" data-tf-action="delivery-resync">Verificar y sincronizar campañas activas</button><p role="status" id="tfDeliverySyncStatus" class="tf-tool-note"></p><div id="tfImpressionProgress" aria-live="polite">Consultando entrega verificable…</div>')+
  '<p class="tf-tool-note">El presupuesto no compra automáticamente una cantidad fija de impresiones. Solo se reconocen eventos visibles y confirmados; las metas necesitan cupo comprobado y autorización. Las ventas y conversiones no se garantizan. Las estrategias y límites de frecuencia afectan a oportunidades de selección, no a importes cobrados. La distribución entre campañas se determina en el servicio privado.</p>');
}
function settings(api){
 return wrap('Cuenta y seguridad','Administra el perfil comercial y el acceso de esta cuenta; estas herramientas no modifican campañas.',
 section('Perfil comercial','<form id="tfAdsSettingsForm" class="tf-tool-form"><label>Responsable<input name="ownerName" maxlength="100" required value="'+esc(api.currentUser?.name||'')+'"></label><label>Nombre de la empresa<input name="businessName" maxlength="120" required value="'+esc(api.currentUser?.company||'')+'"></label><label>Correo electrónico (solo lectura)<input disabled value="'+esc(api.currentUser?.email||'')+'"></label><button type="submit">Guardar perfil</button><p id="tfAdsSettingsMessage" role="status"></p></form>')+
 section('Acceso y conexión','<div class="tf-tool-buttons"><button type="button" data-tf-action="settings-recovery">Enviar enlace para cambiar contraseña</button><button type="button" data-tf-action="settings-connection">Comprobar conexión</button><button type="button" data-settings-logout>Cerrar sesión</button></div><p id="tfAdsSecurityMessage" class="tf-tool-note" role="status">El enlace de recuperación se enviará al correo asociado con tu cuenta.</p>')+
 (api.isAdsAdmin?section('Administración de campañas','<button type="button" data-settings-admin>Ir a Control ADS</button>'):''));
}
async function requestImpressions(button,id){
 const api=current,c=api?.campaigns.find(x=>x.id===id);
 if(!api||!c||!api.currentUser||!api.fbDb)return;
 const input=api.root.querySelector('[data-tf-impression-request="'+CSS.escape(id)+'"]');
 if(!input)return;
 const amount=Number(input.value);
 if(!Number.isSafeInteger(amount)||amount<0||amount>10000000){
  api.toast('La solicitud debe ser un número entero de 0 a 10,000,000 impresiones.');return;
 }
 if(amount===Number(c.requestedImpressions||0)){api.toast('La solicitud ya tiene esa cantidad.');return}
 button.disabled=true;
 try{
  const ref=api.fbDb.collection('users').doc(api.currentUser.id).collection('adsCampaigns').doc(id);
  await api.withDeadline(ref.update({requestedImpressions:amount,updatedAt:new Date().toISOString()}),20000,'No se pudo guardar la solicitud.');
  c.requestedImpressions=amount;api.saveCampaigns();api.renderAll();
  const synced=await api.syncPrivateDelivery?.(id);
  if(view==='billing'){api.root.innerHTML=budgets(api);window.TaskFlowADSWallet?.mount?.(api);void paintImpressionCommitments(api)}
  api.toast(synced?'Solicitud registrada; pendiente de evaluación de capacidad.':'Solicitud guardada; falta sincronizar el distribuidor privado.');
 }catch(error){api.toast('No se pudo guardar la solicitud: '+String(error?.message||'Error de conexión'))}
 finally{if(button.isConnected)button.disabled=false}
}
async function paintImpressionCommitments(api){
 const target=api.root.querySelector('#tfImpressionProgress'),owner=api.currentUser?.id;
 if(!target)return;
 target.textContent='Consultando registro privado de impresiones…';
 try{
  const result=await getVerifiedMetrics(api);
  if(view!=='billing'||current?.currentUser?.id!==owner||!target.isConnected)return;
  target.innerHTML='<div class="tf-impression-progress-list">'+api.campaigns.map(c=>{
   const m=result.campaigns[c.id],goal=Number(m?.authorizedGoal)||0,delivered=Number(m?.deliveredSinceAuthorization)||0;
   return '<article class="tf-impression-progress-item"><b>'+esc(c.name)+'</b>'+
    '<span>'+esc(impressionStatus(m))+'</span>'+
    '<small>Impresiones confirmadas (últimos 30 días): '+(m?number(m.impressions):'—')+' · Solicitadas: '+(m?number(m.requestedImpressions):'—')+
    ' · Cupo autorizado: '+(m?number(goal):'—')+
    ' · Confirmadas desde autorización: '+(m&&goal?number(delivered):'—')+
    ' · Pendientes: '+(m&&goal?number(Math.max(0,goal-delivered)):'—')+'</small>'+
    (goal?'<meter min="0" max="'+goal+'" value="'+Math.min(delivered,goal)+'" aria-label="Cumplimiento de '+esc(c.name)+'"></meter>':'')+
    '</article>';
  }).join('')+'</div><p class="tf-tool-note">Los datos históricos anteriores a la autorización no aumentan su cumplimiento. Ningún número solicitado constituye automáticamente una promesa de entrega.</p>';
 }catch(error){
  if(target.isConnected)target.textContent='No fue posible verificar las impresiones. No se muestran cifras estimadas.';
 }
}
async function changeBudget(button,id){
 const api=current,c=api?.campaigns.find(x=>x.id===id),root=api?.root;
 if(!c||!api.fbDb||!api.currentUser||!root)return;
 const field=k=>root.querySelector('[data-tf-'+k+'="'+CSS.escape(id)+'"]');
 const amount=Number(field('budget')?.value),kind=field('budget-type')?.value;
 const start=String(field('budget-start')?.value||'').trim(),end=String(field('budget-end')?.value||'').trim();
  const deliveryStrategy=String(field('budget-strategy')?.value||''),frequencyCap=Number(field('budget-frequency')?.value),abTest=field('budget-abtest')?.checked===true;
 if(!Number.isFinite(amount)||amount<1||amount>10000000||Math.abs(Math.round(amount*100)-amount*100)>0.000001){api.toast('Introduce un presupuesto válido de Q1.00 a Q10,000,000.00, con máximo dos decimales.');return}
 if(!['daily','total'].includes(kind)){api.toast('Selecciona un tipo de presupuesto válido.');return}
 if(budgetDayCount(start,start)!==1){api.toast('Selecciona una fecha de inicio válida.');return}
 if(kind==='total'&&!end){api.toast('El presupuesto total necesita una fecha de finalización.');return}
 if(end&&!budgetDayCount(start,end)){api.toast('La fecha final debe ser válida y no anterior a la fecha de inicio.');return}
  if(!['balanced','reach','steady'].includes(deliveryStrategy)||![1,2,3].includes(frequencyCap)){api.toast('Revisa la estrategia y frecuencia de entrega.');return}
 if(abTest&&(c.ads||[]).length<2){api.toast('La prueba A/B necesita al menos dos creativos.');return}
 const equalAmount=Math.round(amount*100)===Math.round((Number(c.budget)||0)*100);
 if(equalAmount&&kind===(c.budgetType==='total'?'total':'daily')&&start===String(c.start||'')&&end===String(c.end||'')&&deliveryStrategy===(c.deliveryStrategy||'balanced')&&frequencyCap===([1,2,3].includes(Number(c.frequencyCap))?Number(c.frequencyCap):3)&&abTest===(c.abTest===true)){api.toast('El presupuesto y su período ya tienen esos valores.');return}
 button.disabled=true;button.textContent='Guardando…';
 try{
  const data={budget:amount,budgetType:kind,start,end,deliveryStrategy,frequencyCap,abTest,updatedAt:new Date().toISOString()};
  if(c.approvalStatus==='approved')data.approvalStatus='pending';
  const ref=api.fbDb.collection('users').doc(api.currentUser.id).collection('adsCampaigns').doc(c.id);
  const batch=api.fbDb.batch();batch.update(ref,data);
  if(c.approvalStatus==='approved')batch.delete(api.fbDb.collection('adsPublicCampaigns').doc(c.id));
  await api.withDeadline(batch.commit(),20000,'No se pudo confirmar el presupuesto.');
  Object.assign(c,data);void api.syncPrivateDelivery?.(c.id);api.saveCampaigns();api.renderAll();
  if(view==='billing'){api.root.innerHTML=budgets(api);window.TaskFlowADSWallet?.mount?.(api);void paintImpressionCommitments(api)}
  api.toast('Presupuesto y período guardados correctamente.');
 }catch(e){api.toast('No se pudo guardar: '+(e.message||'Comprueba tu conexión.'));button.disabled=false;button.textContent='Guardar presupuesto'}
}
function previewCreative(id,adId){
 const api=current,c=api?.campaigns.find(x=>x.id===id),a=c?.ads?.find(x=>x.id===adId);if(!a)return;
 const url=safe(a.src),dest=safe(a.destination);
 if(!url){api.toast('El archivo no tiene una dirección HTTPS disponible.');return}
 const dialog=document.createElement('dialog');dialog.className='tf-tool-dialog';
 dialog.innerHTML='<div class="tf-tool-dialog-head"><b>'+esc(a.name||c.name)+'</b><button type="button" data-tf-action="preview-close" aria-label="Cerrar vista previa">✕</button></div><div class="tf-tool-dialog-body">'+(a.mediaMeta?.kind==='video'?'<video src="'+esc(url)+'" controls playsinline preload="metadata"></video>':'<img src="'+esc(url)+'" alt="'+esc(a.name||'Creativo')+'">')+'</div><div class="tf-tool-buttons">'+(dest?'<a target="_blank" rel="noopener noreferrer sponsored" href="'+esc(dest)+'">'+esc(cta[c.objective]||'Abrir destino')+'</a>':'<span>Sin URL de destino</span>')+'</div>';
 api.root.appendChild(dialog);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
}
async function saveSettings(){
 const api=current,form=api.root.querySelector('#tfAdsSettingsForm'),msg=api.root.querySelector('#tfAdsSettingsMessage');
 const name=String(form?.elements.ownerName?.value||'').trim(),company=String(form?.elements.businessName?.value||'').trim();
 if(name.length<2||company.length<2){msg.textContent='Escribe el nombre completo y el nombre comercial.';return}
 const button=form.querySelector('[type="submit"]');button.disabled=true;msg.textContent='Guardando perfil…';
 try{
  await api.withDeadline(api.fbDb.collection('users').doc(api.currentUser.id).collection('adsManager').doc('business').update({ownerName:name,businessName:company,updatedAt:firebase.firestore.FieldValue.serverTimestamp()}),20000,'No se confirmó el guardado del perfil.');
  try{await api.fbAuth.currentUser.updateProfile({displayName:name})}catch(e){console.warn('ADS Auth displayName:',e)}
  api.currentUser.name=name;api.currentUser.company=company;
  document.getElementById('topCompany').textContent=company;
  document.getElementById('accountName').textContent=name;
  api.toast('Perfil comercial actualizado.');msg.textContent='Información guardada correctamente.';
 }catch(e){msg.textContent='No fue posible confirmar el guardado: '+esc(e.message)}
 finally{button.disabled=false}
}
function wire(root){
 if(mounted.has(root))return;mounted.add(root);
 root.addEventListener('submit',e=>{if(e.target.id==='tfAdsSettingsForm'){e.preventDefault();void saveSettings()}else if(e.target.id==='tfAudiencePresetForm'){e.preventDefault();void saveAudiencePreset()}});
 root.addEventListener('input',e=>{
  const kind=e.target.dataset.tfSearch;
  if(kind==='audiences'){const el=root.querySelector('[data-tf-results="audiences"]');if(el)el.innerHTML=audienceRows(current,e.target.value)}
  if(kind==='creatives'){const el=root.querySelector('[data-tf-results="creatives"]');if(el)el.innerHTML=creativeRows(current,e.target.value)}
 });
 root.addEventListener('error',e=>{if(e.target.matches?.('.tf-tool-media img')){const el=e.target.parentElement;if(el){e.target.remove();el.textContent='No se pudo cargar la imagen';el.classList.add('tf-tool-media-failed')}}},{capture:true});
 root.addEventListener('click',e=>{
  const btn=e.target.closest('[data-tf-action]');if(!btn||!root.contains(btn))return;
  const action=btn.dataset.tfAction,id=btn.dataset.id;
  if(action==='audience-edit')void current.openEdit(id).then(()=>current.setStep(2));
  else if(action==='audience-apply')void applyAudiencePreset(btn,id);
  else if(action==='audience-delete')void deleteAudiencePreset(btn,id);
  else if(action==='creative-edit')void current.openEdit(id).then(async()=>{await current.loadAdDraftEditor(btn.dataset.ad);current.setStep(4)});
  else if(action==='creative-preview')previewCreative(id,btn.dataset.ad);
  else if(action==='preview-close'){const d=btn.closest('dialog');if(d){if(d.close)d.close();else d.remove()}}
  else if(action==='report-refresh')void reports(current,true);
  else if(action==='report-verified-csv')void getVerifiedMetrics(current).then(data=>{
    const rows=[['Campaña','ID','Objetivo','Impresiones confirmadas (30 días)','Clics confirmados (30 días)','CTR %','Solicitadas','Cupo autorizado','Entregadas desde autorización','Pendientes','Estado','Resultado objetivo','Indicador','Procedencia']];
    current.campaigns.forEach(c=>{const m=data.campaigns[c.id];rows.push([c.name,c.id,objective[c.objective]||c.objective,m?.impressions??'',m?.clicks??'',m?.ctr??'',m?.requestedImpressions??'',m?.authorizedGoal??'',m?.authorizedGoal?m.deliveredSinceAuthorization:'',m?.authorizedGoal?m.outstandingImpressions:'',impressionStatus(m),goalResult(c,m).value,goalResult(c,m).name,goalResult(c,m).proof])});
    csvDownload('taskflow-ads-entrega-confirmada-30-dias.csv',rows);
   }).catch(e=>current.toast('No se pudo exportar entrega verificada: '+(e.message||'Error de conexión')));
   else if(action==='report-csv')void getMetrics(current,false).then(data=>{
   const rows=[['Campaña','ID','Objetivo','Impresiones','Clics','CTR %','Estado de datos']];
   current.campaigns.forEach(c=>{const m=data.campaigns[c.id];rows.push([c.name,c.id,objective[c.objective]||c.objective,m?.impressions??'',m?.clicks??'',m?.ctr??'',m?(m.partial?'parcial':'registrado'):'no disponible'])});
   csvDownload('taskflow-ads-informe-30-dias.csv',rows);
  }).catch(err=>current.toast('No se pudo exportar: '+err.message));
  else if(action==='adset-group-save')void saveAdSetGroup(btn,id);
   else if(action==='adset-edit')void current.openEdit(id);
   else if(action==='adset-duplicate')void current.duplicateCampaign(id).then(()=>{if(view==='adsets')root.innerHTML=adSets(current)});
   else if(action==='adset-new'){current.openNew();const field=document.getElementById('campaignGroup');if(field&&btn.dataset.group)field.value=btn.dataset.group}
   else if(action==='geo-refresh')void loadLiveGeoAreas(current);
   else if(action==='delivery-resync')void (async()=>{
    const api=current,items=api?.campaigns.filter(c=>c.status==='active'&&c.approvalStatus==='approved')||[];
    const note=root.querySelector('#tfDeliverySyncStatus');
    if(!api?.fbAuth?.currentUser||!api.syncPrivateDelivery){api?.toast?.('La sesión no está disponible.');return}
    if(!items.length){if(note)note.textContent='No hay campañas activas y aprobadas para sincronizar.';return}
    btn.disabled=true;if(note)note.textContent='Verificando '+items.length+' campaña(s)…';
    let ok=0,failed=0;
    try{
     for(let i=0;i<items.length;i+=3){
      const results=await Promise.all(items.slice(i,i+3).map(async c=>api.syncPrivateDelivery(c.id).catch(()=>false)));
      for(const r of results)r?ok++:failed++;
     }
     if(note&&note.isConnected)note.textContent=ok+' campaña(s) confirmada(s); '+failed+' sin confirmar.'+(failed?' Revisa la conexión y vuelve a intentarlo.':'');
     api.toast(failed?'Algunas campañas no pudieron sincronizarse.':'Sincronización privada confirmada.');
    }finally{btn.disabled=false}
   })();
   else if(action==='impression-request')void requestImpressions(btn,id);
    else if(action==='budget-save')void changeBudget(btn,id);
  else if(action==='conversion-setup'||action==='conversion-rotate')void (async()=>{
    const api=current,rotate=action==='conversion-rotate',notice=root.querySelector('#tfAdsConversionStatus');
    if(rotate&&!window.confirm('Rotar la clave invalida inmediatamente la anterior. ¿Confirmas?'))return;
    btn.disabled=true;if(notice)notice.textContent='Verificando conexión y propiedad de campaña…';
    try{
     const result=await setupConversion(api,id,rotate);
     if(view!=='conversions'||!root.isConnected)return;
     const wrap=root.querySelector('#tfAdsConversionKeyWrap'),field=root.querySelector('#tfAdsConversionKey');
     if(result.ok===true&&result.created===true&&typeof result.apiKey==='string'){
      conversionOneTimeKey=result.apiKey;
      if(field)field.textContent=result.apiKey;
      if(wrap)wrap.hidden=false;
      if(notice)notice.textContent='Clave creada y mostrada una única vez. Guárdala en tu servidor.';
     }else if(result.ok===true&&result.configured){
      if(notice)notice.textContent='Ya existe una clave privada. Para emitir una nueva debes rotarla.';
     }else if(notice)notice.textContent=result.reason==='SYNCHRONIZATION_REQUIRED'?
      'La campaña debe sincronizarse primero en Presupuestos.':
      'No se pudo habilitar la integración para este objetivo.';
     void paintConversions(api);
    }catch(e){if(notice)notice.textContent='No se pudo completar la operación: '+String(e?.message||'Conexión no disponible')}
    finally{btn.disabled=false}
   })();
   else if(action==='conversion-copy')void (async()=>{
    if(!conversionOneTimeKey){current?.toast?.('La clave privada no está disponible.');return}
    try{await navigator.clipboard.writeText(conversionOneTimeKey);current?.toast?.('Clave privada copiada.')}
    catch(_){current?.toast?.('No fue posible copiar automáticamente.')}
   })();
  else if(action==='settings-recovery')void (async()=>{
   const message=root.querySelector('#tfAdsSecurityMessage');btn.disabled=true;
   try{await current.fbAuth.sendPasswordResetEmail(current.currentUser.email);message.textContent='Solicitud de recuperación enviada. Comprueba tu correo.'}
   catch(e){message.textContent='No se completó la solicitud: '+(e.message||'Error de conexión')}
   finally{btn.disabled=false}
  })();
  else if(action==='settings-connection')void (async()=>{
   const message=root.querySelector('#tfAdsSecurityMessage');message.textContent='Comprobando autenticación y acceso…';btn.disabled=true;
   try{
    await current.fbAuth.currentUser.getIdToken();
    await current.withDeadline(current.fbDb.collection('users').doc(current.currentUser.id).collection('adsManager').doc('business').get({source:'server'}),12000,'El servidor no respondió.');
    message.textContent='Autenticación y acceso a los datos confirmados.';
   }catch(e){message.textContent='No se pudo confirmar el acceso: '+(e.message||'Conexión no disponible')}
   finally{btn.disabled=false}
  })();
 });
}
function render(name,api){
 const root=api.root;if(!root||!api.currentUser)return false;
 if(name!=='conversions')conversionOneTimeKey='';
 current=api;view=name;wire(root);
 if(name==='conversions'){root.innerHTML=conversions(api);void paintConversions(api)}
 else if(name==='adsets')root.innerHTML=adSets(api);
  else if(name==='audiences'){root.innerHTML=audiences(api);void loadAudiencePresets(api,false);void loadLiveGeoAreas(api);watchLiveGeoAreas()}
 else if(name==='creatives')root.innerHTML=creatives(api);
 else if(name==='reports'){root.innerHTML=wrap('Informes de rendimiento','Impresiones, clics, CTR y desglose de los eventos registrados, sin estimaciones ni compras inventadas.','<div class="tf-tool-buttons"><button type="button" data-tf-action="report-refresh">Actualizar métricas</button><button type="button" data-tf-action="report-verified-csv">Exportar impresiones confirmadas</button><button type="button" data-tf-action="report-csv">Exportar histórico no verificado</button></div><div id="tfAdsReportsPayload"></div>');void reports(api,false)}
 else if(name==='billing'){root.innerHTML=budgets(api);window.TaskFlowADSWallet?.mount?.(api);void paintImpressionCommitments(api)}
 else if(name==='settings')root.innerHTML=settings(api);
 else return false;
 return true;
}
window.TaskFlowADSModules=Object.freeze({render,paintOverview,paintCampaignMetrics});
})();
