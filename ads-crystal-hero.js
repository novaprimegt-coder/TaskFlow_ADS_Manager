/* TaskFlow ADS: cristal energético WebGL2 azul/cian; implementación independiente. */
(()=>{'use strict';
const hero=document.getElementById('parallaxHero');
const scene=document.getElementById('tfCrystalScene');
const canvas=document.getElementById('tfCrystalCanvas');
if(!hero||!scene||!canvas)return;
const vertexShader="#version 300 es\nin vec2 aPosition;\nvoid main(){gl_Position=vec4(aPosition,0.,1.);}";
const fragmentShader="#version 300 es\nprecision highp float;\nuniform vec2 uResolution;\nuniform vec2 uPointer;\nuniform float uTime;\nout vec4 fragColor;\nconst float R=.324;\nconst float TAU=6.283185307;\nfloat hash21(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}\nfloat ribbon(float d,float w){float x=d/max(.0001,w);return exp(-x*x);}\nvoid main(){\n vec2 q=(gl_FragCoord.xy-.5*uResolution)/min(uResolution.x,uResolution.y);\n float r=length(q),a=atan(q.y,q.x),t=uTime;\n float inside=1.-smoothstep(R*.88,R*1.002,r);\n float south=1.-smoothstep(-.66,.86,q.y/R);\n vec3 azure=vec3(.04,.34,1.);\n vec3 cyan=vec3(.06,.93,.98);\n vec3 ice=vec3(.7,.94,1.);\n vec3 ink=vec3(.025,.16,.42);\n vec3 col=vec3(0.);\n float depth=sqrt(max(0.,1.-r*r/(R*R)));\n float bend=.5+.5*sin(q.x*21.+q.y*12.+t*.11);\n float twist=sin(a*8.+4.*sin(q.y*6.+t*.17)-t*.12);\n float crystal=pow(max(0.,sin(q.x*72.+q.y*43.+twist*1.5)),12.);\n float facet=pow(abs(sin(a*18.+q.y*8.-t*.09)),22.);\n float bottom=pow(max(0.,(R-q.y)/(2.*R)),2.4);\n col += ink*(.05+.10*bottom)*inside;\n col += mix(azure,cyan,bend)*(.04+.08*depth)*(.3+.7*south)*inside;\n col += cyan*crystal*.14*south*inside;\n col += azure*facet*.14*bottom*inside;\n vec2 cells=q*690.,cell=floor(cells),local=fract(cells)-.5;\n float seed=hash21(cell);\n float spark=step(.9875,seed)*ribbon(length(local),mix(.048,.19,hash21(cell+37.21)));\n spark *= (.65+.35*sin(t*(.5+hash21(cell+7.6)*1.4)+seed*TAU));\n col += mix(azure,ice,hash21(cell+19.4))*spark*inside*(.25+.75*south)*.72;\n float wav=.0045*sin(a*16.+t*.57)+.0035*sin(a*49.-t*1.2)+.0019*sin(a*139.+t*2.6);\n float d=r-R-wav;\n col += azure*ribbon(d,.027)*.30+cyan*ribbon(d,.011)*.4+ice*ribbon(d,.0023)*.72;\n for(int k=0;k<5;k++){\n  float f=float(k),freq=mix(10.,74.,f/4.);\n  float phase=t*(.31+f*.19)*(mod(f,2.)<.5?1.:-1.);\n  float displ=sin(a*freq+phase)*(.004+.003*f)+sin(a*freq*3.1-phase*1.9)*.0017;\n  float taper=.5+.5*sin(a*3.+f*1.9+t*.11);\n  col += mix(azure,cyan,f/5.)*ribbon(r-R-displ,.0011+f*.00016)*(.13+.40*taper*taper);\n }\n float angle=a+t*.15;\n float arc=pow(max(0.,sin(angle*6.+sin(angle*23.-t*1.1)*.6)),20.);\n float streak=.003+.013*arc*pow(.5+.5*sin(a*9.-t*.27),2.);\n col += mix(cyan,ice,.5)*ribbon(r-R-streak,.0016)*arc;\n col += azure*ribbon(r-R-streak,.014)*arc*.3;\n float flash=pow(max(0.,sin(a*12.+t*.46+sin(a*53.-t*1.3))),32.);\n col += ice*ribbon(r-R,.0055)*flash*.45;\n vec2 contact=uPointer*.27;\n col += cyan*exp(-dot(q-contact,q-contact)*18.)*inside*.04;\n float intensity=max(col.r,max(col.g,col.b));\n float opacity=clamp(intensity*.98,0.,.82)*(1.-smoothstep(R*1.21,R*1.36,r));\n fragColor=vec4(min(col,vec3(1.)),opacity);\n}";
const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
const mobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const lowPower=navigator.connection?.saveData===true;
const staticMode=()=>!!motion?.matches||lowPower;
let gl=null,program=null,buffer=null,uniforms=null,ready=false,lost=false,visible=true,raf=0,last=0,lastSample=0,time=0,point=[0,0],target=[0,0];
function compile(type,source){
 const shader=gl.createShader(type);
 gl.shaderSource(shader,source);gl.compileShader(shader);
 if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const err=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(err||'Error WebGL');}
 return shader;
}
function init(){
 if(lost)return;
 try{
  gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,antialias:false,depth:false,stencil:false,powerPreference:'low-power'});
  if(!gl)return;
  const v=compile(gl.VERTEX_SHADER,vertexShader),f=compile(gl.FRAGMENT_SHADER,fragmentShader);
  const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const msg=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(msg||'Vinculación WebGL');}
  program=p;buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const pos=gl.getAttribLocation(p,'aPosition');if(pos<0)throw new Error('Atributo ausente');
  gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
  uniforms={size:gl.getUniformLocation(p,'uResolution'),time:gl.getUniformLocation(p,'uTime'),point:gl.getUniformLocation(p,'uPointer')};
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);ready=true;
  scene.classList.add('tf-crystal-live');resize();start();
 }catch(error){console.warn('TaskFlow ADS: respaldo visual Crystalizado activado.',error?.message||error);scene.classList.remove('tf-crystal-live');ready=false;}
}
function draw(){
 if(!ready||lost||!gl)return;
 gl.useProgram(program);gl.viewport(0,0,canvas.width,canvas.height);
 gl.uniform2f(uniforms.size,canvas.width,canvas.height);
 gl.uniform1f(uniforms.time,staticMode()?2.4:time);
 gl.uniform2f(uniforms.point,point[0],point[1]);
 gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}
function resize(){
 if(!ready)return;
 const rect=scene.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,mobile?1.25:1.5);
 const pixelBudget=mobile?650000:1100000;
 const dpr=Math.min(ratio,Math.sqrt(pixelBudget/Math.max(1,rect.width*rect.height)));
 const w=Math.max(2,Math.round(rect.width*dpr)),h=Math.max(2,Math.round(rect.height*dpr));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
 draw();
}
function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;lastSample=0}
function enabled(){return ready&&!lost&&visible&&!document.hidden&&!document.getElementById('authView')?.hidden}
function tick(now){
 raf=0;if(!enabled())return;
 if(!lastSample||now-lastSample>=(mobile?42:30)){
  const dt=last?Math.min(.075,Math.max(0,(now-last)/1000)):.033;
  last=now;lastSample=now;time+=dt;
  point[0]+=(target[0]-point[0])*.05;point[1]+=(target[1]-point[1])*.05;
  draw();
 }
 if(!staticMode())raf=requestAnimationFrame(tick);
}
function start(){if(!enabled())return;if(staticMode()){draw();return}if(!raf)raf=requestAnimationFrame(tick)}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;stop();ready=false;scene.classList.remove('tf-crystal-live')});
canvas.addEventListener('webglcontextrestored',()=>{lost=false;program=null;buffer=null;init()});
const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
 visible=entries.some(e=>e.isIntersecting);if(visible)start();else stop();
},{threshold:.01}):null;
if(intersection)intersection.observe(hero);
const ro=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;
if(ro)ro.observe(scene);else window.addEventListener('resize',resize,{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else start()});
if(motion?.addEventListener)motion.addEventListener('change',()=>{stop();draw();start()});
if(!mobile)hero.addEventListener('pointermove',e=>{
 const r=hero.getBoundingClientRect();target=[Math.max(-1,Math.min(1,((e.clientX-r.left)/Math.max(1,r.width)-0.5)*2)),Math.max(-1,Math.min(1,(.5-(e.clientY-r.top)/Math.max(1,r.height))*2))];
},{passive:true});
init();
})();