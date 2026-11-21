import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../ads-overview-v8.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

function mount(campaigns,metrics,fail=false){
 const events=new Map(),timers=[],ids=[
  'overviewView','tfAdsSummaryCards','tfAdsSummaryDetail','tfAdsSummaryLive','appView',
  'tfSummaryActive','tfSummaryDaily','tfSummaryTotal','tfSummaryImpressions','tfSummaryClicks'
 ];
 const nodes=Object.fromEntries(ids.map(id=>[id,{
  id,textContent:'',innerHTML:'',hidden:false,contains:()=>true,
  classList:{contains:()=>id==='overviewView',toggle(){}},setAttribute(){},
  addEventListener(type,fn){events.set(id+'/'+type,fn)}
 }]));
 const buttons=['active','daily','total','impressions','clicks'].map(key=>({
  dataset:{tfSummaryCard:key},classList:{toggle(){}},setAttribute(){}
 }));
 const document={
  visibilityState:'visible',
  getElementById:id=>nodes[id]||null,
  querySelectorAll:q=>q==='[data-tf-summary-card]'?buttons:[],
  addEventListener(type,fn){events.set('document/'+type,fn)}
 };
 const window={TaskFlowADSModules:{getVerifiedMetrics:async()=>{
  if(fail)throw Error('NO_METRICS');
  return {source:'verified-selections',exact:true,campaigns:metrics,failed:[]};
 }}};
 vm.runInNewContext(script,{window,document,setInterval:(fn,ms)=>{timers.push(ms);return 1;},console:{warn(){}}});
 const ctx={currentUser:{id:'owner123'},campaigns};
 window.TaskFlowADSOverview.render(ctx);
 const click=key=>{
  const btn=buttons.find(b=>b.dataset.tfSummaryCard===key);
  events.get('overviewView/click')({target:{closest(selector){return selector==='[data-tf-summary-card]'?btn:null;}}});
 };
 return {window,nodes,timers,click,ctx};
}
const campaign=(id,name,budget,type,status,ads=[])=>({
 id,name,budget,budgetType:type,status,ads,approvalStatus:'approved',placement:'banner',objective:'traffic'
});
const ad=(id,name,mime='image/png')=>({id,name,mediaMeta:{mime}});
test('cinco tarjetas, sin paneles anteriores y con botones originales',()=>{
 const part=html.split('<section class="view active" id="overviewView">')[1].split('<section class="view ads-manager-view"')[0];
 assert.equal((part.match(/data-tf-summary-card="/g)||[]).length,5);
 assert.doesNotMatch(part,/Campañas recientes|Formatos publicitarios|summaryApproved|objectiveInsights/);
 assert.match(part,/id="refreshBtn"/);
 assert.match(part,/data-new/);
});
test('presupuesto diario excluye presupuestos finales y campañas pausadas',async()=>{
 const campaigns=[campaign('cmp001','Diaria',100,'daily','active',[ad('ad001','Anuncio uno')]),
  campaign('cmp002','Fija',350,'total','active',[ad('ad002','Anuncio dos','video/mp4')]),
  campaign('cmp003','Pausada',999,'daily','paused',[ad('ad003','Anuncio tres')])];
 const m={cmp001:{impressions:11,clicks:3,byAd:{ad001:{impressions:11,clicks:3}}},
  cmp002:{impressions:8,clicks:2,byAd:{ad002:{impressions:8,clicks:2}}},
  cmp003:{impressions:4,clicks:1,byAd:{ad003:{impressions:4,clicks:1}}}};
 const app=mount(campaigns,m);await app.window.TaskFlowADSOverview.refresh(app.ctx);
 assert.equal(app.nodes.tfSummaryActive.textContent,'2');
 assert.match(app.nodes.tfSummaryDaily.textContent,/1 diario.*1 final/);
 assert.match(app.nodes.tfSummaryTotal.textContent,/100/);
 assert.equal(app.nodes.tfSummaryImpressions.textContent,'19');
 assert.equal(app.nodes.tfSummaryClicks.textContent,'6');
 app.click('daily');assert.match(app.nodes.tfAdsSummaryDetail.innerHTML,/350/);
 assert.match(app.nodes.tfAdsSummaryDetail.innerHTML,/Video/);
 app.click('impressions');assert.match(app.nodes.tfAdsSummaryDetail.innerHTML,/Anuncio uno/);
 app.click('clicks');assert.match(app.nodes.tfAdsSummaryDetail.innerHTML,/Clics por edad: datos no disponibles/);
 assert.equal(app.timers.length,1);
});
test('sin métricas verificadas no inventa cifras ni edades',async()=>{
 const app=mount([campaign('cmp001','Ejemplo',12,'daily','active',[ad('ad001','Creativo')])],{},true);
 await app.window.TaskFlowADSOverview.refresh(app.ctx);
 assert.equal(app.nodes.tfSummaryImpressions.textContent,'—');
 assert.equal(app.nodes.tfSummaryClicks.textContent,'—');
 assert.match(app.nodes.tfAdsSummaryLive.textContent,/No se pudo confirmar/);
});
test('escapa nombres y utiliza desglose de edad únicamente si el servidor lo suministra',async()=>{
 const app=mount([campaign('cmp001','<img src=x onerror=alert(1)>',25,'daily','active',[ad('ad001','Anuncio')])],
 {cmp001:{impressions:12,clicks:9,byAd:{ad001:{impressions:12,clicks:9,clicksByAge:{'30':6,'18':3}}}}});
 await app.window.TaskFlowADSOverview.refresh(app.ctx);
 app.click('clicks');
 assert.match(app.nodes.tfAdsSummaryDetail.innerHTML,/30 años/);
 assert.match(app.nodes.tfAdsSummaryDetail.innerHTML,/18 años/);
 assert.doesNotMatch(app.nodes.tfAdsSummaryDetail.innerHTML,/<img src=x/);
});
