/* TaskFlow ADS · Resumen V8. Fuentes: campañas del propietario y métricas verificadas. */
(()=>{'use strict';
const rootId='overviewView';
const fmt=new Intl.NumberFormat('es-GT',{maximumFractionDigits:0});
const cur=new Intl.NumberFormat('es-GT',{style:'currency',currency:'GTQ'});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>fmt.format(Number(v)||0);
const money=v=>cur.format(Number(v)||0);
const labels={banner:'Banner',entry:'Anuncio de ingreso',interaction:'Por interacción'};
const objective={awareness:'Reconocimiento',traffic:'Tráfico',engagement:'Interacción',leads:'Clientes potenciales',sales:'Ventas',app:'Aplicación'};
const PALETTE=['#24b9e3','#477de8','#936bf4','#34c69a','#f5aa53','#e879ae'];
let api=null,owner='',selected='',data=null,loadedAt=0,busy=null,serial=0,started=false;
const $=id=>document.getElementById(id);
const panel=()=>$('tfAdsSummaryDetail');
const visible=()=>!!api?.currentUser&&document.visibilityState==='visible'&&$('overviewView')?.classList.contains('active')&&!$('appView')?.hidden;
const active=()=>api?.campaigns?.filter(c=>c.status==='active')||[];
const daily=()=>active().filter(c=>c.budgetType==='daily');
const totalDaily=()=>daily().reduce((a,c)=>a+(Number.isFinite(Number(c.budget))?Math.max(0,Number(c.budget)):0),0);
const verified=c=>data?.campaigns?.[c.id]||null;
const metric=(c,key)=>{const m=verified(c);return m&&Number.isFinite(Number(m[key]))?Number(m[key]):null};
const currency=(c)=>money(c.budget)+' '+(c.budgetType==='daily'?'/ día':'en total');
function medium(a){const kind=String(a?.mediaMeta?.kind||''),mime=String(a?.mediaMeta?.mime||'');return kind==='video'||mime.startsWith('video/')?'Video':mime==='image/gif'?'GIF':a?.mediaMeta?'Imagen':'Sin archivo'}
function formats(c){return (c.ads||[]).map(a=>a.name||'Anuncio').map((name,i)=>'<li><span>'+esc(name)+'</span><span>'+esc(labels[c.placement]||'Formato sin especificar')+' · '+esc(medium(c.ads[i]))+'</span></li>').join('')||'<li>Sin anuncios registrados</li>'}
function title(c){return '<strong>'+esc(c.name||'Campaña sin nombre')+'</strong><small>'+esc(objective[c.objective]||c.objective||'Objetivo sin definir')+' · '+esc(c.approvalStatus==='approved'?'Aprobada':c.approvalStatus==='rejected'?'Bloqueada':'En validación')+'</small>'}
function row(c,html){return '<article class="tf-v8-row"><div class="tf-v8-row-head"><div>'+title(c)+'</div>'+html+'</div></article>'}
function blocks(c,body){return '<article class="tf-v8-row"><div class="tf-v8-row-head"><div>'+title(c)+'</div></div>'+body+'</article>'}
function tableEmpty(note){return '<p class="tf-v8-empty">'+esc(note)+'</p>'}
function note(text){return '<p class="tf-v8-note">'+esc(text)+'</p>'}
function chart(entries,kind,maxInput){
 const max=Math.max(1,Number(maxInput)||0,...entries.map(x=>x.value));
 if(!entries.length)return '';
 return '<div class="tf-v8-bars" role="img" aria-label="'+esc(kind)+' por anuncio o campaña">'+entries.map(e=>{
   const pct=Math.max(0,Math.min(100,e.value/max*100));
   return '<div class="tf-v8-bar-item"><div class="tf-v8-bar-caption"><span>'+esc(e.name)+'</span><b>'+esc(kind==='Presupuesto'?money(e.value):number(e.value))+'</b></div><div class="tf-v8-track"><span style="width:'+pct.toFixed(2)+'%"></span></div></div>';
 }).join('')+'</div>';
}
function donut(rows,total){
 if(rows.length<2||rows.length>PALETTE.length||total<=0)return '';
 let cursor=0;const stops=rows.map((r,i)=>{const start=cursor;cursor+=r.value/total*100;return PALETTE[i%PALETTE.length]+' '+start.toFixed(3)+'% '+cursor.toFixed(3)+'%'}).join(',');
 return '<div class="tf-v8-pie"><div class="tf-v8-donut" role="img" aria-label="Distribución de presupuesto por campaña" style="background:conic-gradient('+stops+')"><div><strong>'+money(total)+'</strong><small>Suma diaria</small></div></div><ul class="tf-v8-legend">'+rows.map((r,i)=>'<li><span class="tf-v8-swatch" style="background:'+PALETTE[i%PALETTE.length]+'"></span><span>'+esc(r.name)+'</span><b>'+(r.value/total*100).toFixed(1)+' %</b></li>').join('')+'</ul></div>';
}
function ageBreakdown(m,ad){
 // Nunca usar edades objetivo como si fueran edades de personas que hicieron clic.
 const ages=ad?.clicksByAge||ad?.byAge||m?.byAd?.[ad?.id]?.clicksByAge||m?.byAd?.[ad?.id]?.byAge||null;
 if(!ages||typeof ages!=='object')return note('Clics por edad: datos no disponibles. El servidor todavía no registra edades verificables asociadas a cada clic.');
 const rows=Object.entries(ages).filter(([k,v])=>/^(?:1[89]|[2-9]\d|1[01]\d|120)$/.test(k)&&Number.isSafeInteger(Number(v))&&Number(v)>=0).map(([age,value])=>({name:age+' años',value:Number(value)})).filter(x=>x.value>0).sort((a,b)=>Number(a.name.split(' ')[0])-Number(b.name.split(' ')[0]));
 return rows.length?'<div class="tf-v8-age"><b>Clics por edad declarada</b>'+chart(rows,'Clics')+'</div>':note('Todavía no hay clics con edad declarada disponible.');
}
function drawActive(){
 const list=active();
 return list.length?list.map(c=>blocks(c,'<div class="tf-v8-tags"><span>'+esc(labels[c.placement]||'Sin tipo')+'</span><span>'+esc(c.budgetType==='daily'?'Presupuesto diario':'Presupuesto final')+': '+esc(currency(c))+'</span><span>'+number((c.ads||[]).length)+' anuncios</span></div><ul class="tf-v8-formats">'+formats(c)+'</ul>')).join(''):tableEmpty('No hay campañas activas.');
}
function drawDaily(){
 const list=active().slice().sort((a,b)=>Number(a.budgetType==='total')-Number(b.budgetType==='total'));
 return list.length?list.map(c=>blocks(c,'<div class="tf-v8-budget"><span>'+esc(c.budgetType==='daily'?'Presupuesto diario':'Presupuesto final de campaña')+'</span><strong>'+esc(money(c.budget))+'</strong><small>'+(c.budgetType==='daily'?'Cada día':'Importe total de esta campaña')+'</small></div><ul class="tf-v8-formats">'+formats(c)+'</ul>')).join('')+note('Los presupuestos mostrados son importes configurados, no gasto real ni dinero cobrado.'):tableEmpty('No hay campañas activas con presupuesto.');
}
function drawTotal(){
 const rows=daily().map(c=>({name:c.name||'Sin nombre',value:Math.max(0,Number(c.budget)||0)}));
 return '<div class="tf-v8-total"><span>Presupuesto diario acumulado de todas las campañas activas que usan presupuesto diario</span><strong>'+money(totalDaily())+'</strong></div>'+
 (rows.length?chart(rows,'Presupuesto')+donut(rows,totalDaily()):tableEmpty('No existen campañas activas con presupuesto diario.'))+
 note('Esta suma corresponde al total de presupuestos diarios configurados. Las campañas con presupuesto final fijo no se suman aquí. No representa gasto efectuado.');
}
function drawImpressions(){
 const list=active();if(!list.length)return tableEmpty('No hay campañas activas.');
 let missing=0;
 const content=list.map(c=>{
  const m=verified(c);if(!m)missing++;
  const ads=(c.ads||[]).map(a=>{
   const am=m?.byAd?.[a.id],v=m&&!am?0:Number(am?.impressions);
   const valid=!!m&&Number.isFinite(v)&&v>=0;
   return {name:a.name||'Anuncio',value:valid?v:0,valid,type:medium(a)};
  });
  const known=ads.filter(x=>x.valid),max=Math.max(0,...known.map(x=>x.value));
  const winner=known.length&&max>0?known.filter(x=>x.value===max):[];
  return blocks(c,'<p class="tf-v8-campaign-count">Impresiones confirmadas · últimos 30 días: <b>'+(m?number(m.impressions):'—')+'</b></p>'+
  (ads.length?chart(known.map(x=>({name:x.name,value:x.value})),'Impresiones')+
   '<ul class="tf-v8-formats">'+ads.map(a=>'<li><span>'+esc(a.name)+' · '+esc(a.type)+'</span><b>'+(a.valid?number(a.value):'—')+' impresiones</b></li>').join('')+'</ul>':tableEmpty('Sin anuncios registrados.'))+
  (winner.length===1?note('Anuncio con más impresiones en esta campaña: '+winner[0].name+'.'):winner.length>1?note('Empate en impresiones: '+winner.map(w=>w.name).join(', ')+'.'):'')+
  (m?.partial?note('Métricas parciales: el total puede estar incompleto.'):''));
 }).join('');
 return content+(missing?note('No se recibieron métricas verificadas para '+missing+' campañas. Los valores ausentes no se estimaron.'):'');
}
function drawClicks(){
 const list=api?.campaigns||[];if(!list.length)return tableEmpty('No existen campañas registradas.');
 return list.map(c=>{
  const m=verified(c),ads=(c.ads||[]).map(a=>{
   const v=m?.byAd?.[a.id]?.clicks;
   return {id:a.id,name:a.name||'Anuncio',value:m?(v===undefined?0:Number(v)):null,kind:medium(a)};
  });
  const known=ads.filter(a=>a.value!==null&&Number.isFinite(a.value)&&a.value>=0);
  const ageAvailable=ads.some(a=>m?.byAd?.[a.id]?.clicksByAge||m?.byAd?.[a.id]?.byAge);
  return blocks(c,'<p class="tf-v8-campaign-count">Clics confirmados · últimos 30 días: <b>'+(m?number(m.clicks):'—')+'</b> <small>· '+esc(c.status==='active'?'Activa':'No activa')+'</small></p>'+
   (known.length?chart(known.map(a=>({name:a.name,value:a.value})),'Clics'):'')+
   (ads.length?ads.map(a=>'<div class="tf-v8-click-ad"><div class="tf-v8-bar-caption"><b>'+esc(a.name)+'</b><span>'+esc(a.kind)+' · '+(a.value===null?'Sin datos':number(a.value)+' clics')+'</span></div>'+(ageAvailable?ageBreakdown(m,{id:a.id}):'')+'</div>').join(''):tableEmpty('Sin anuncios registrados.'))+
   (ads.length&&!ageAvailable?note('Clics por edad: datos no disponibles. El servidor todavía no registra edades asociadas a cada clic.'):'')+
   (m?.partial?note('Datos parciales de esta campaña.'):''));
 }).join('');
}
const handlers={active:drawActive,daily:drawDaily,total:drawTotal,impressions:drawImpressions,clicks:drawClicks};
const headings={active:'Campañas activas',daily:'Presupuesto por campaña',total:'Presupuesto final',impressions:'Impresiones por anuncio',clicks:'Clics por anuncio y edad'};
function setText(id,value){const el=$(id);if(el)el.textContent=value}
function cards(){
 if(!api?.campaigns)return;
 const list=api.campaigns,activeList=active(),clicked=api.campaigns;
 const validActive=activeList.every(c=>verified(c)),validAll=clicked.every(c=>verified(c));
 const sum=(arr,key)=>arr.reduce((a,c)=>a+(metric(c,key)||0),0);
 setText('tfSummaryActive',number(activeList.length));
 setText('tfSummaryDaily',number(daily().length)+' diarios · '+number(activeList.filter(c=>c.budgetType==='total').length)+' finales');
 setText('tfSummaryTotal',money(totalDaily()));
 setText('tfSummaryImpressions',activeList.length?(data&&validActive?number(sum(activeList,'impressions')):'—'):'0');
 setText('tfSummaryClicks',clicked.length?(data&&validAll?number(sum(clicked,'clicks')):'—'):'0');
 const time=loadedAt?new Date(loadedAt).toLocaleTimeString('es-GT',{hour:'2-digit',minute:'2-digit'}):null;
 for(const el of document.querySelectorAll('[data-tf-summary-card]')){
  const chosen=el.dataset.tfSummaryCard===selected;
  el.classList.toggle('is-selected',chosen);el.setAttribute('aria-expanded',String(chosen));
 }
 const status=$('tfAdsSummaryLive');
 if(status)status.textContent=time?'Cifras de anuncios verificadas a las '+time+' · actualización automática cada 20 s':'Consultando métricas verificadas…';
}
function details(){
 const p=panel();if(!p)return;
 if(!selected){p.hidden=true;p.innerHTML='';return}
 p.hidden=false;
 const h=headings[selected]||'Detalle';
 p.innerHTML='<header class="tf-v8-detail-head"><div><small>Detalle del resumen</small><h3>'+esc(h)+'</h3></div><button type="button" data-tf-close-summary aria-label="Cerrar detalle">Cerrar ×</button></header>'+
 (handlers[selected]?handlers[selected]():'');
}
function sync(){cards();details()}
async function update(force=false){
 if(!api?.currentUser?.id||!window.TaskFlowADSModules?.getVerifiedMetrics)return;
 if(busy)return busy;
 const session=api.currentUser.id,request=++serial;
 busy=(async()=>{
  try{
   const result=await window.TaskFlowADSModules.getVerifiedMetrics(api);
   if(request!==serial||api?.currentUser?.id!==session)return false;
   data=result;loadedAt=Date.now();sync();return true;
  }catch(e){
   if(request!==serial||api?.currentUser?.id!==session)return false;
   data=null;loadedAt=0;sync();
   const s=$('tfAdsSummaryLive');if(s)s.textContent='No se pudo confirmar la medición. Usa Actualizar para volver a intentarlo.';
   console.warn('TaskFlow ADS Resumen: métricas pendientes',e?.message||e);
   return false;
  }finally{busy=null}
 })();
 return busy;
}
function render(ctx){
 if(!ctx?.currentUser?.id)return;
 if(owner!==ctx.currentUser.id){owner=ctx.currentUser.id;data=null;loadedAt=0;selected='';serial++}
 api=ctx;
 sync();
 if(visible()&&Date.now()-loadedAt>=20000&&!busy)void update();
 if(!started){
  started=true;
  const root=$(rootId);
  root?.addEventListener('click',e=>{
   const close=e.target.closest('[data-tf-close-summary]'),btn=e.target.closest('[data-tf-summary-card]');
   if(close){selected='';sync();return}
   if(!btn||!root.contains(btn))return;
   const key=btn.dataset.tfSummaryCard;
   if(!handlers[key])return;
   selected=selected===key?'':key;
   sync();
  });
  setInterval(()=>{if(visible()&&!busy&&Date.now()-loadedAt>=20000)void update()},20000);
  document.addEventListener('visibilitychange',()=>{if(visible()&&Date.now()-loadedAt>=20000)void update()});
 }
}
function refresh(ctx){render(ctx);return update(true)}
window.TaskFlowADSOverview=Object.freeze({render,refresh});
})();