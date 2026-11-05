(function(){
'use strict';

var CONFIG=window.TaskFlowAdsFirebaseConfig;
var state={
  mode:'login',
  user:null,
  business:null,
  campaigns:[],
  view:'overview',
  wizardStep:1,
  objective:'awareness',
  editingId:null,
  remoteReady:false
};

var els={};
function byId(id){return document.getElementById(id)}
function q(sel,root){return (root||document).querySelector(sel)}
function qa(sel,root){return Array.from((root||document).querySelectorAll(sel))}
function clean(v){return String(v==null?'':v).trim()}
function money(v){var n=Number(v)||0;return new Intl.NumberFormat('es-GT',{style:'currency',currency:'GTQ'}).format(n)}
function dateText(v){if(!v)return 'Sin límite';try{return new Intl.DateTimeFormat('es-GT',{dateStyle:'medium'}).format(new Date(v+'T12:00:00'))}catch(_){return v}}
function initials(name,email){var src=clean(name)||clean(email)||'TF';var p=src.split(/\s+/).filter(Boolean).slice(0,2);return p.map(function(x){return x[0]||''}).join('').toUpperCase()||'TF'}
function localKey(type){return 'taskflow_ads_manager_'+type+'_'+(state.user&&state.user.uid||'guest')}
function readLocal(type,fallback){try{var raw=localStorage.getItem(localKey(type));return raw?JSON.parse(raw):fallback}catch(_){return fallback}}
function writeLocal(type,value){try{localStorage.setItem(localKey(type),JSON.stringify(value));return true}catch(_){return false}}
function uid(){return state.user&&state.user.uid||''}
function nowIso(){return new Date().toISOString()}
function makeId(){try{return crypto.randomUUID()}catch(_){return 'cmp_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10)}}
function escapeHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function toast(message){var el=els.toast||byId('toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(function(){el.classList.remove('show')},2600)}
function setMessage(el,msg,type){if(!el)return;el.textContent=msg||'';el.classList.remove('error','success');if(type)el.classList.add(type)}
function setSync(kind,text){if(!els.syncBadge)return;els.syncBadge.classList.remove('online','warn');if(kind)els.syncBadge.classList.add(kind);els.syncBadge.textContent=text}
function serverTime(){try{return firebase.firestore.FieldValue.serverTimestamp()}catch(_){return new Date()}}

function cacheEls(){
  [
    'boot','authView','appView','loginTab','registerTab','authForm','nameField','displayName','email','password','confirmField','confirmPassword','authSubmit','authMessage',
    'businessForm','onboardingModal','businessName','businessCountry','businessPhone','businessWebsite','businessMessage',
    'logoutBtn','mobileMenuBtn','businessLabel','businessNameTop','accountInitials','accountName','accountEmail','syncBadge','createCampaignBtn',
    'overviewView','campaignsView','placeholderView','placeholderTitle','placeholderText','metricCampaigns','metricActive','metricBudget','metricPlacements','recentCampaigns',
    'campaignSearch','statusFilter','campaignTableBody','campaignEmpty','campaignModal','closeCampaignModal','campaignForm','campaignName','objectiveGrid',
    'targetCountry','targetRegion','targetCity','targetRadius','ageMin','ageMax','placementsGrid','budgetType','budgetAmount','startDate','endDate',
    'adName','destinationUrl','creativeUrl','creativeType','videoSound','campaignReview','wizardBack','wizardNext','saveDraftBtn','wizardSubtitle','campaignMessage','toast'
  ].forEach(function(id){els[id]=byId(id)});
}

function initMotion(){
  if(!window.gsap)return;
  try{
    if(window.ScrollTrigger)gsap.registerPlugin(ScrollTrigger);
    gsap.from('.auth-logo,.auth-tabs,#authForm',{opacity:0,y:14,duration:.5,stagger:.06,ease:'power2.out'});
    gsap.from('.auth-brand h1,.auth-brand>p,.brand-badge',{opacity:0,y:22,duration:.7,stagger:.08,ease:'power3.out'});
    if(window.ScrollTrigger){
      qa('[data-parallax]').forEach(function(el){
        gsap.to(el,{backgroundPositionY:'18%',ease:'none',scrollTrigger:{trigger:el,start:'top top',end:'bottom top',scrub:true}});
      });
      qa('.visual-card').forEach(function(el,index){
        gsap.to(el,{y:index%2?32:-24,scale:1.025,ease:'none',scrollTrigger:{trigger:'.auth-view',start:'top top',end:'bottom top',scrub:true}});
      });
    }
  }catch(_){}
}
function animateWorkspace(){
  if(!window.gsap)return;
  try{gsap.from('.view.active .page-heading,.view.active .metric-card,.view.active .panel,.view.active .table-wrap',{opacity:0,y:10,duration:.32,stagger:.035,ease:'power2.out'})}catch(_){}
}

function firebaseReady(){
  return !!(window.firebase&&CONFIG);
}
function initFirebase(){
  if(!firebaseReady())throw new Error('Firebase no está disponible.');
  if(!firebase.apps.length)firebase.initializeApp(CONFIG);
  var auth=firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){});
  var db=firebase.firestore();
  try{
    db.enablePersistence({synchronizeTabs:true}).catch(function(){});
  }catch(_){}
  state.auth=auth;
  state.db=db;
  state.remoteReady=true;
  return auth;
}

function showAuth(){
  els.authView.hidden=false;
  els.appView.hidden=true;
  els.onboardingModal.hidden=true;
  els.campaignModal.hidden=true;
  requestAnimationFrame(initMotion);
}
function showApp(){
  els.authView.hidden=true;
  els.appView.hidden=false;
  els.onboardingModal.hidden=true;
  renderIdentity();
  renderAll();
}
function showBusinessOnboarding(){
  els.authView.hidden=true;
  els.appView.hidden=true;
  els.onboardingModal.hidden=false;
  els.businessName.value='';
  els.businessCountry.value='GT';
  els.businessPhone.value='';
  els.businessWebsite.value='';
}

function setAuthMode(mode){
  state.mode=mode==='register'?'register':'login';
  var reg=state.mode==='register';
  els.loginTab.classList.toggle('active',!reg);
  els.registerTab.classList.toggle('active',reg);
  els.nameField.hidden=!reg;
  els.confirmField.hidden=!reg;
  els.password.autocomplete=reg?'new-password':'current-password';
  els.authSubmit.textContent=reg?'Crear cuenta':'Iniciar sesión';
  setMessage(els.authMessage,'');
}

function friendlyAuthError(err){
  var code=err&&err.code||'';
  var map={
    'auth/email-already-in-use':'Ese correo ya está registrado.',
    'auth/invalid-email':'El correo electrónico no es válido.',
    'auth/weak-password':'La contraseña debe tener al menos 8 caracteres.',
    'auth/invalid-credential':'Correo o contraseña incorrectos.',
    'auth/user-not-found':'No existe una cuenta con ese correo.',
    'auth/wrong-password':'Correo o contraseña incorrectos.',
    'auth/too-many-requests':'Demasiados intentos. Intenta nuevamente más tarde.',
    'auth/network-request-failed':'No hay conexión con el servicio de cuentas.'
  };
  return map[code]||'No fue posible completar el acceso.';
}

async function handleAuthSubmit(event){
  event.preventDefault();
  setMessage(els.authMessage,'');
  var email=clean(els.email.value).toLowerCase();
  var pass=els.password.value||'';
  if(!email||pass.length<8){setMessage(els.authMessage,'Ingresa un correo válido y una contraseña de al menos 8 caracteres.','error');return}
  els.authSubmit.disabled=true;
  try{
    if(state.mode==='register'){
      var name=clean(els.displayName.value);
      var confirm=els.confirmPassword.value||'';
      if(!name){throw {code:'LOCAL_NAME'}}
      if(pass!==confirm){throw {code:'LOCAL_CONFIRM'}}
      var cred=await state.auth.createUserWithEmailAndPassword(email,pass);
      if(cred.user)await cred.user.updateProfile({displayName:name});
    }else{
      await state.auth.signInWithEmailAndPassword(email,pass);
    }
  }catch(err){
    var msg=err&&err.code==='LOCAL_NAME'?'Escribe el nombre del responsable.':err&&err.code==='LOCAL_CONFIRM'?'Las contraseñas no coinciden.':friendlyAuthError(err);
    setMessage(els.authMessage,msg,'error');
  }finally{
    els.authSubmit.disabled=false;
  }
}

function businessRef(){
  return state.db.collection('users').doc(uid()).collection('adsManager').doc('business');
}
function campaignsRef(){
  return state.db.collection('users').doc(uid()).collection('adsCampaigns');
}

async function loadBusiness(){
  var local=readLocal('business',null);
  state.business=local;
  if(!state.remoteReady||!uid())return local;
  try{
    var snap=await businessRef().get();
    if(snap.exists){
      state.business=Object.assign({},snap.data(),{id:snap.id});
      writeLocal('business',state.business);
      setSync('online','Sincronizado');
    }
  }catch(_){
    setSync('warn','Respaldo local');
  }
  return state.business;
}

async function saveBusiness(data){
  var payload={
    ownerUid:uid(),
    ownerEmail:state.user.email||'',
    ownerName:state.user.displayName||'',
    businessName:clean(data.businessName),
    country:clean(data.country)||'GT',
    phone:clean(data.phone),
    website:clean(data.website),
    accountStatus:'active',
    updatedAt:nowIso()
  };
  if(!state.business)payload.createdAt=nowIso();
  state.business=Object.assign({},state.business||{},payload);
  writeLocal('business',state.business);
  if(state.remoteReady){
    try{
      await businessRef().set(Object.assign({},payload,{updatedAtServer:serverTime()}),{merge:true});
      setSync('online','Sincronizado');
    }catch(_){
      setSync('warn','Respaldo local');
    }
  }
  return state.business;
}

async function loadCampaigns(){
  var local=readLocal('campaigns',[]);
  state.campaigns=Array.isArray(local)?local:[];
  if(state.remoteReady&&uid()){
    try{
      var snap=await campaignsRef().get();
      var remote=[];
      snap.forEach(function(doc){remote.push(Object.assign({id:doc.id},doc.data()))});
      if(remote.length||!state.campaigns.length){
        state.campaigns=remote;
        writeLocal('campaigns',remote);
      }
      setSync('online','Sincronizado');
    }catch(_){
      setSync('warn','Respaldo local');
    }
  }
  sortCampaigns();
  renderAll();
}
function sortCampaigns(){
  state.campaigns.sort(function(a,b){return String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))});
}
async function persistCampaign(campaign){
  var idx=state.campaigns.findIndex(function(x){return x.id===campaign.id});
  if(idx>=0)state.campaigns[idx]=campaign;else state.campaigns.unshift(campaign);
  sortCampaigns();
  writeLocal('campaigns',state.campaigns);
  renderAll();
  if(state.remoteReady){
    try{
      var remote=Object.assign({},campaign,{updatedAtServer:serverTime()});
      await campaignsRef().doc(campaign.id).set(remote,{merge:true});
      setSync('online','Sincronizado');
      return true;
    }catch(_){
      setSync('warn','Guardado local');
      return false;
    }
  }
  return false;
}
async function removeCampaign(id){
  state.campaigns=state.campaigns.filter(function(x){return x.id!==id});
  writeLocal('campaigns',state.campaigns);
  renderAll();
  if(state.remoteReady){
    try{await campaignsRef().doc(id).delete();setSync('online','Sincronizado')}catch(_){setSync('warn','Cambio local')}
  }
}

function renderIdentity(){
  var b=state.business||{};
  var name=b.businessName||state.user.displayName||'Cuenta comercial';
  els.businessNameTop.textContent=name;
  els.accountName.textContent=state.user.displayName||name;
  els.accountEmail.textContent=state.user.email||'';
  els.accountInitials.textContent=initials(state.user.displayName||name,state.user.email);
}
function renderMetrics(){
  var active=state.campaigns.filter(function(c){return c.status==='active'}).length;
  var budget=state.campaigns.filter(function(c){return c.status!=='paused'}).reduce(function(sum,c){return sum+(c.budgetType==='daily'?Number(c.budgetAmount)||0:0)},0);
  var placements=new Set();
  state.campaigns.forEach(function(c){(c.placements||[]).forEach(function(p){placements.add(p)})});
  els.metricCampaigns.textContent=String(state.campaigns.length);
  els.metricActive.textContent=String(active);
  els.metricBudget.textContent=money(budget);
  els.metricPlacements.textContent=String(placements.size);
}
function objectiveLabel(v){
  return {awareness:'Reconocimiento',traffic:'Tráfico',engagement:'Interacción',leads:'Clientes potenciales',sales:'Ventas',app:'Aplicación'}[v]||v||'—';
}
function statusLabel(v){return {draft:'Borrador',active:'Activa',paused:'Pausada'}[v]||v||'Borrador'}
function locationLabel(c){
  var bits=[c.targetCity,c.targetRegion,c.targetCountry].filter(Boolean);
  return bits.length?bits.join(', '):'Sin ubicación';
}
function renderRecent(){
  var list=state.campaigns.slice(0,5);
  if(!list.length){els.recentCampaigns.className='empty-state';els.recentCampaigns.textContent='Aún no hay campañas.';return}
  els.recentCampaigns.className='placement-list';
  els.recentCampaigns.innerHTML=list.map(function(c){
    return '<div><b>'+escapeHtml(c.name)+'</b><span>'+escapeHtml(objectiveLabel(c.objective))+' · '+escapeHtml(statusLabel(c.status))+' · '+escapeHtml(locationLabel(c))+'</span></div>';
  }).join('');
}
function renderCampaignTable(){
  var term=clean(els.campaignSearch&&els.campaignSearch.value).toLowerCase();
  var status=els.statusFilter&&els.statusFilter.value||'all';
  var list=state.campaigns.filter(function(c){
    var okStatus=status==='all'||c.status===status;
    var hay=(c.name+' '+objectiveLabel(c.objective)+' '+locationLabel(c)).toLowerCase();
    return okStatus&&(!term||hay.indexOf(term)>=0);
  });
  els.campaignEmpty.hidden=!!list.length;
  els.campaignTableBody.innerHTML=list.map(function(c){
    var dates=dateText(c.startDate)+' → '+dateText(c.endDate);
    var budget=money(c.budgetAmount)+' '+(c.budgetType==='daily'?'/ día':'total');
    var next=c.status==='active'?'paused':'active';
    var toggle=c.status==='active'?'Pausar':'Activar';
    return '<tr>'+
      '<td><span class="campaign-name">'+escapeHtml(c.name)+'</span></td>'+
      '<td>'+escapeHtml(objectiveLabel(c.objective))+'</td>'+
      '<td><span class="status-pill status-'+escapeHtml(c.status||'draft')+'">'+escapeHtml(statusLabel(c.status))+'</span></td>'+
      '<td>'+escapeHtml(locationLabel(c))+'</td>'+
      '<td>'+escapeHtml(budget)+'</td>'+
      '<td>'+escapeHtml(dates)+'</td>'+
      '<td><div class="row-actions"><button data-edit="'+escapeHtml(c.id)+'">Editar</button><button data-status="'+escapeHtml(c.id)+'" data-next="'+next+'">'+toggle+'</button><button data-delete="'+escapeHtml(c.id)+'">Eliminar</button></div></td>'+
    '</tr>';
  }).join('');
}
function renderAll(){
  if(!state.user)return;
  renderIdentity();
  renderMetrics();
  renderRecent();
  renderCampaignTable();
}

function showView(name){
  state.view=name;
  qa('.nav-item[data-view]').forEach(function(btn){btn.classList.toggle('active',btn.dataset.view===name)});
  qa('.view').forEach(function(v){v.classList.remove('active')});
  if(name==='overview')els.overviewView.classList.add('active');
  else if(name==='campaigns')els.campaignsView.classList.add('active');
  else{
    var labels={adsets:['Conjuntos de anuncios','Estructura y entrega por audiencia.'],ads:['Anuncios','Creativos y destinos de campaña.'],audiences:['Audiencias','Segmentación y públicos comerciales.'],reports:['Informes','Métricas e historial de resultados.'],billing:['Facturación','Presupuestos, pagos y comprobantes.'],settings:['Configuración','Datos de la cuenta comercial.']};
    var info=labels[name]||['Módulo','Preparado para una siguiente etapa.'];
    els.placeholderTitle.textContent=info[0];
    els.placeholderText.textContent=info[1];
    els.placeholderView.classList.add('active');
  }
  els.appView.classList.remove('menu-open');
  animateWorkspace();
}

function defaultDates(){
  var d=new Date();
  var iso=d.toISOString().slice(0,10);
  els.startDate.value=iso;
  els.endDate.value='';
}
function resetWizard(){
  state.wizardStep=1;
  state.objective='awareness';
  state.editingId=null;
  els.campaignForm.reset();
  defaultDates();
  els.ageMin.value='18';
  els.ageMax.value='65';
  els.budgetAmount.value='50';
  els.targetCountry.value=(state.business&&state.business.country)||'GT';
  qa('input[type="checkbox"]',els.placementsGrid).forEach(function(x,i){x.checked=i===0});
  qa('.choice',els.objectiveGrid).forEach(function(x){x.classList.toggle('active',x.dataset.objective==='awareness')});
  setWizardStep(1);
  setMessage(els.campaignMessage,'');
}
function openCampaign(campaign){
  resetWizard();
  els.campaignModal.hidden=false;
  if(campaign){
    state.editingId=campaign.id;
    state.objective=campaign.objective||'awareness';
    els.campaignName.value=campaign.name||'';
    els.targetCountry.value=campaign.targetCountry||'GT';
    els.targetRegion.value=campaign.targetRegion||'';
    els.targetCity.value=campaign.targetCity||'';
    els.targetRadius.value=String(campaign.targetRadius||0);
    els.ageMin.value=String(campaign.ageMin||18);
    els.ageMax.value=String(campaign.ageMax||65);
    els.budgetType.value=campaign.budgetType||'daily';
    els.budgetAmount.value=String(campaign.budgetAmount||50);
    els.startDate.value=campaign.startDate||new Date().toISOString().slice(0,10);
    els.endDate.value=campaign.endDate||'';
    els.adName.value=campaign.adName||'';
    els.destinationUrl.value=campaign.destinationUrl||'';
    els.creativeUrl.value=campaign.creativeUrl||'';
    els.creativeType.value=campaign.creativeType||'image';
    els.videoSound.value=String(!!campaign.videoSound);
    qa('.choice',els.objectiveGrid).forEach(function(x){x.classList.toggle('active',x.dataset.objective===state.objective)});
    var selected=new Set(campaign.placements||[]);
    qa('input[type="checkbox"]',els.placementsGrid).forEach(function(x){x.checked=selected.has(x.value)});
  }
  updateReview();
}
function closeCampaign(){els.campaignModal.hidden=true}
function setWizardStep(step){
  state.wizardStep=Math.max(1,Math.min(4,Number(step)||1));
  qa('.wizard-step').forEach(function(x){x.classList.toggle('active',Number(x.dataset.step)===state.wizardStep)});
  qa('.wizard-page').forEach(function(x){x.classList.toggle('active',Number(x.dataset.page)===state.wizardStep)});
  els.wizardBack.disabled=state.wizardStep===1;
  els.wizardNext.textContent=state.wizardStep===4?'Guardar campaña':'Continuar';
  els.wizardSubtitle.textContent={1:'Objetivo y estructura',2:'Ubicación y audiencia',3:'Presupuesto y calendario',4:'Creativo y revisión'}[state.wizardStep];
  if(state.wizardStep===4)updateReview();
}
function selectedPlacements(){return qa('input[type="checkbox"]:checked',els.placementsGrid).map(function(x){return x.value})}
function validateStep(step){
  setMessage(els.campaignMessage,'');
  if(step===1&&!clean(els.campaignName.value)){setMessage(els.campaignMessage,'Escribe el nombre de la campaña.','error');return false}
  if(step===2){
    if(!selectedPlacements().length){setMessage(els.campaignMessage,'Selecciona al menos una ubicación de TaskFlow.','error');return false}
    var min=Number(els.ageMin.value),max=Number(els.ageMax.value);
    if(min<13||max>65||min>max){setMessage(els.campaignMessage,'Revisa el rango de edad.','error');return false}
  }
  if(step===3){
    if(Number(els.budgetAmount.value)<=0){setMessage(els.campaignMessage,'El presupuesto debe ser mayor que cero.','error');return false}
    if(!els.startDate.value){setMessage(els.campaignMessage,'Selecciona la fecha de inicio.','error');return false}
    if(els.endDate.value&&els.endDate.value<els.startDate.value){setMessage(els.campaignMessage,'La fecha final no puede ser anterior al inicio.','error');return false}
  }
  if(step===4){
    var dest=clean(els.destinationUrl.value),creative=clean(els.creativeUrl.value);
    if(dest&&!/^https:\/\//i.test(dest)){setMessage(els.campaignMessage,'La URL de destino debe usar HTTPS.','error');return false}
    if(creative&&!/^https:\/\//i.test(creative)){setMessage(els.campaignMessage,'La URL del creativo debe usar HTTPS.','error');return false}
  }
  return true;
}
function campaignFromForm(){
  var existing=state.editingId?state.campaigns.find(function(c){return c.id===state.editingId}):null;
  return {
    id:state.editingId||makeId(),
    ownerUid:uid(),
    businessName:state.business&&state.business.businessName||'',
    name:clean(els.campaignName.value)||'Campaña sin nombre',
    objective:state.objective,
    status:existing&&existing.status||'draft',
    targetCountry:els.targetCountry.value,
    targetRegion:clean(els.targetRegion.value),
    targetCity:clean(els.targetCity.value),
    targetRadius:Number(els.targetRadius.value)||0,
    ageMin:Number(els.ageMin.value)||18,
    ageMax:Number(els.ageMax.value)||65,
    placements:selectedPlacements(),
    budgetType:els.budgetType.value,
    budgetAmount:Number(els.budgetAmount.value)||0,
    currency:'GTQ',
    startDate:els.startDate.value,
    endDate:els.endDate.value,
    adName:clean(els.adName.value),
    destinationUrl:clean(els.destinationUrl.value),
    creativeUrl:clean(els.creativeUrl.value),
    creativeType:els.creativeType.value,
    videoSound:els.videoSound.value==='true',
    createdAt:existing&&existing.createdAt||nowIso(),
    updatedAt:nowIso(),
    schemaVersion:1
  };
}
function updateReview(){
  var c=campaignFromForm();
  els.campaignReview.innerHTML=
    '<b>'+escapeHtml(c.name)+'</b><br>'+
    'Objetivo: '+escapeHtml(objectiveLabel(c.objective))+'<br>'+
    'Audiencia: '+escapeHtml(locationLabel(c))+' · '+c.ageMin+'–'+c.ageMax+' años<br>'+
    'Ubicaciones: '+escapeHtml((c.placements||[]).join(', ')||'Ninguna')+'<br>'+
    'Presupuesto: '+escapeHtml(money(c.budgetAmount))+' '+(c.budgetType==='daily'?'diario':'total')+'<br>'+
    'Estado inicial: Borrador';
}
async function saveCampaignDraft(closeAfter){
  if(!validateStep(1))return false;
  var c=campaignFromForm();
  if(!c.placements.length){
    setMessage(els.campaignMessage,'Selecciona al menos una ubicación antes de guardar.','error');
    return false;
  }
  els.saveDraftBtn.disabled=true;
  els.wizardNext.disabled=true;
  try{
    await persistCampaign(c);
    setMessage(els.campaignMessage,'Campaña guardada.','success');
    toast('Campaña guardada como borrador.');
    if(closeAfter!==false){closeCampaign();showView('campaigns')}
    return true;
  }finally{
    els.saveDraftBtn.disabled=false;
    els.wizardNext.disabled=false;
  }
}
async function wizardNext(){
  if(!validateStep(state.wizardStep))return;
  if(state.wizardStep<4){setWizardStep(state.wizardStep+1);return}
  await saveCampaignDraft(true);
}

async function toggleCampaign(id,next){
  var c=state.campaigns.find(function(x){return x.id===id});if(!c)return;
  if(next==='active'&&(!c.creativeUrl||!c.destinationUrl)){toast('Añade URL de destino y creativo antes de activar.');openCampaign(c);setWizardStep(4);return}
  c=Object.assign({},c,{status:next,updatedAt:nowIso()});
  await persistCampaign(c);
  toast(next==='active'?'Campaña activada.':'Campaña pausada.');
}

function bindEvents(){
  els.loginTab.addEventListener('click',function(){setAuthMode('login')});
  els.registerTab.addEventListener('click',function(){setAuthMode('register')});
  els.authForm.addEventListener('submit',handleAuthSubmit);
  els.businessForm.addEventListener('submit',async function(e){
    e.preventDefault();
    setMessage(els.businessMessage,'');
    var name=clean(els.businessName.value);
    if(!name){setMessage(els.businessMessage,'Escribe el nombre comercial.','error');return}
    try{
      await saveBusiness({businessName:name,country:els.businessCountry.value,phone:els.businessPhone.value,website:els.businessWebsite.value});
      await loadCampaigns();
      showApp();
    }catch(_){setMessage(els.businessMessage,'No fue posible guardar la cuenta comercial.','error')}
  });
  els.logoutBtn.addEventListener('click',function(){state.auth.signOut()});
  els.mobileMenuBtn.addEventListener('click',function(){els.appView.classList.toggle('menu-open')});
  qa('.nav-item[data-view]').forEach(function(btn){btn.addEventListener('click',function(){showView(btn.dataset.view)})});
  qa('[data-view-link]').forEach(function(btn){btn.addEventListener('click',function(){showView(btn.dataset.viewLink)})});
  qa('[data-action="new-campaign"]').forEach(function(btn){btn.addEventListener('click',function(){openCampaign(null)})});
  qa('[data-action="refresh"]').forEach(function(btn){btn.addEventListener('click',loadCampaigns)});
  els.createCampaignBtn.addEventListener('click',function(){openCampaign(null)});
  els.closeCampaignModal.addEventListener('click',closeCampaign);
  els.campaignModal.addEventListener('click',function(e){if(e.target===els.campaignModal)closeCampaign()});
  els.objectiveGrid.addEventListener('click',function(e){
    var choice=e.target.closest('.choice');if(!choice)return;
    state.objective=choice.dataset.objective;
    qa('.choice',els.objectiveGrid).forEach(function(x){x.classList.toggle('active',x===choice)});
  });
  qa('.wizard-step').forEach(function(btn){btn.addEventListener('click',function(){var target=Number(btn.dataset.step);if(target<=state.wizardStep||validateStep(state.wizardStep))setWizardStep(target)})});
  els.wizardBack.addEventListener('click',function(){setWizardStep(state.wizardStep-1)});
  els.wizardNext.addEventListener('click',wizardNext);
  els.saveDraftBtn.addEventListener('click',function(){saveCampaignDraft(true)});
  els.campaignForm.addEventListener('input',function(){if(state.wizardStep===4)updateReview()});
  els.campaignSearch.addEventListener('input',renderCampaignTable);
  els.statusFilter.addEventListener('change',renderCampaignTable);
  els.campaignTableBody.addEventListener('click',async function(e){
    var edit=e.target.closest('[data-edit]');if(edit){var c=state.campaigns.find(function(x){return x.id===edit.dataset.edit});if(c)openCampaign(c);return}
    var status=e.target.closest('[data-status]');if(status){await toggleCampaign(status.dataset.status,status.dataset.next);return}
    var del=e.target.closest('[data-delete]');if(del){
      var c2=state.campaigns.find(function(x){return x.id===del.dataset.delete});if(!c2)return;
      if(confirm('¿Eliminar la campaña "'+c2.name+'"?')){await removeCampaign(c2.id);toast('Campaña eliminada.')}
    }
  });
}

async function handleSignedIn(user){
  state.user=user;
  setSync('', 'Local');
  await loadBusiness();
  if(state.business&&state.business.accountStatus==='suspended'){
    showAuth();
    setMessage(els.authMessage,'Esta cuenta comercial está suspendida.','error');
    await state.auth.signOut();
    return;
  }
  if(!state.business){showBusinessOnboarding();return}
  await loadCampaigns();
  showApp();
}
function handleSignedOut(){
  state.user=null;state.business=null;state.campaigns=[];
  showAuth();
}

async function boot(){
  cacheEls();
  bindEvents();
  setAuthMode('login');
  defaultDates();
  try{
    var auth=initFirebase();
    auth.onAuthStateChanged(function(user){
      if(user)handleSignedIn(user).catch(function(){showAuth();setMessage(els.authMessage,'No fue posible cargar la cuenta comercial.','error')});
      else handleSignedOut();
      if(els.boot)els.boot.hidden=true;
    });
  }catch(err){
    if(els.boot)els.boot.hidden=true;
    showAuth();
    setMessage(els.authMessage,err&&err.message||'No fue posible iniciar TaskFlow ADS.','error');
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();