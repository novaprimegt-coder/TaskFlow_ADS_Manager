/* TaskFlow ADS Manager · módulos operativos. Cada módulo posee una función distinta. */
(function(){
'use strict';
const METRICS_URL='https://taskflow-ads-media.vercel.app/api/analytics';
const number=v=>new Intl.NumberFormat('es-GT').format(Number(v)||0);
const money=v=>new Intl.NumberFormat('es-GT',{style:'currency',currency:'GTQ'}).format(Number(v)||0);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=v=>{try{const u=new URL(String(v||''));return u.protocol==='https:'&&!u.username&&!u.password?u.href:''}catch(_){return ''}};
const objective={awareness:'Reconocimiento',traffic:'Tráfico',engagement:'Interacción',leads:'Clientes potenciales',sales:'Ventas',app:'Aplicación'};
const cta={awareness:'Conocer la marca',traffic:'Visitar sitio web',engagement:'Participar',leads:'Solicitar información',sales:'Comprar ahora',app:'Descargar aplicación'};
const specs={banner:'1200×180 / 2400×360',entry:'1080×1920 / 2160×3840',interaction:'1080×1920 / 2160×3840'};
let current=null,view='',metricCache=null,metricOwner='',metricAt=0,pendingMetrics=null,revision=0;
const mounted=new WeakSet();
function section(title,body){return '<section class="tf-tool-panel"><div class="tf-tool-heading"><h3>'+esc(title)+'</h3></div>'+body+'</section>'}
function mini(value,label,small){return '<article class="tf-tool-kpi"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(small?'<small>'+esc(small)+'</small>':'')+'</article>'}
function wrap(title,description,body){return '<div class="tf-tool-intro"><h3>'+esc(title)+'</h3><p>'+esc(description)+'</p></div>'+body}
function campaignIds(api){return [...new Set(api.campaigns.map(x=>x.id).filter(id=>/^[a-zA-Z0-9_-]{3,128}$/.test(id)))];}
async function getMetrics(api,refresh){
 const owner=api.currentUser?.id||'';
 if(!owner||!api.fbAuth?.currentUser||api.fbAuth.currentUser.uid!==owner)throw new Error('Sesión no disponible.');
 if(!refresh&&metricCache&&metricOwner===owner&&Date.now()-metricAt<45000)return metricCache;
 if(!refresh&&pendingMetrics&&metricOwner===owner)return pendingMetrics;
 metricOwner=owner;
 const job=(async()=>{
  const ids=campaignIds(api),token=await api.fbAuth.currentUser.getIdToken(),all={},failures=[];
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
  if(metricOwner===owner){metricCache=result;metricAt=Date.now()}
  return result;
 })();
 pendingMetrics=job;
 try{return await job}finally{if(pendingMetrics===job)pendingMetrics=null}
}
function totals(metrics){
 const r={impressions:0,clicks:0,known:0,partial:false};
 for(const m of Object.values(metrics.campaigns)){r.known++;r.impressions+=Number(m.impressions)||0;r.clicks+=Number(m.clicks)||0;if(m.partial)r.partial=true}
 r.ctr=r.impressions?r.clicks/r.impressions*100:0;return r;
}
function metricValue(m,key){return m&&!m.error&&Number.isFinite(Number(m[key]))?number(m[key]):'—'}
function csvCell(s){return '"'+String(s==null?'':s).replace(/"/g,'""')+'"'}
function csvDownload(name,rows){const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),3000)}
async function paintOverview(api,refresh){current=api;
 const overview=document.getElementById('overviewView');if(!overview||!api.currentUser)return;
 let slot=document.getElementById('tfAdsLiveOverview');
 if(!slot){slot=document.createElement('section');slot.id='tfAdsLiveOverview';slot.className='tf-tool-overview';const anchor=overview.querySelector('.dashboard');if(anchor)anchor.insertAdjacentElement('beforebegin',slot);else overview.appendChild(slot)}
 const token=++revision;slot.innerHTML='<div class="tf-tool-topline"><strong>Rendimiento publicitario real · últimos 30 días</strong><button type="button" data-tf-overview-refresh>Actualizar estadísticas</button></div><div class="tf-tool-kpis">'+mini('…','Impresiones')+mini('…','Clics en anuncios')+mini('…','CTR')+'</div>';
 if(!mounted.has(slot)){mounted.add(slot);slot.addEventListener('click',e=>{if(e.target.closest('[data-tf-overview-refresh]'))void paintOverview(api,true)})}
 try{
  const data=await getMetrics(api,refresh);
  if(token!==revision||!slot.isConnected||api.currentUser.id!==current?.currentUser?.id)return;
  const t=totals(data),empty=!api.campaigns.length;
  slot.innerHTML='<div class="tf-tool-topline"><strong>Rendimiento publicitario real · últimos 30 días</strong><button type="button" data-tf-overview-refresh>Actualizar estadísticas</button></div><div class="tf-tool-kpis">'+mini(empty?'0':t.known?number(t.impressions):'—','Impresiones','Eventos registrados')+mini(empty?'0':t.known?number(t.clicks):'—','Clics en anuncios','Aperturas registradas')+mini(empty?'0 %':t.known?t.ctr.toFixed(2)+' %':'—','CTR','Clics ÷ impresiones')+'</div>'+(data.failed.length?'<p class="tf-tool-warning">No se pudieron consultar '+data.failed.length+' campaña(s). Los valores no disponibles no se han inventado.</p>':'')+(t.partial?'<p class="tf-tool-warning">El servicio devolvió una medición parcial.</p>':'')+'<p class="tf-tool-note">Los clics no acreditan ventas, formularios enviados ni instalaciones. Sin costo de entrega confirmado no se calcula CPC o gasto.</p>';
 }catch(e){if(slot.isConnected)slot.innerHTML='<div class="tf-tool-error">No se pudieron consultar las métricas: '+esc(e.message)+'</div>'}
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
 section('Segmentación por campaña','<label class="tf-tool-search">Buscar campaña o ubicación<input type="search" data-tf-search="audiences" placeholder="Nombre, departamento o municipio" autocomplete="off"></label><div data-tf-results="audiences">'+audienceRows(api,'')+'</div>')+
 '<p class="tf-tool-note">Las coincidencias son una comparación de configuración, no un cálculo de tamaño de audiencia ni de personas únicas.</p>');
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
function creatives(api){
 const entries=creativeData(api);
 return wrap('Biblioteca de creativos','Previsualiza archivos reales, comprueba tamaños y abre directamente el editor del anuncio seleccionado.',
 '<div class="tf-tool-kpis">'+mini(entries.length,'Anuncios')+mini(entries.filter(x=>x.media.kind==='video').length,'Videos')+mini(entries.filter(x=>x.campaign.placement==='banner').length,'Banners')+'</div>'+
 section('Archivos por campaña','<label class="tf-tool-search">Buscar creativo<input type="search" data-tf-search="creatives" placeholder="Creativo, campaña o formato"></label><div class="tf-tool-gallery" data-tf-results="creatives">'+creativeRows(api,'')+'</div>'));
}
function reportContent(api,data){
 const t=totals(data),hasAny=api.campaigns.length>0,allAvailable=data.failed.length===0;
 const daily={};
 for(const m of Object.values(data.campaigns))for(const [day,row] of Object.entries(m.byDay||{})){if(!/^\d{8}$/.test(day))continue;const d=daily[day]||(daily[day]={impressions:0,clicks:0});d.impressions+=Number(row.impressions)||0;d.clicks+=Number(row.clicks)||0}
 const days=Object.keys(daily).sort().slice(-14),max=Math.max(1,...days.map(d=>daily[d].impressions));
 const bars=days.map(day=>'<div class="tf-tool-bar-item" title="'+esc(day)+' · '+esc(number(daily[day].impressions))+' impresiones / '+esc(number(daily[day].clicks))+' clics"><i style="height:'+Math.max(2,Math.round(daily[day].impressions/max*100))+'%"></i><small>'+day.slice(6,8)+'/'+day.slice(4,6)+'</small></div>').join('');
 const rows=api.campaigns.map(c=>{const m=data.campaigns[c.id];return '<tr><td><b>'+esc(c.name)+'</b><small>'+esc(objective[c.objective]||c.objective||'')+'</small></td><td>'+metricValue(m,'impressions')+'</td><td>'+metricValue(m,'clicks')+'</td><td>'+(m?esc((Number(m.ctr)||0).toFixed(2))+' %':'—')+'</td><td>'+esc(c.placement||'—')+'</td></tr>'}).join('');
 const perAd=api.campaigns.flatMap(c=>{const m=data.campaigns[c.id];return (c.ads||[]).map(a=>({c,a,m:m?(m.byAd?.[a.id]||{impressions:0,clicks:0}):null}))}).map(({c,a,m})=>'<tr><td>'+esc(a.name||'Anuncio')+'<small>'+esc(c.name)+'</small></td><td>'+metricValue(m,'impressions')+'</td><td>'+metricValue(m,'clicks')+'</td><td>'+(m&&Number(m.impressions)?(100*Number(m.clicks||0)/Number(m.impressions)).toFixed(2)+' %':m?'0.00 %':'—')+'</td></tr>').join('');
 return '<div class="tf-tool-kpis">'+mini(hasAny&&!t.known?'—':number(t.impressions),'Impresiones','Anuncios visibles')+mini(hasAny&&!t.known?'—':number(t.clicks),'Clics','Clics registrados')+mini(hasAny&&!t.known?'—':t.ctr.toFixed(2)+' %','CTR','Clics / impresiones')+mini(t.known+'/'+api.campaigns.length,'Campañas medidas')+'</div>'+
 (data.failed.length?'<p class="tf-tool-warning">'+data.failed.length+' campaña(s) con métricas no disponibles. No se muestran datos estimados.</p>':'')+
 (t.partial?'<p class="tf-tool-warning">La consulta de eventos llegó al límite de paginación; algunas cifras pueden ser parciales.</p>':'')+
 section('Actividad registrada por día',days.length?'<div class="tf-tool-bars">'+bars+'</div><small class="tf-tool-note">Últimos 14 días con actividad dentro de los últimos 30 días · impresiones</small>':'<p class="tf-tool-empty">Todavía no hay impresiones registradas.</p>')+
 section('Rendimiento por campaña','<div class="tf-tool-table-scroll"><table class="tf-tool-table"><thead><tr><th>Campaña</th><th>Impresiones</th><th>Clics</th><th>CTR</th><th>Formato</th></tr></thead><tbody>'+rows+'</tbody></table></div>')+
 section('Desglose por anuncio','<div class="tf-tool-table-scroll"><table class="tf-tool-table"><thead><tr><th>Anuncio</th><th>Impresiones</th><th>Clics</th><th>CTR</th></tr></thead><tbody>'+perAd+'</tbody></table></div>')+
 '<p class="tf-tool-note">Datos del servicio de medición de TaskFlow, últimos 30 días. No se atribuyen conversiones, ventas, instalaciones, personas únicas ni gastos. '+(!allAvailable?'La descarga incluirá únicamente datos efectivamente disponibles.':'')+'</p>';
}
async function reports(api,refresh){
 const holder=document.getElementById('tfAdsReportsPayload');if(!holder)return;const version=view,owner=api.currentUser.id;
 holder.innerHTML='<div class="tf-tool-loading">Consultando impresiones y clics registrados…</div>';
 try{const metrics=await getMetrics(api,refresh);if(view!==version||version!=='reports'||owner!==current?.currentUser?.id||!holder.isConnected)return;holder.innerHTML=reportContent(api,metrics)}
 catch(e){if(holder.isConnected)holder.innerHTML='<div class="tf-tool-error">No se pudieron consultar las métricas: '+esc(e.message||'Error de conexión')+'</div>'}
}
function budgetRows(api){
 return api.campaigns.map(c=>'<article class="tf-tool-row"><div><b>'+esc(c.name)+'</b><span>'+esc(c.budgetType==='daily'?'Por día':'Total de campaña')+' · '+esc(c.status)+' · '+esc(objective[c.objective]||'')+'</span><small>Distribución: '+esc(c.budgetDistribution==='equal'?'Equitativa':'Rotación automática')+'</small></div><div class="tf-tool-budget-edit"><label>Presupuesto (GTQ)<input aria-label="Presupuesto para '+esc(c.name)+'" type="number" min="1" max="10000000" step="0.01" data-tf-budget="'+esc(c.id)+'" value="'+esc((Number(c.budget)||0).toFixed(2))+'"></label><button data-tf-action="budget-save" data-id="'+esc(c.id)+'" type="button">Guardar presupuesto</button></div></article>').join('')||'<p class="tf-tool-empty">No hay campañas con presupuesto.</p>'
}
function budgets(api){
 const active=api.campaigns.filter(c=>c.status==='active'),day=active.filter(c=>c.budgetType==='daily').reduce((s,c)=>s+(Number(c.budget)||0),0),total=api.campaigns.filter(c=>c.budgetType!=='daily').reduce((s,c)=>s+(Number(c.budget)||0),0);
 return wrap('Planificador de presupuestos','Actualiza asignaciones directamente y revisa la planificación; no se confunden presupuestos con cobros.',
 '<div class="tf-tool-kpis">'+mini(money(day),'Límite diario configurado','Campañas activas')+mini(money(day*7),'Proyección a 7 días','Solo de presupuestos diarios')+mini(money(total),'Presupuestos totales','Importes configurados')+'</div>'+
 section('Asignación por campaña','<p class="tf-tool-note">Editar un presupuesto de una campaña aprobada la devuelve a revisión y suspende su publicación hasta nueva aprobación.</p><div data-tf-budget-list>'+budgetRows(api)+'</div>')+
 '<p class="tf-tool-note">Las proyecciones no constituyen gastos reales ni facturación.</p>');
}
function settings(api){
 return wrap('Cuenta y seguridad','Administra el perfil comercial y el acceso de esta cuenta; estas herramientas no modifican campañas.',
 section('Perfil comercial','<form id="tfAdsSettingsForm" class="tf-tool-form"><label>Responsable<input name="ownerName" maxlength="100" required value="'+esc(api.currentUser?.name||'')+'"></label><label>Nombre de la empresa<input name="businessName" maxlength="120" required value="'+esc(api.currentUser?.company||'')+'"></label><label>Correo electrónico (solo lectura)<input disabled value="'+esc(api.currentUser?.email||'')+'"></label><button type="submit">Guardar perfil</button><p id="tfAdsSettingsMessage" role="status"></p></form>')+
 section('Acceso y conexión','<div class="tf-tool-buttons"><button type="button" data-tf-action="settings-recovery">Enviar enlace para cambiar contraseña</button><button type="button" data-tf-action="settings-connection">Comprobar conexión</button><button type="button" data-settings-logout>Cerrar sesión</button></div><p id="tfAdsSecurityMessage" class="tf-tool-note" role="status">El enlace de recuperación se enviará al correo de esta cuenta, si Firebase acepta la solicitud.</p>')+
 (api.isAdsAdmin?section('Administración de campañas','<button type="button" data-settings-admin>Ir a Control ADS</button>'):''));
}
async function changeBudget(button,id){
 const api=current,c=api?.campaigns.find(x=>x.id===id),root=api?.root;
 if(!c||!api.fbDb||!api.currentUser)return;
 const input=root.querySelector('[data-tf-budget="'+CSS.escape(id)+'"]');
 const amount=Number(input?.value);
 if(!Number.isFinite(amount)||amount<1||amount>10000000||Math.abs(Math.round(amount*100)-amount*100)>0.000001){api.toast('Introduce un presupuesto válido de Q1.00 a Q10,000,000.00, con máximo dos decimales.');return}
 if(amount===Number(c.budget)){api.toast('El presupuesto ya tiene ese valor.');return}
 button.disabled=true;button.textContent='Guardando…';
 try{
  const data={budget:amount,updatedAt:new Date().toISOString()};
  if(c.approvalStatus==='approved')data.approvalStatus='pending';
  const ref=api.fbDb.collection('users').doc(api.currentUser.id).collection('adsCampaigns').doc(c.id);
  const batch=api.fbDb.batch();batch.update(ref,data);
  if(c.approvalStatus==='approved')batch.delete(api.fbDb.collection('adsPublicCampaigns').doc(c.id));
  await api.withDeadline(batch.commit(),20000,'No se pudo confirmar el presupuesto.');
  Object.assign(c,data);api.saveCampaigns();api.renderAll();api.toast('Presupuesto actualizado correctamente.');if(view==='billing')api.root.innerHTML=budgets(api);
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
 root.addEventListener('submit',e=>{if(e.target.id==='tfAdsSettingsForm'){e.preventDefault();void saveSettings()}});
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
  else if(action==='creative-edit')void current.openEdit(id).then(async()=>{await current.loadAdDraftEditor(btn.dataset.ad);current.setStep(4)});
  else if(action==='creative-preview')previewCreative(id,btn.dataset.ad);
  else if(action==='preview-close'){const d=btn.closest('dialog');if(d){if(d.close)d.close();else d.remove()}}
  else if(action==='report-refresh')void reports(current,true);
  else if(action==='report-csv')void getMetrics(current,false).then(data=>{
   const rows=[['Campaña','ID','Objetivo','Impresiones','Clics','CTR %','Estado de datos']];
   current.campaigns.forEach(c=>{const m=data.campaigns[c.id];rows.push([c.name,c.id,objective[c.objective]||c.objective,m?.impressions??'',m?.clicks??'',m?.ctr??'',m?'registrado':'no disponible'])});
   csvDownload('taskflow-ads-informe-30-dias.csv',rows);
  }).catch(err=>current.toast('No se pudo exportar: '+err.message));
  else if(action==='budget-save')void changeBudget(btn,id);
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
 current=api;view=name;wire(root);
 if(name==='audiences')root.innerHTML=audiences(api);
 else if(name==='creatives')root.innerHTML=creatives(api);
 else if(name==='reports'){root.innerHTML=wrap('Informes de rendimiento','Impresiones, clics, CTR y desglose de los eventos registrados, sin estimaciones ni compras inventadas.','<div class="tf-tool-buttons"><button type="button" data-tf-action="report-refresh">Actualizar métricas</button><button type="button" data-tf-action="report-csv">Exportar CSV</button></div><div id="tfAdsReportsPayload"></div>');void reports(api,false)}
 else if(name==='billing')root.innerHTML=budgets(api);
 else if(name==='settings')root.innerHTML=settings(api);
 else return false;
 return true;
}
window.TaskFlowADSModules=Object.freeze({render,paintOverview});
})();
