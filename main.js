// ================= SUGAR RUSH ROYALE — main.js =================
// Game core: renderer + bloom, fixed-step capsule physics (anti-tunnel),
// up-to-10 local racers (keyboard x2 + gamepads + AI bots), countdown,
// shared/solo camera, particles, HUD, lobby & race flow.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const T = THREE;
const LVL = window.LEVELS || [];
// Live binding to build.js ThemeAPI (loads after this module may run).
const API = new Proxy({}, {
  get(_t, k){ const a = window.ThemeAPI; if(!a) return undefined; const v = a[k]; return typeof v === 'function' ? v.bind(a) : v; },
  has(_t, k){ return !!(window.ThemeAPI && k in window.ThemeAPI); }
});

// ================= constants =================
const CY_R = 0.42, CY_H = 1.04;
const GRAV = 34, JUMP_V = 11.2, MAX_SPD = 6.2, MOVE_ACC = 46, DIVE_V = 11;
const FIXED = 1/120;
const MAX_RACERS = 10;
const MAX_HUMANS = 4;   // local human players: keyboard x2 + gamepads
// shared with bots.js (ballistic maths must match the player exactly)
window.SRR_CONST = { GRAV, JUMP_V, MAX_SPD, MOVE_ACC, DIVE_V,
  AIRTIME: 2*JUMP_V/GRAV };   // full-jump airtime ≈ 0.659s

// ================= state =================
const S = {
  renderer:null, composer:null, scene:null, camera:null, water:null, sky:null, particles:null,
  sun:null, playerLight:null, views:[],
  levelIdx:0, phase:'menu',          // menu | countdown | race | done
  paused:false, worldT:0, raceClock:0, tLeft:0,
  camYaw:Math.PI, camPitch:0.46, camDist:9.5, camShake:0,
  dragging:false, lastX:0, lastY:0,
  color:'#ff5c9d',
  countdownT:0, endGraceT:0,
  extendT:0,
  finishCount:0,
  hudT:0
};
const racers = [];
window._S = S;

// ================= storage =================
const store = {
  get(){ try{ return JSON.parse(localStorage.getItem('srr-save2')||'{}'); }catch(e){ return {}; } },
  set(o){ try{ localStorage.setItem('srr-save2', JSON.stringify(o)); }catch(e){} }
};

// ================= audio =================
const AU = {
  ctx:null, on:true,
  ensure(){ if(!this.ctx){ try{ this.ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } },
  beep(freq, dur=0.1, type='sine', vol=0.16, slide=0){
    if(!this.on) return; this.ensure(); if(!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(40,freq+slide), t+dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t+dur+0.02);
  },
  jump(){ this.beep(520,0.14,'sine',0.10,220); },
  land(){ this.beep(180,0.08,'triangle',0.08); },
  coin(){ this.beep(880,0.09,'square',0.07); this.beep(1320,0.12,'square',0.05); },
  boing(){ this.beep(300,0.22,'sine',0.16,500); },
  bump(){ this.beep(140,0.12,'sawtooth',0.12,-60); },
  hit(){ this.beep(90,0.3,'sawtooth',0.2,-40); },
  whoosh(){ this.beep(220,0.3,'sawtooth',0.1,660); },
  cd(n){ this.beep(n===0?880:440, n===0?0.35:0.12, 'square', 0.14); },
  win(){ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>this.beep(f,0.18,'square',0.11),i*130)); },
  lose(){ [400,300,220,150].forEach((f,i)=>setTimeout(()=>this.beep(f,0.2,'sawtooth',0.11),i*150)); },
  fall(){ this.beep(600,0.5,'sine',0.12,-480); }
};

// ================= DOM =================
const $ = id => document.getElementById(id);
const UI = {};
['hud','clock','progbar','racestrip','lvname','lvtime','cpBox','stBox','hint','qual','rankBox','rankList',
 'menu-ov','pause-ov','res-ov','resTitle','resStats','pauseStats','toasts','lvlSel','swr','ccust',
 'count-ov','countNum','lobbySlots','btnPlay','btnReset','btnSound','btnResume','btnQuit',
 'btnNext','btnRetry','btnMenu','botCount','splitlines','joinKb2','fxSel'].forEach(id=>{ UI[id]=$(id); });
UI.menu = UI['menu-ov']; UI.resOv = UI['res-ov']; UI.count = UI['count-ov'];
UI.pause = UI['pause-ov']; UI.prog = UI.progbar; UI.clockEl = UI.clock;

function fmt(s){ s=Math.max(0,Math.ceil(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }

let toastTimers = [];
function toast(msg){
  if(!UI.toasts) return;
  const d = document.createElement('div');
  d.className = 'toast bump'; d.textContent = msg;
  UI.toasts.appendChild(d);
  setTimeout(()=>{ d.style.transition='opacity .4s'; d.style.opacity='0'; }, 1500);
  setTimeout(()=>{ d.remove(); }, 2000);
  while(UI.toasts.children.length > 3) UI.toasts.firstChild.remove();
}

// ================= renderer / scene =================
let FX_QUALITY = 'high';
function initRenderer(){
  const canvas = $('c');
  S.renderer = new T.WebGLRenderer({canvas, antialias:true});
  S.renderer.setSize(innerWidth, innerHeight);
  S.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  S.renderer.shadowMap.enabled = true;
  S.renderer.shadowMap.type = T.PCFSoftShadowMap;
  S.renderer.toneMapping = T.ACESFilmicToneMapping;
  S.renderer.toneMappingExposure = 1.06;
  S.camera = new T.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 320);
  S.camera.position.set(0,6,-8);
  addEventListener('resize', onResize);
}
function onResize(){
  S.camera.aspect = innerWidth/innerHeight;
  S.camera.updateProjectionMatrix();
  S.renderer.setSize(innerWidth, innerHeight);
  if(S.composer) S.composer.setSize(innerWidth, innerHeight);
}
function buildComposer(){
  try{
    const c = new EffectComposer(S.renderer);
    c.addPass(new RenderPass(S.scene, S.camera));
    const bloom = new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), 0.32, 0.62, 0.82);
    c.addPass(bloom);
    c.addPass(new OutputPass());
    return c;
  }catch(e){ console.warn('bloom unavailable, plain render', e); return null; }
}

function makeLights(scene, L){
  const hemi = new T.HemisphereLight(0xffffff, 0x6688cc, 0.85);
  scene.add(hemi);
  const sun = new T.DirectionalLight(0xfff2dd, 1.15);
  sun.position.set(14, 26, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36; sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36; sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0004;
  scene.add(sun); scene.add(sun.target);
  const pl = new T.PointLight(0xffe0f0, 0.5, 24);
  scene.add(pl);
  S.playerLight = pl;
  return sun;
}

function makeSky(L){
  const c1 = new T.Color(L.sky[0], L.sky[1], L.sky[2]);
  const c2 = new T.Color(L.fog[0], L.fog[1], L.fog[2]);
  const geo = new T.SphereGeometry(150, 24, 18);
  const mat_ = new T.ShaderMaterial({
    side: T.BackSide, depthWrite:false,
    uniforms:{ top:{value:c1}, bot:{value:c2} },
    vertexShader:`varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`varying vec3 vP; uniform vec3 top; uniform vec3 bot;
      void main(){ float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(bot,top,pow(h,0.75)),1.0); }`
  });
  const m = new T.Mesh(geo, mat_);
  m.position.z = L.road[1][1]/2;
  return m;
}

function makeWater(L){
  const z1 = L.road[1][1];
  const colA = L.theme==='honey' ? new T.Color(0xe8961f) : L.theme==='canyon' ? new T.Color(0x2ec96e) : new T.Color(0x2f6bff);
  const colB = colA.clone().lerp(new T.Color(0xffffff), 0.55);
  const mat_ = new T.ShaderMaterial({
    transparent:true,
    uniforms:{ cA:{value:colA}, cB:{value:colB}, tt:{value:0} },
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`varying vec2 vUv; uniform vec3 cA; uniform vec3 cB; uniform float tt;
      void main(){
        // bold rolling waves: two crossing sine trains + sparkle caps
        float w1 = sin(vUv.x*140.0 + tt*1.6);
        float w2 = sin(vUv.y*180.0 - tt*2.2 + w1*0.7);
        float w = w1*0.5 + w2*0.5;
        float band = smoothstep(-0.25, 0.3, w);
        vec3 c = mix(cA, cB, band);
        // white foam caps on the crests
        float foam = smoothstep(0.78, 0.95, w);
        c = mix(c, vec3(1.0), foam*0.85);
        gl_FragColor = vec4(c, 0.96);
      }`
  });
  const m = new T.Mesh(new T.PlaneGeometry(300, z1+120), mat_);
  m.rotation.x = -Math.PI/2;
  m.position.set(0, -5.5, z1/2);
  return m;
}

// ================= particles =================
function makeParticles(scene){
  const N = 320;
  const geo = new T.BufferGeometry();
  const pos = new Float32Array(N*3), col = new Float32Array(N*3);
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  const cnv = document.createElement('canvas'); cnv.width = cnv.height = 32;
  const cx = cnv.getContext('2d');
  const grd = cx.createRadialGradient(16,16,1,16,16,15);
  grd.addColorStop(0,'rgba(255,255,255,1)'); grd.addColorStop(0.5,'rgba(255,255,255,.6)'); grd.addColorStop(1,'rgba(255,255,255,0)');
  cx.fillStyle = grd; cx.fillRect(0,0,32,32);
  const tex = new T.CanvasTexture(cnv);
  const m = new T.PointsMaterial({size:0.36, map:tex, transparent:true, depthWrite:false,
    vertexColors:true, blending:T.AdditiveBlending, sizeAttenuation:true});
  const pts = new T.Points(geo, m);
  pts.frustumCulled = false;
  scene.add(pts);
  const pool = [];
  for(let i=0;i<N;i++) pool.push({life:0, max:1, vx:0, vy:0, vz:0, grav:0, r:1, g:1, b:1});
  for(let i=0;i<N;i++) pos[i*3+1] = -999;
  return {
    dispose(){ geo.dispose(); m.dispose(); tex.dispose(); },
    burst(x,y,z,hex,n,spread,up,grav,life){
      const c = new T.Color(hex);
      let made = 0;
      for(let i=0;i<N && made<n;i++){
        const p = pool[i];
        if(p.life > 0) continue;
        p.life = p.max = (life||0.8)*(0.6+Math.random()*0.7);
        pos[i*3] = x + (Math.random()-0.5)*spread;
        pos[i*3+1] = y + (Math.random()-0.5)*spread*0.5;
        pos[i*3+2] = z + (Math.random()-0.5)*spread;
        p.vx = (Math.random()-0.5)*spread*3.2;
        p.vy = up*(0.5+Math.random()*0.8);
        p.vz = (Math.random()-0.5)*spread*3.2;
        p.grav = grav;
        p.r = c.r; p.g = c.g; p.b = c.b;
        made++;
      }
    },
    update(dt){
      let dirty = false;
      for(let i=0;i<N;i++){
        const p = pool[i];
        if(p.life <= 0) continue;
        p.life -= dt;
        dirty = true;
        if(p.life <= 0){ pos[i*3+1] = -999; col[i*3]=col[i*3+1]=col[i*3+2]=0; continue; }
        p.vy -= p.grav*dt;
        pos[i*3] += p.vx*dt; pos[i*3+1] += p.vy*dt; pos[i*3+2] += p.vz*dt;
        const f = Math.min(1, p.life/(p.max*0.5));
        col[i*3] = p.r*f; col[i*3+1] = p.g*f; col[i*3+2] = p.b*f;
      }
      if(dirty){ geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; }
    }
  };
}

// ================= bean character =================
const GEO = {
  cap: null, sph: null, small: null, pupil: null, foot: null, arm: null
};
function initGeo(){
  GEO.cap = new T.CapsuleGeometry(CY_R, CY_H-CY_R*2, 8, 18);
  GEO.sph = new T.SphereGeometry(0.27, 14, 12);
  GEO.small = new T.SphereGeometry(0.125, 12, 10);
  GEO.pupil = new T.SphereGeometry(0.06, 10, 8);
  GEO.foot = new T.SphereGeometry(0.15, 10, 8);
  GEO.arm = new T.CapsuleGeometry(0.095, 0.3, 4, 8);
}
function nameTagSprite(name, colorHex, isHuman){
  const cnv = document.createElement('canvas');
  cnv.width = 256; cnv.height = 64;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = isHuman ? 'rgba(60,20,90,0.8)' : 'rgba(20,12,44,0.72)';
  ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(8, 8, 240, 48, 20); else ctx.rect(8,8,240,48);
  ctx.fill();
  ctx.strokeStyle = colorHex; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px "Segoe UI", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 33);
  const tex = new T.CanvasTexture(cnv);
  const spr = new T.Sprite(new T.SpriteMaterial({map:tex, depthTest:false, transparent:true}));
  spr.scale.set(1.75, 0.44, 1);
  spr.position.y = 1.62;
  return spr;
}
function buildBean(colorHex, name, isHuman){
  const g = new T.Group();
  const inner = new T.Group();
  g.add(inner);
  const col = new T.Color(colorHex);
  const body = new T.Mesh(GEO.cap, new T.MeshStandardMaterial({color:col, roughness:0.42, metalness:0.03, emissive:col.clone().multiplyScalar(0.1)}));
  body.position.y = CY_H/2;
  body.castShadow = true;
  inner.add(body);
  const belly = new T.Mesh(GEO.sph, new T.MeshStandardMaterial({color:0xffffff, roughness:0.15, metalness:0.05, transparent:true, opacity:0.35}));
  belly.position.set(0, CY_H*0.62, 0.26);
  belly.scale.set(1,1.28,0.4);
  inner.add(belly);
  const eyeW = new T.MeshStandardMaterial({color:0xffffff, roughness:0.25});
  const eyeB = new T.MeshStandardMaterial({color:0x1a1a24, roughness:0.3});
  for(let s of [-1,1]){
    const ew = new T.Mesh(GEO.small, eyeW);
    ew.position.set(s*0.16, CY_H*0.72, 0.33);
    ew.scale.set(1,1.25,0.62);
    inner.add(ew);
    const eb = new T.Mesh(GEO.pupil, eyeB);
    eb.position.set(s*0.17, CY_H*0.74, 0.42);
    inner.add(eb);
  }
  const footM = new T.MeshStandardMaterial({color:col.clone().multiplyScalar(0.72), roughness:0.5});
  const armM = new T.MeshStandardMaterial({color:col.clone().multiplyScalar(0.9), roughness:0.45});
  const legL = new T.Mesh(GEO.foot, footM); legL.scale.set(0.85,0.6,1.3); legL.castShadow = true;
  const legR = new T.Mesh(GEO.foot, footM); legR.scale.set(0.85,0.6,1.3); legR.castShadow = true;
  legL.position.set(-0.18, 0.09, 0.05); legR.position.set(0.18, 0.09, 0.05);
  inner.add(legL); inner.add(legR);
  const armL = new T.Mesh(GEO.arm, armM); armL.castShadow = true;
  const armR = new T.Mesh(GEO.arm, armM); armR.castShadow = true;
  const armLP = new T.Group(), armRP = new T.Group();
  armL.position.y = -0.17; armR.position.y = -0.17;
  armLP.add(armL); armRP.add(armR);
  armLP.position.set(-0.4, CY_H*0.62, 0); armRP.position.set(0.4, CY_H*0.62, 0);
  armLP.rotation.z = 0.5; armRP.rotation.z = -0.5;
  inner.add(armLP); inner.add(armRP);
  g.add(nameTagSprite(name, colorHex, isHuman));
  return {g, inner, armLP, armRP, legL, legR, body};
}

// ================= lobby =================
const COLORS = ['#ff5c9d','#31e6ff','#ffd23e','#58e06c','#a25cff','#ff8a3d','#ff4d4d','#ffffff','#ffa3d1','#7fd0f7'];
const lobby = {
  humans: [ {name:'P1', color:0, input:{kind:'kb', map:0}} ],   // map 0 = WASD
  botFill: true,
  botCount: -1   // -1 = auto fill to 10; 0..9 = explicit bot count
};
function freeColors(){
  const used = new Set(lobby.humans.map(h=>h.color));
  return COLORS.map((c,i)=>i).filter(i=>!used.has(i));
}
function joinHuman(input){
  if(lobby.humans.length >= MAX_HUMANS) return false;
  const free = freeColors();
  if(!free.length) return false;
  let name;
  if(input.kind==='kb') name = 'P'+(lobby.humans.length+1);
  else name = '🎮'+(input.idx+1);
  lobby.humans.push({name, color:free[0], input});
  refreshLobbyUI();
  AU.ensure(); AU.beep(660,0.08);
  return true;
}
function removeHuman(i){
  if(i===0) return; // P1 stays
  lobby.humans.splice(i,1);
  refreshLobbyUI();
}
function refreshLobbyUI(){
  if(!UI.lobbySlots) return;
  UI.lobbySlots.innerHTML = '';
  lobby.humans.forEach((h,i)=>{
    const d = document.createElement('div');
    d.className = 'slot';
    const inTxt = h.input.kind==='kb'
      ? (h.input.map===0 ? '⌨ WASD' : '⌨ ↑↓←→')
      : '🎮 手柄 '+(h.input.idx+1);
    d.innerHTML = '<span class="sdot" style="background:'+COLORS[h.color]+'"></span>'+
      '<span class="snm">'+h.name+'</span><span class="sin">'+inTxt+'</span>'+
      (i>0?'<span class="srm" title="移除">✕</span>':'<span class="sin">房主</span>');
    d.querySelector('.sdot').onclick = ()=>{ const free = freeColors().filter(c=>c!==h.color); h.color = free[(free.indexOf(h.color)+1) % free.length] || free[0] || h.color; h.color = free[0]!==undefined ? free[(free.indexOf(h.color)+1+free.length)%free.length] : h.color; refreshLobbyUI(); };
    const rm = d.querySelector('.srm');
    if(rm) rm.onclick = ()=>removeHuman(i);
    UI.lobbySlots.appendChild(d);
  });
  const bots = lobby.botCount >= 0
    ? Math.min(lobby.botCount, MAX_RACERS - lobby.humans.length)
    : (lobby.botFill ? MAX_RACERS - lobby.humans.length : 0);
  const total = lobby.humans.length + bots;
  const info = document.createElement('div');
  info.className = 'slotinfo';
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let padN = 0;
  for(const gp of pads){ if(gp && gp.connected) padN++; }
  info.innerHTML = '👥 玩家：<b>'+lobby.humans.length+' / '+MAX_HUMANS+'</b> 人類 ＋ <b>'+bots+'</b> 機械人（共 <b>'+total+'</b> 人混戰）'+
    (lobby.humans.length > 1 ? ' · 🖥 分屏 '+lobby.humans.length+' 視角' : '')+
    '<br>🎮 已偵測手柄：<b>'+padN+'</b>'+(padN ? '（按 A 加入）' : '（插入手柄後撳任何掣即可偵測）');
  UI.lobbySlots.appendChild(info);
}

// ================= input =================
const KB_MAPS = [
  {left:['KeyA'], right:['KeyD'], up:['KeyW'], down:['KeyS'], jump:['Space'], dive:['ShiftLeft']},
  {left:['ArrowLeft'], right:['ArrowRight'], up:['ArrowUp'], down:['ArrowDown'], jump:['ControlRight','Numpad0','Enter'], dive:['ShiftRight','Slash']}
];
const keys = {};
addEventListener('keydown', e=>{
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if(e.code === 'Escape') togglePause();
  // lobby join: any P2-map key while in menu
  if(S.phase === 'menu' && !e.repeat){
    if(KB_MAPS[1].up.includes(e.code) || KB_MAPS[1].left.includes(e.code) || KB_MAPS[1].right.includes(e.code)){
      if(!lobby.humans.some(h=>h.input.kind==='kb'&&h.input.map===1)) joinHuman({kind:'kb', map:1});
    }
  }
});
addEventListener('keyup', e=>{ keys[e.code] = false; });
addEventListener('blur', ()=>{ for(const k in keys) keys[k]=false; });
addEventListener('gamepadconnected', refreshLobbyUI);
addEventListener('gamepaddisconnected', refreshLobbyUI);

// E2E / debug virtual drive: {racerName: {mx,mz,jump,dive}}
const DBG_DRIVE = {};
window._DBG = { drive: DBG_DRIVE, S, racers, lobby,
  start(idx, opts){ startRace(idx, opts); },
  state(){ return racers.map(r=>({n:r.name, x:+r.body.pos.x.toFixed(2), y:+r.body.pos.y.toFixed(2), z:+r.body.pos.z.toFixed(2), fin:r.finished, rank:r.finishRank, falls:r.falls, up:r.body.upright})); },
  // synchronous fast-forward: run `sec` seconds of simulation without waiting
  // for real time (returns finishers). Audio/toasts muted during the run.
  advance(sec){
    const mute = AU.on; AU.on = false;
    const n = Math.round(sec / FIXED);
    for(let i=0;i<n;i++){
      if(S.phase === 'done' || S.phase === 'menu') break;
      stepSim();
    }
    AU.on = mute;
    return {
      phase: S.phase, t: +S.raceClock.toFixed(1),
      fin: racers.filter(r=>r.finished).map(r=>({n:r.name, t:+r.finishTime.toFixed(1), rank:r.finishRank})),
      unfin: racers.filter(r=>!r.finished).map(r=>({n:r.name, z:+r.body.pos.z.toFixed(1), falls:r.falls})),
      totalFalls: racers.reduce((a,r)=>a+r.falls,0)
    };
  }
};

let padPrev = {};
function pollPads(){
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for(let i=0;i<pads.length;i++){
    const gp = pads[i];
    if(!gp) continue;
    const pressed = gp.buttons.map(b=>b.pressed);
    const prev = padPrev[i] || [];
    padPrev[i] = pressed;
    // lobby join with A
    if(S.phase==='menu' && pressed[0] && !prev[0]){
      if(!lobby.humans.some(h=>h.input.kind==='pad'&&h.input.idx===i)) joinHuman({kind:'pad', idx:i});
    }
  }
}
function padInput(inp){
  const gp = navigator.getGamepads ? navigator.getGamepads()[inp.idx] : null;
  if(!gp) return {ix:0, iz:0, jump:false, dive:false};
  let ix = gp.axes[0]||0, iz = gp.axes[1]||0;
  const dz = 0.24;
  if(Math.abs(ix)<dz) ix=0; if(Math.abs(iz)<dz) iz=0;
  const bp = n=>!!(gp.buttons[n] && gp.buttons[n].pressed);
  if(bp(14)) ix = -1; if(bp(15)) ix = 1;
  if(bp(12)) iz = -1; if(bp(13)) iz = 1;
  return {ix, iz, jump: bp(0), dive: bp(2)||bp(1)};
}
function humanIntent(r){
  const inp = r.input;
  let ix=0, iz=0, jump=false, dive=false;
  if(inp.kind==='kb'){
    const m = KB_MAPS[inp.map];
    const any = arr=>arr.some(k=>keys[k]);
    if(any(m.left)) ix -= 1;
    if(any(m.right)) ix += 1;
    if(any(m.up)) iz -= 1;
    if(any(m.down)) iz += 1;
    jump = any(m.jump);
    dive = any(m.dive);
  } else {
    const pi = padInput(inp);
    ix = pi.ix; iz = pi.iz; jump = pi.jump; dive = pi.dive;
  }
  // camera-relative transform for real devices
  const cs = Math.cos(S.camYaw), sn = Math.sin(S.camYaw);
  let wx = ix*cs + iz*sn, wz = -ix*sn + iz*cs;
  // virtual drive (E2E): world-space override, no camera rotation
  const vd = DBG_DRIVE[r.name];
  if(vd){
    if(vd.mx !== undefined){ wx = vd.mx; wz = vd.mz; }
    if(vd.jump) jump = true;
    if(vd.dive) dive = true;
  }
  const l = Math.hypot(wx,wz);
  if(l>1){ wx/=l; wz/=l; }
  return {mx:wx, mz:wz, jump, dive};
}

// ================= racer factory =================
function mkBody(){
  return {
    pos:new T.Vector3(), vel:new T.Vector3(),
    upright:true, fallT:0, tripSev:0, dive:false, diveT:0,
    coyote:0, jumpLatch:false, squash:0, grounded:false, groundBoard:null,
    glueMul:1, whackCd:-9, bumpCd:0, boostCd:0, speedMul:1, inFan:false,
    animT:0, runPhase:0, faceYaw:0
  };
}
function makeRacer(opts){
  const r = {
    id: opts.id, name: opts.name, colorHex: opts.colorHex,
    kind: opts.kind, input: opts.input || null,
    body: mkBody(), finished:false, finishRank:0, finishTime:0,
    falls:0, coins:0, celebrate:null, brain: null
  };
  const bean = buildBean(opts.colorHex, opts.name, opts.kind==='human');
  r.mesh = bean.g; r.parts = bean;
  if(opts.kind==='bot' && window.SRR_AI) r.brain = window.SRR_AI.createBrain(opts.id, opts.skill||1);
  return r;
}

// ================= physics =================
function stepBody(B, intent, dt, r){
  const wasGrounded = B.grounded;
  const feetY0 = B.pos.y;
  B.grounded = false;

  // --- carry from moving ground ---
  if(wasGrounded && B.groundBoard){
    const b = B.groundBoard;
    if(b.type === 'mplat'){
      B.pos.x += b._dx||0; B.pos.z += b._dz||0;
    } else if(b.type === 'disc' && b.omega){
      const ang = b.omega*dt;
      const dx = B.pos.x - b.cx, dz = B.pos.z - b.cz;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      B.pos.x = b.cx + dx*ca - dz*sa;
      B.pos.z = b.cz + dx*sa + dz*ca;
    }
  }

  const gb = B.groundBoard;
  const glue = (gb && gb.glue) ? gb.glue : API.glueAt(B.pos.x, B.pos.z);
  B.glueMul = glue;
  const ix = intent.mx, iz = intent.mz;

  // --- horizontal drive ---
  if(B.upright || B.dive){
    const lim = (B.dive ? DIVE_V : MAX_SPD) * (glue < 1 ? 0.82 : 1) * (B.speedMul||1);
    if(ix || iz){
      // input accel is capped at the speed limit along the input direction;
      // only external pushes (boost pads, knockbacks) may exceed the limit
      const acc = (B.upright ? MOVE_ACC : 16) * glue;
      const cur = B.vel.x*ix + B.vel.z*iz;
      if(cur < lim){
        const add = Math.min(acc*dt, lim - cur);
        B.vel.x += ix*add;
        B.vel.z += iz*add;
      }
    } else {
      const dr = Math.pow(0.0004, dt);
      B.vel.x *= dr; B.vel.z *= dr;
    }
    // soft cap: over-limit momentum decays gently toward the limit
    const sp = Math.hypot(B.vel.x, B.vel.z);
    if(sp > lim + 0.05){
      const excess = (sp - lim) * Math.exp(-2.2*dt);
      const k = (lim + excess) / sp;
      B.vel.x *= k; B.vel.z *= k;
    }
  } else {
    B.vel.x += ix*7*dt; B.vel.z += iz*7*dt;
    const cs = Math.hypot(B.vel.x, B.vel.z);
    if(cs > 2.2){ const k = 2.2/cs; B.vel.x*=k; B.vel.z*=k; }
  }

  // --- belt & boost pads ---
  if(gb && gb.belt){ B.vel.z += gb.belt*dt*10; }
  B.boostCd -= dt;
  if(gb && gb.boost && B.boostCd <= 0 && wasGrounded){
    B.vel.z += gb.boost;
    B.vel.x *= 0.35;
    B.boostCd = 1.1;
    if(r && r.kind==='human'){ AU.whoosh(); }
    if(S.particles) S.particles.burst(B.pos.x, B.pos.y+0.3, B.pos.z, 0xffd23e, 10, 0.7, 3, 2, 0.5);
  }

  // --- dive start ---
  if(intent.dive && B.upright && wasGrounded && !B.dive){
    B.dive = true; B.diveT = 0;
    const dl = Math.max(0.3, Math.hypot(ix,iz)||1);
    B.vel.x += (ix/dl)*DIVE_V*0.5;
    B.vel.z += (iz/dl)*DIVE_V*0.5;
    B.vel.y = 3.2;
    if(r && r.kind==='human') AU.beep(340,0.18,'sawtooth',0.09,-160);
  }
  if(B.dive){
    B.diveT += dt;
    if(B.diveT > 0.55){ B.dive = false; tripBody(B, 0.5); }
  }

  // --- jump ---
  if(intent.jump && !B.jumpLatch){
    if(B.upright && (wasGrounded || B.coyote > 0)){
      B.vel.y = JUMP_V;
      B.coyote = 0;
      B.jumpLatch = true;
      B.squash = -0.35;
      if(r && r.kind==='human') AU.jump();
    }
  }
  if(!intent.jump) B.jumpLatch = false;

  // --- fan updraft vs gravity ---
  const fan = API.fanAt(B.pos.x, B.pos.z);
  B.inFan = !!fan;
  if(fan && B.pos.y < 5.5){
    B.vel.y += (fan.force - GRAV)*dt;
    if(B.vel.y > 4.4) B.vel.y = 4.4;
    if(B.vel.y < -2) B.vel.y = -2;
  } else {
    B.vel.y -= GRAV*dt;
  }

  // --- integrate ---
  B.pos.x += B.vel.x*dt;
  B.pos.y += B.vel.y*dt;
  B.pos.z += B.vel.z*dt;

  // --- road width clamp (geometry law, no tunneling possible) ---
  const rx = API.roadXAt(B.pos.z);
  const minX = rx[0] + CY_R*0.8, maxX = rx[1] - CY_R*0.8;
  if(B.pos.x < minX){ B.pos.x = minX; if(B.vel.x < 0) B.vel.x = 0; }
  if(B.pos.x > maxX){ B.pos.x = maxX; if(B.vel.x > 0) B.vel.x = 0; }

  // --- ground resolve ---
  const g1 = API.groundAt(B.pos.x, B.pos.z, B.pos.y);
  B.groundBoard = null;
  if(g1.y > -1e8 && B.pos.y <= g1.y){
    const diff = g1.y - B.pos.y;
    if(diff <= 0.42 || (feetY0 >= g1.y - 0.03 && B.vel.y <= 0.001)){
      // step-up / standing / landed-from-above
      const fallV = B.vel.y;
      B.pos.y = g1.y;
      B.grounded = true;
      B.groundBoard = g1.board;
      if(g1.board && g1.board.bounce && S.worldT - (B.bounceCd||0) > 0.45){
        // Fall-Guys style pad: ANY contact launches (walking on or landing),
        // with a short cooldown so you don't re-trigger mid-flight
        B.bounceCd = S.worldT;
        B.vel.y = g1.board.bounce;
        B.grounded = false;
        B.squash = -0.45;
        if(r && r.kind==='human') AU.boing();
        if(S.particles) S.particles.burst(B.pos.x, B.pos.y+0.2, B.pos.z, 0x58e06c, 12, 0.8, 5, 3, 0.6);
      } else {
        if(fallV < -7){
          B.squash = 0.3;
          if(r && r.kind==='human') AU.land();
          if(S.particles && fallV < -9) S.particles.burst(B.pos.x, B.pos.y+0.1, B.pos.z, 0xffffff, 6, 0.5, 1.5, 3, 0.4);
        }
        B.vel.y = 0;
      }
    }
    // else: under a raised board — side solids block; keep falling
  }
  if(B.grounded) B.coyote = 0.12;
  else B.coyote = Math.max(0, B.coyote - dt);

  // --- solids ---
  resolveSolids(B, r);

  // --- getting up ---
  if(!B.upright){
    B.fallT += dt;
    const need = 0.45 + (B.tripSev||0)*0.35;
    if(B.fallT > need){
      B.upright = true; B.fallT = 0; B.tripSev = 0;
      B.squash = 0.25;
    }
  }
  // squash spring
  B.squash += (0 - B.squash)*Math.min(1, dt*11);
}

function tripBody(B, sev){
  if(!B.upright) return;
  B.upright = false;
  B.fallT = 0;
  B.tripSev = sev||1;
}

function resolveSolids(B, r){
  const r_ = CY_R;
  const headY = B.pos.y + (B.dive ? 0.62 : CY_H);
  for(const c of API.RT.solids){
    if(c.min.x > 1e8) continue;
    if(!(B.pos.x > c.min.x - r_ && B.pos.x < c.max.x + r_ &&
         B.pos.z > c.min.z - r_ && B.pos.z < c.max.z + r_ &&
         headY > c.min.y && B.pos.y < c.max.y)) continue;
    const pxL = B.pos.x - (c.min.x - r_), pxR = (c.max.x + r_) - B.pos.x;
    const pzL = B.pos.z - (c.min.z - r_), pzR = (c.max.z + r_) - B.pos.z;
    const m = Math.min(pxL, pxR, pzL, pzR);
    const now = S.worldT;
    const tag = c.tag;

    // whacky obstacles: positional push + timed knock/trip
    if(tag === 'mill' || tag === 'rotor' || tag === 'pend' || tag === 'punch' ||
       tag === 'roller' || tag === 'crush' || c._bump){
      if(m === pxL){ B.pos.x = c.min.x - r_ - 0.001; if(B.vel.x>0) B.vel.x = 0; }
      else if(m === pxR){ B.pos.x = c.max.x + r_ + 0.001; if(B.vel.x<0) B.vel.x = 0; }
      else if(m === pzL){ B.pos.z = c.min.z - r_ - 0.001; if(B.vel.z>0) B.vel.z = 0; }
      else { B.pos.z = c.max.z + r_ + 0.001; if(B.vel.z<0) B.vel.z = 0; }
      if(c._bump){
        if(now - (B.bumpCd||0) > 0.35){
          B.bumpCd = now;
          const cx2 = (c.min.x+c.max.x)/2, cz2 = (c.min.z+c.max.z)/2;
          const dx = B.pos.x-cx2, dz = B.pos.z-cz2;
          const dl = Math.max(0.05, Math.hypot(dx,dz));
          B.vel.x = dx/dl*c._kick;
          B.vel.z = dz/dl*c._kick;
          B.vel.y = Math.max(B.vel.y, 3.2);
          if(r && r.kind==='human') AU.boing();
          if(S.particles) S.particles.burst(B.pos.x, B.pos.y+0.5, B.pos.z, 0xff5c9d, 8, 0.6, 2, 3, 0.4);
        }
        continue;
      }
      if(now - B.whackCd > 0.6){
        B.whackCd = now;
        if(tag === 'roller'){
          const bx = c._lx !== undefined ? c._lx : (c.min.x+c.max.x)/2;
          const dirx = Math.abs(B.pos.x - bx) > 0.1 ? Math.sign(B.pos.x - bx) : (Math.random()<0.5?-1:1);
          B.vel.x = dirx*7.5;
          B.vel.y = 4.5;
          B.vel.z += 1.5;
          tripBody(B, 0.45);
          if(r && r.kind==='human'){ AU.bump(); toast('🍥 被大球撞飛！'); }
        } else if(tag === 'punch'){
          if((c._ext||0) > 0.25){
            const dir = c._vx > 0 ? 1 : -1;
            B.vel.x = dir*8.5;
            B.vel.y = 3.5;
            tripBody(B, 0.4);
            if(r && r.kind==='human'){ AU.bump(); toast('🥊 被拳套擊中！'); }
          }
        } else if(tag === 'crush'){
          tripBody(B, 1.1);
          B.vel.y = -3;
          if(r && r.kind==='human'){ AU.hit(); toast('😵 被壓扁了！'); }
        } else if(tag === 'mill' || tag === 'rotor'){
          const nx = m===pxL ? -1 : m===pxR ? 1 : 0;
          const nz = m===pzL ? -1 : m===pzR ? 1 : 0;
          B.vel.x = nx*4 + (Math.random()-0.5)*2;
          B.vel.z = nz*4 + 1.2;
          B.vel.y = 3.0;
          tripBody(B, 0.35);
          if(r && r.kind==='human'){ AU.bump(); toast('🌀 被扇飛了！'); }
        } else if(tag === 'pend'){
          const nx = m===pxL ? -1 : m===pxR ? 1 : 0;
          const nz = m===pzL ? -1 : m===pzR ? 1 : 0;
          B.vel.x = nx*6;
          B.vel.z = nz*6 + 1.5;
          B.vel.y = 3.5;
          tripBody(B, 0.5);
          if(r && r.kind==='human'){ AU.bump(); toast('🔨 被大錘撞飛！'); }
        }
        if(r && r.kind==='human'){ S.camShake = Math.min(0.5, S.camShake+0.3); }
        if(S.particles && tag !== 'crush') S.particles.burst(B.pos.x, B.pos.y+0.6, B.pos.z, 0xffd23e, 8, 0.7, 2.5, 3, 0.5);
      }
      continue;
    }

    // static solid (wall / platform side / beam): plain push-out, no restitution
    if(m === pxL){ B.pos.x = c.min.x - r_ - 0.001; if(B.vel.x>0) B.vel.x = 0; }
    else if(m === pxR){ B.pos.x = c.max.x + r_ + 0.001; if(B.vel.x<0) B.vel.x = 0; }
    else if(m === pzL){ B.pos.z = c.min.z - r_ - 0.001; if(B.vel.z>0) B.vel.z = 0; }
    else { B.pos.z = c.max.z + r_ + 0.001; if(B.vel.z<0) B.vel.z = 0; }
  }
}

// racer-racer soft separation
function separateRacers(){
  const n = racers.length;
  for(let i=0;i<n;i++){
    for(let j=i+1;j<n;j++){
      const a = racers[i].body, b = racers[j].body;
      if(Math.abs(a.pos.y - b.pos.y) > 0.95) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const minD = 0.8;
      if(d < minD && d > 0.0001){
        const nx = dx/d, nz = dz/d;
        const overlap = (minD - d);
        const wa = racers[i].body.dive ? 0.3 : 1;
        const wb = racers[j].body.dive ? 0.3 : 1;
        const tw = wa + wb;
        a.pos.x -= nx*overlap*(wa/tw); a.pos.z -= nz*overlap*(wa/tw);
        b.pos.x += nx*overlap*(wb/tw); b.pos.z += nz*overlap*(wb/tw);
        const rel = (b.vel.x-a.vel.x)*nx + (b.vel.z-a.vel.z)*nz;
        if(rel < 0){
          const imp = rel*0.35;
          a.vel.x += nx*imp; a.vel.z += nz*imp;
          b.vel.x -= nx*imp; b.vel.z -= nz*imp;
        }
      } else if(d <= 0.0001){
        a.pos.x -= 0.05; b.pos.x += 0.05;
      }
    }
  }
}

// ================= fall & respawn =================
function safeSpot(x, z){
  const g = API.groundAt(x, z, 3);
  if(g.y < 0) return false;
  if(g.board && (g.board.bounce || g.board.disabled)) return false;
  if(g.board && g.board.type === 'tile' && g.board.state !== 'idle') return false;
  const L = LVL[S.levelIdx];
  const rx = API.roadXAt(z);
  if(x < rx[0]+0.3 || x > rx[1]-0.3) return false;
  for(const c of API.RT.solids){
    if(c.min.x > 1e8) continue;
    if(!['mill','rotor','crush','roller','pend','punch'].includes(c.tag) && !c._bump) continue;
    if(x > c.min.x-0.6 && x < c.max.x+0.6 &&
       z > c.min.z-0.8 && z < c.max.z+0.8 &&
       1.3 > c.min.y && 0 < c.max.y) return false;
  }
  return true;
}
function fallRespawn(r){
  r.falls++;
  const L = LVL[S.levelIdx];
  if(r.kind==='human'){ AU.fall(); }
  if(S.particles) S.particles.burst(r.body.pos.x, -5.5, r.body.pos.z, 0x9fe8ff, 16, 1.4, 6, 8, 0.8);
  const baseZ = Math.max(L.spawn[2], r.body.pos.z - 5);
  const rx = API.roadXAt(baseZ);
  const slots = [r.body.pos.x, 0, -1.2, 1.2, -2.4, 2.4];
  let found = false;
  for(let dz=0; dz<=20 && !found; dz+=0.6){
    const cz = baseZ - dz;
    if(cz < L.spawn[2]) break;
    const rxz = API.roadXAt(cz);
    for(const sx of slots){
      const cx = Math.max(rxz[0]+0.5, Math.min(rxz[1]-0.5, sx));
      if(safeSpot(cx, cz)){
        const g = API.groundAt(cx, cz, 3);
        r.body.pos.set(cx, Math.max(0.05, g.y+0.02), cz);
        r.body.vel.set(0,0,0);
        r.body.upright = false; r.body.fallT = 0; r.body.tripSev = 0.35;
        r.body.dive = false;
        found = true;
        break;
      }
    }
  }
  if(!found){
    r.body.pos.set(L.spawn[0], L.spawn[1]+0.02, L.spawn[2]);
    r.body.vel.set(0,0,0);
    r.body.upright = true; r.body.fallT = 0;
  }
  if(r.kind==='human') toast('💦 落水了！返回安全位置');
}

// ================= race flow =================
function startRace(idx){
  const L = LVL[idx];
  S.levelIdx = idx;
  // teardown previous level scene (bean materials are unique-per-bean and
  // disposed via disposeBean; build.js materials are cached/shared — never disposed)
  if(S.water){ S.water.geometry.dispose(); S.water.material.dispose(); }
  if(S.sky){ S.sky.geometry.dispose(); S.sky.material.dispose(); }
  if(S.particles && S.particles.dispose) S.particles.dispose();
  S.composer = null;   // rebuilt against the new scene on next render
  S.scene = new T.Scene();
  S.scene.fog = new T.Fog(new T.Color(L.fog[0],L.fog[1],L.fog[2]).getHex(), 40, 160);
  S.sky = makeSky(L); S.scene.add(S.sky);
  S.sun = makeLights(S.scene, L);
  S.water = makeWater(L); S.scene.add(S.water);
  S.particles = makeParticles(S.scene);
  const built = API.buildLevel(idx);
  S.scene.add(built.group);

  // racers
  for(const r of racers){
    if(r.mesh.parent) r.mesh.parent.remove(r.mesh);
    disposeBean(r);
  }
  racers.length = 0;
  // bot count: explicit lobby choice (-1 = auto fill to MAX_RACERS)
  let bots = 0;
  if(window.SRR_AI){
    if(lobby.botCount >= 0) bots = Math.min(lobby.botCount, MAX_RACERS - lobby.humans.length);
    else if(lobby.botFill) bots = MAX_RACERS - lobby.humans.length;
  }
  const total = lobby.humans.length + bots;
  lobby.humans.forEach((h,i)=>{
    racers.push(makeRacer({id:i, name:h.name, colorHex:COLORS[h.color], kind:'human', input:h.input}));
  });
  for(let i=0;i<bots;i++){
    const meta = window.SRR_AI.botInfo(i);
    racers.push(makeRacer({id:lobby.humans.length+i, name:meta.name, colorHex:meta.color, kind:'bot',
      skill: meta.skill}));
  }
  // spawn grid
  racers.forEach((r,i)=>{
    const row = Math.floor(i/5), colI = i%5;
    const spread = Math.min(1.3, 7/Math.min(5,total));
    r.body.pos.set((colI - (Math.min(5,total)-1)/2)*spread, L.spawn[1]+0.02, L.spawn[2] + row*0.85 - 0.3);
    r.body.faceYaw = 0; // facing +z (down the track)
    S.scene.add(r.mesh);
  });
  // one follow-camera per human racer (split-screen when 2+)
  rebuildViews();
  updateSplitLines();

  S.worldT = 0; S.raceClock = 0; S.tLeft = L.time;
  S.finishCount = 0; S.endGraceT = 0; S.extendT = 0;
  S.phase = 'countdown'; S.countdownT = 3.4; S.paused = false;
  S.camYaw = Math.PI; S.camPitch = 0.46; S.camDist = 9.5; S.camShake = 0;
  cdLast = 4;
  hintIdx = -1;

  UI.hud.classList.remove('hidden');
  UI.clockEl.classList.remove('low');
  UI.lvname.textContent = 'LEVEL ' + (idx+1) + ' · ' + L.name;
  UI.menu.classList.add('hidden');
  UI.resOv && UI.resOv.classList.add('hidden');
  UI.pause.classList.add('hidden');
  UI.count && UI.count.classList.remove('hidden');
  UI.racestrip.innerHTML = '';
  buildRaceStrip();
  updateHUD();
}
function disposeBean(r){
  r.mesh.traverse(o=>{
    if(o.isMesh && o.material && o.material.dispose && !o.material.__keep) o.material.dispose();
    if(o.isSprite && o.material && o.material.map && o.material.map.dispose) o.material.map.dispose();
  });
}

let cdLast = 4;
function updateCountdown(dt){
  S.countdownT -= dt;
  const n = Math.ceil(S.countdownT - 0.4);
  if(n < cdLast){
    cdLast = n;
    if(n > 0){ UI.countNum.textContent = n; UI.countNum.classList.remove('go'); AU.cd(n); }
    else if(n === 0){ UI.countNum.textContent = 'GO!'; UI.countNum.classList.add('go'); AU.cd(0); }
  }
  if(S.countdownT <= 0){
    S.phase = 'race';
    UI.count.classList.add('hidden');
  }
}

function racerFinish(r){
  r.finished = true;
  S.finishCount++;
  r.finishRank = S.finishCount;
  r.finishTime = S.raceClock;
  const side = r.finishRank % 2 === 0 ? 1 : -1;
  const L = LVL[S.levelIdx];
  const rx = API.roadXAt(L.ring[0][2]);
  r.celebrate = {
    x: side * (Math.min(2.6, (rx[1]-rx[0])/2 - 1.2)) * (0.5 + (r.finishRank%3)*0.3),
    z: L.ring[0][2] + 1.2 + Math.floor(r.finishRank/2)*0.85
  };
  if(r.kind === 'human'){
    AU.win();
    toast('🏁 ' + r.name + ' 第 ' + r.finishRank + ' 名衝線！');
    if(S.particles){
      for(let i=0;i<3;i++) S.particles.burst(r.body.pos.x, r.body.pos.y+1.5+i, r.body.pos.z, [0xff5c9d,0x31e6ff,0xffd23e][i], 16, 1.2, 7, 6, 1.1);
    }
    spawnConfetti();
  }
}

function celebrateIntent(r){
  const B = r.body;
  const dx = r.celebrate.x - B.pos.x, dz = r.celebrate.z - B.pos.z;
  const d = Math.hypot(dx, dz);
  if(d > 0.5){
    const l = Math.hypot(dx,dz);
    return {mx:dx/l*0.7, mz:dz/l*0.7, jump:false, dive:false};
  }
  const hop = (S.worldT*2.2 + r.id) % 2 < 0.12;
  return {mx:0, mz:0, jump:hop && B.grounded, dive:false};
}

function endRace(reason){
  if(S.phase === 'done') return;
  S.phase = 'done';
  buildResults(reason);
}

function buildResults(reason){
  const L = LVL[S.levelIdx];
  const order = [...racers].sort((a,b)=>{
    if(a.finished && b.finished) return a.finishRank - b.finishRank;
    if(a.finished) return -1;
    if(b.finished) return 1;
    return progOf(b) - progOf(a);
  });
  const p1 = racers.find(r=>r.kind==='human');
  let title, titleCls;
  if(p1 && p1.finished){
    title = p1.finishRank === 1 ? '🥇 冠軍！' : p1.finishRank === 2 ? '🥈 亞軍！' : p1.finishRank === 3 ? '🥉 季軍！' : '🏁 第 '+p1.finishRank+' 名';
    titleCls = 'win';
  } else {
    title = '💥 時間到！';
    titleCls = 'lose';
  }
  UI.resTitle.textContent = title;
  UI.resTitle.className = titleCls;
  // solo records
  let recordLine = '';
  if(p1 && p1.finished && lobby.humans.length === 1){
    const tUsed = p1.finishTime;
    let stars = 1;
    if(tUsed <= L.time*0.45) stars = 3;
    else if(tUsed <= L.time*0.7) stars = 2;
    const st = store.get();
    const bk = 'best'+S.levelIdx;
    if(!st[bk] || tUsed < st[bk]) st[bk] = tUsed;
    st['stars'+S.levelIdx] = Math.max(stars, st['stars'+S.levelIdx]||0);
    st.cur = Math.min(LVL.length-1, S.levelIdx+1);
    store.set(st);
    recordLine = '<div class="stars">⭐ '+'★'.repeat(stars)+'☆'.repeat(3-stars)+'　用時 '+tUsed.toFixed(1)+'s</div>';
    refreshLevelSel();
    AU.win();
  } else if(!p1 || !p1.finished){
    AU.lose();
  }
  let rows = '';
  order.forEach((r,i)=>{
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':(r.finished?(''+(i+1)):'—');
    rows += '<div class="rrow'+(r.kind==='human'?' me':'')+(r.finished?' fin':'')+'">'+
      '<span class="rp">'+medal+'</span>'+
      '<span class="dot" style="background:'+r.colorHex+'"></span>'+
      '<span class="nm">'+r.name+(r.kind==='human'?' 👤':' 🤖')+'</span>'+
      (r.finished ? '<span class="rk">'+r.finishTime.toFixed(1)+'s</span>'
                  : '<span class="rk">'+(progOf(r)*100).toFixed(0)+'%</span>')+
      '</div>';
  });
  UI.resStats.innerHTML = recordLine + '<div class="resList">'+rows+'</div>';
  UI.resOv.classList.remove('hidden');
}

function progOf(r){
  const L = LVL[S.levelIdx];
  return Math.min(1, Math.max(0, (r.body.pos.z - L.spawn[2])/(L.ring[0][2]-L.spawn[2])));
}

// DOM dividers between split-screen viewports
function updateSplitLines(){
  const box = document.getElementById('splitlines');
  if(!box) return;
  box.innerHTML = '';
  const n = racers.filter(r=>r.kind==='human').length;
  if(n < 2) return;
  const cols = n <= 2 ? 1 : (n <= 4 ? 2 : 3);
  const rows = Math.ceil(n/cols);
  for(let r=1;r<rows;r++){
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;right:0;top:'+(r*100/rows)+'%;height:3px;background:rgba(255,255,255,.4);z-index:9;pointer-events:none';
    box.appendChild(d);
  }
  // vertical divider(s) — for 3P only the top half is split
  for(let c=1;c<cols;c++){
    const hPct = (n === 3) ? 50 : 100;
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;height:'+hPct+'%;left:'+(c*100/cols)+'%;width:3px;background:rgba(255,255,255,.4);z-index:9;pointer-events:none';
    box.appendChild(d);
  }
}

// ================= camera / split-screen views =================
// One follow-camera per HUMAN racer. Solo (or bots-only spectate) renders
// full-frame with bloom; 2+ humans render a split-screen grid (1P full,
// 2P top/bottom, 3-4P quad, 5P+ three per row) with scissored viewports.
function makeView(racer){
  return {
    racer,
    cam: new T.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 320),
    yaw: Math.PI, pitch: 0.46, dist: 9.5,
    tgt: new T.Vector3()
  };
}
function rebuildViews(){
  S.views = [];
  const humans = racers.filter(r=>r.kind==='human');
  for(const h of humans) S.views.push(makeView(h));
  if(!S.views.length && racers.length) S.views.push(makeView(racers[0]));
  if(S.views.length){
    S.camera = S.views[0].cam;   // menu / solo path shares view0's camera
    S.composer = null;           // composer caches the camera — rebuild
  }
}
function updateFollowCam(v, dt){
  if(!v.racer) return;
  const B = v.racer.body;
  // slight look-ahead so fast running feels readable
  v.tgt.set(B.pos.x, B.pos.y + 1.35, B.pos.z + Math.max(-1.5, Math.min(2.5, B.vel.z*0.22)));
  const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
  const cx = v.tgt.x + Math.sin(v.yaw)*cp*v.dist;
  const cyy = v.tgt.y + sp*v.dist + 0.6;
  const cz = v.tgt.z + Math.cos(v.yaw)*cp*v.dist;
  v.cam.position.lerp(new T.Vector3(cx, cyy, cz), Math.min(1, dt*7));
  if(v === S.views[0] && S.camShake > 0.003){
    v.cam.position.x += (Math.random()-0.5)*S.camShake;
    v.cam.position.y += (Math.random()-0.5)*S.camShake*0.7;
  }
  v.cam.lookAt(v.tgt);
}
function renderRace(dt){
  if(!S.views || !S.views.length) return;
  // P1's mouse-controlled orbit writes into view0
  const v0 = S.views[0];
  v0.yaw = S.camYaw; v0.pitch = S.camPitch; v0.dist = S.camDist;
  // gamepad players orbit their own view with the right stick
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for(let i=1;i<S.views.length;i++){
    const v = S.views[i], inp = v.racer && v.racer.input;
    if(!inp || inp.kind !== 'pad') continue;
    const gp = pads[inp.idx];
    if(!gp) continue;
    const ax = gp.axes[2]||0, ay = gp.axes[3]||0;
    if(Math.abs(ax) > 0.25) v.yaw -= ax*2.6*dt;
    if(Math.abs(ay) > 0.25) v.pitch = Math.max(-0.05, Math.min(1.25, v.pitch + ay*1.4*dt));
  }
  const humans = racers.filter(r=>r.kind==='human');
  if(humans.length > 1){
    const n = Math.min(humans.length, S.views.length);
    const cols = n <= 2 ? 1 : (n <= 4 ? 2 : 3);
    const rows = Math.ceil(n/cols);
    const R = S.renderer;
    R.setScissorTest(true);
    for(let i=0;i<n;i++){
      const v = S.views[i];
      const gx = i % cols, gy = Math.floor(i/cols);
      let vw = innerWidth/cols, px = gx*vw;
      if(n === 3 && i === 2){ vw = innerWidth; px = 0; }   // 3P: bottom view spans full width
      const vh = innerHeight/rows;
      const py = innerHeight - (gy+1)*vh;
      R.setViewport(px, py, vw, vh);
      R.setScissor(px, py, vw, vh);
      updateFollowCam(v, dt);
      v.cam.aspect = vw/vh;
      v.cam.updateProjectionMatrix();
      R.render(S.scene, v.cam);
    }
    R.setScissorTest(false);
    R.setViewport(0, 0, innerWidth, innerHeight);
  } else {
    updateFollowCam(v0, dt);
    v0.cam.aspect = innerWidth/innerHeight;
    v0.cam.updateProjectionMatrix();
    render();   // solo keeps the bloom composer
  }
  S.camShake *= Math.pow(0.02, dt);
  // sun + player light follow view0's subject
  const t = v0.tgt;
  if(S.sun){
    S.sun.position.set(t.x+14, 26, t.z-12);
    S.sun.target.position.set(t.x, 0, t.z);
  }
  if(S.playerLight){
    S.playerLight.position.set(t.x, t.y+2.4, t.z-1.5);
  }
}

// ================= bean animation =================
function updateBeanVisual(r, dt){
  const B = r.body, P = r.parts;
  r.mesh.position.copy(B.pos);
  const sp = Math.hypot(B.vel.x, B.vel.z);
  // facing
  let ty = B.faceYaw;
  if(sp > 0.6) ty = Math.atan2(B.vel.x, B.vel.z);
  let dy = ty - B.faceYaw;
  while(dy > Math.PI) dy -= 2*Math.PI;
  while(dy < -Math.PI) dy += 2*Math.PI;
  B.faceYaw += dy*Math.min(1, dt*9);
  r.mesh.rotation.y = B.faceYaw;

  const inner = P.inner;
  if(!B.upright){
    const k = Math.min(1, B.fallT*6);
    inner.rotation.x = -k*Math.PI/2*0.85;
    inner.rotation.z = Math.sin(B.fallT*9)*0.3*(1-k);
    inner.position.y = -0.18*k;
  } else if(B.dive){
    inner.rotation.x = -1.3;
    inner.rotation.z = 0;
    inner.position.y = 0.1;
  } else {
    inner.rotation.x += (0 - inner.rotation.x)*Math.min(1, dt*10);
    inner.rotation.z += (0 - inner.rotation.z)*Math.min(1, dt*10);
    inner.position.y += (0 - inner.position.y)*Math.min(1, dt*10);
  }
  // run cycle
  if(B.grounded && sp > 0.5 && B.upright){
    B.runPhase += dt*(6 + sp*1.6);
    const amp = Math.min(1, sp/6);
    P.legL.position.z = 0.05 + Math.sin(B.runPhase)*0.22*amp;
    P.legR.position.z = 0.05 - Math.sin(B.runPhase)*0.22*amp;
    P.legL.position.y = 0.09 + Math.max(0, Math.sin(B.runPhase))*0.13*amp;
    P.legR.position.y = 0.09 + Math.max(0, -Math.sin(B.runPhase))*0.13*amp;
    P.armLP.rotation.x = Math.sin(B.runPhase+Math.PI)*0.9*amp;
    P.armRP.rotation.x = Math.sin(B.runPhase)*0.9*amp;
    inner.position.y = Math.abs(Math.sin(B.runPhase))*0.05*amp;
    inner.rotation.x = 0.08*amp;
  } else if(!B.grounded){
    // airborne: legs trail, arms up
    P.legL.position.z += (0.18 - P.legL.position.z)*Math.min(1,dt*8);
    P.legR.position.z += (0.18 - P.legR.position.z)*Math.min(1,dt*8);
    P.armLP.rotation.x += (-2.2 - P.armLP.rotation.x)*Math.min(1,dt*8);
    P.armRP.rotation.x += (-2.2 - P.armRP.rotation.x)*Math.min(1,dt*8);
  } else {
    P.legL.position.z += (0.05 - P.legL.position.z)*Math.min(1,dt*10);
    P.legR.position.z += (0.05 - P.legR.position.z)*Math.min(1,dt*10);
    P.armLP.rotation.x += (0 - P.armLP.rotation.x)*Math.min(1,dt*10);
    P.armRP.rotation.x += (0 - P.armRP.rotation.x)*Math.min(1,dt*10);
  }
  // squash & stretch
  const sq = B.squash;
  const sy = 1 + sq, sxz = 1 - sq*0.6;
  inner.scale.set(sxz, sy, sxz);
  // fan hover spin flair
  if(B.inFan){
    inner.rotation.z = Math.sin(S.worldT*6)*0.12;
  }
}

// ================= HUD =================
function buildRaceStrip(){
  if(!UI.racestrip) return;
  UI.racestrip.innerHTML = '';
  racers.forEach(r=>{
    const d = document.createElement('div');
    d.className = 'rdot'+(r.kind==='human'?' hu':'');
    d.style.background = r.colorHex;
    d.title = r.name;
    UI.racestrip.appendChild(d);
    r.stripEl = d;
  });
}
let hudAcc = 0;
function updateHUD(dt){
  const L = LVL[S.levelIdx];
  if(!L) return;
  UI.clockEl.textContent = fmt(S.tLeft);
  UI.clockEl.classList.toggle('low', S.tLeft <= 20 && S.phase==='race');
  const p1 = racers.find(r=>r.kind==='human') || racers[0];
  if(p1){
    const z0 = L.spawn[2], z1 = L.ring[0][2];
    const prog = Math.min(1, Math.max(0, (p1.body.pos.z - z0)/(z1-z0)));
    UI.prog.style.width = (prog*100).toFixed(1)+'%';
    UI.lvtime.textContent = '最佳 ' + (store.get()['best'+S.levelIdx] ? store.get()['best'+S.levelIdx].toFixed(1)+'s' : '--');
  }
  hudAcc += dt||0;
  if(hudAcc < 0.12) return;
  hudAcc = 0;
  // race strip dots
  const z0 = L.spawn[2], z1 = L.ring[0][2];
  for(const r of racers){
    if(!r.stripEl) continue;
    const p = Math.min(1, Math.max(0, (r.body.pos.z - z0)/(z1-z0)));
    r.stripEl.style.left = 'calc('+(p*100).toFixed(1)+'% - 5px)';
  }
  // standings
  const order = [...racers].sort((a,b)=>{
    if(a.finished && b.finished) return a.finishRank - b.finishRank;
    if(a.finished) return -1;
    if(b.finished) return 1;
    return progOf(b) - progOf(a);
  });
  let html = '';
  order.forEach((r,i)=>{
    const pct = Math.min(1, progOf(r))*100;
    html += '<div class="rrow'+(r.kind==='human'?' me':'')+(r.finished?' fin':'')+'">'+
      '<span class="rp'+(r.kind==='human'?' me':'')+'">'+(r.finished?'🏆':(i+1))+'</span>'+
      '<span class="dot" style="background:'+r.colorHex+'"></span>'+
      '<span class="nm">'+r.name+'</span>'+
      (r.finished ? '<span class="rk">'+r.finishTime.toFixed(1)+'s</span>'
                  : '<span class="pb"><i style="width:'+pct.toFixed(0)+'%"></i></span>')+
      '</div>';
  });
  UI.rankList.innerHTML = html;
  const meIdx = order.findIndex(r=>r.kind==='human');
  UI.rankBox.querySelector('.rt').textContent = meIdx>=0
    ? '🏁 即時排名 · 你第 '+(meIdx+1)+' / '+racers.length
    : '🏁 即時排名';
  // P1 stats box
  if(p1){
    UI.stBox.innerHTML = '<div>👥 <b>'+racers.length+'</b> 人混戰</div>'+
      '<div>🍬 硬幣 <b>'+p1.coins+'</b></div>'+
      '<div>💀 落水 <b>'+p1.falls+'</b></div>';
  }
}

let hintIdx = -1;
function updateHints(){
  const L = LVL[S.levelIdx];
  const p1 = racers.find(r=>r.kind==='human') || racers[0];
  if(!L.hints || !L.hints.length || !p1){ UI.hint.textContent = ''; return; }
  let idx = -1;
  for(let i=0;i<L.hints.length;i++){
    const h = L.hints[i];
    if(p1.body.pos.z >= h.z[0] && p1.body.pos.z <= h.z[1]) idx = i;
  }
  if(idx !== hintIdx){
    hintIdx = idx;
    UI.hint.textContent = idx >= 0 ? '💡 ' + L.hints[idx].t : '';
  }
}

function showCheckpointBox(){
  UI.cpBox.innerHTML = '<b>LEVEL '+(S.levelIdx+1)+'</b><br>'+LVL[S.levelIdx].nameEn+' · '+
    (window.DIFF_LABELS ? window.DIFF_LABELS[S.levelIdx] : '');
}

// ================= level select / menu =================
function refreshLevelSel(){
  const st = store.get();
  UI.lvlSel.innerHTML = '';
  LVL.forEach((L,i)=>{
    const d = document.createElement('div');
    d.className = 'lvl';
    const stars = st['stars'+i]||0;
    const best = st['best'+i];
    if(stars>0) d.classList.add('done');
    if(i===(st.cur!==undefined?st.cur:0)) d.classList.add('cur');
    d.innerHTML = '<div class="n">'+(i+1)+'</div><div class="t">'+L.name+'</div>'+
      '<div class="stars">'+('★'.repeat(stars)+'☆'.repeat(3-stars))+'</div>'+
      '<div class="diff">'+(window.DIFF_LABELS[i]||'')+'</div>'+
      (best?("<div class='diff' style='color:#7ee7a2'>最佳 "+best.toFixed(1)+"s</div>"):"");
    d.onclick = ()=>{
      const s = store.get(); s.cur = i; store.set(s);
      [...UI.lvlSel.children].forEach(c=>c.classList.remove('cur'));
      d.classList.add('cur');
      AU.ensure(); AU.beep(660,0.06);
    };
    UI.lvlSel.appendChild(d);
  });
}

// ================= confetti (DOM) =================
function spawnConfetti(){
  const colors = [0xff5c9d,0x31e6ff,0xffd23e,0x58e06c,0xa25cff,0xff8a3d];
  for(let i=0;i<80;i++){
    const d = document.createElement('div');
    d.className = 'conf';
    d.style.left = Math.random()*100+'vw';
    d.style.background = '#'+colors[i%colors.length].toString(16).padStart(6,'0');
    d.style.animation = 'cf '+(1.6+Math.random()*1.6)+'s linear '+(Math.random()*0.7)+'s forwards';
    d.style.transform = 'rotate('+Math.random()*360+'deg)';
    document.body.appendChild(d);
    setTimeout(()=>d.remove(), 4200);
  }
}

// ================= mouse look =================
const canvas = $('c');
canvas.addEventListener('pointerdown', e=>{ S.dragging=true; S.lastX=e.clientX; S.lastY=e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', e=>{ S.dragging=false; });
canvas.addEventListener('pointermove', e=>{
  if(!S.dragging) return;
  S.camYaw -= (e.clientX - S.lastX)*0.0052;
  S.camPitch = Math.min(1.25, Math.max(-0.05, S.camPitch + (e.clientY-S.lastY)*0.0035));
  S.lastX = e.clientX; S.lastY = e.clientY;
});
canvas.addEventListener('wheel', e=>{
  e.preventDefault();
  S.camDist = Math.min(24, Math.max(5, S.camDist + e.deltaY*0.0075));
}, {passive:false});

// ================= buttons =================
function wireButtons(){
  $('btnPlay').onclick = e=>{ e.target.blur(); AU.ensure(); startRace(store.get().cur||0); };
  $('restart').onclick = e=>{ e.target.blur(); if(S.phase==='race'||S.phase==='done') startRace(S.levelIdx); };
  UI.btnNext.onclick = e=>{ e.target.blur();
    if(S.levelIdx+1 < LVL.length) startRace(S.levelIdx+1);
    else backToMenu();
  };
  UI.btnRetry.onclick = e=>{ e.target.blur(); startRace(S.levelIdx); };
  UI.btnMenu.onclick = e=>{ e.target.blur(); backToMenu(); };
  UI.btnResume.onclick = e=>{ e.target.blur(); togglePause(); };
  UI.btnQuit.onclick = e=>{ e.target.blur(); togglePause(); backToMenu(); };
  $('btnReset').onclick = ()=>{ if(confirm('清除所有紀錄？')){ localStorage.removeItem('srr-save2'); refreshLevelSel(); } };
  $('btnSound').onclick = e=>{ AU.on=!AU.on; e.target.textContent = AU.on?'🔊 音效：開':'🔇 音效：關'; e.target.blur(); };
  if(UI.botCount) UI.botCount.onchange = ()=>{ lobby.botCount = parseInt(UI.botCount.value, 10); refreshLobbyUI(); };
  if(UI.joinKb2) UI.joinKb2.onclick = e=>{ e.target.blur();
    if(!lobby.humans.some(h=>h.input.kind==='kb'&&h.input.map===1)) joinHuman({kind:'kb', map:1});
  };
  if(UI.fxSel){
    UI.fxSel.onchange = ()=>{ FX_QUALITY = UI.fxSel.value; S.composer = null; };
  }
  if(UI.ccust) UI.ccust.oninput = ()=>{
    // P1 color follows the custom picker when it matches nothing
    let nearest = 0, bestD = 1e9;
    COLORS.forEach((c,i)=>{
      const a = new T.Color(c), b = new T.Color(UI.ccust.value);
      const d = Math.abs(a.r-b.r)+Math.abs(a.g-b.g)+Math.abs(a.b-b.b);
      if(d < bestD){ bestD = d; nearest = i; }
    });
    lobby.humans[0].color = nearest;
    refreshLobbyUI();
  };
}
function backToMenu(){
  S.phase = 'menu';
  S.paused = false;
  for(const r of racers){
    if(r.mesh.parent) r.mesh.parent.remove(r.mesh);
    disposeBean(r);
  }
  racers.length = 0;
  S.views = [];
  updateSplitLines();
  buildMenuScene();
  UI.resOv.classList.add('hidden');
  UI.pause.classList.add('hidden');
  UI.hud.classList.add('hidden');
  UI.count.classList.add('hidden');
  refreshLevelSel();
  refreshLobbyUI();
  UI.menu.classList.remove('hidden');
}
function togglePause(){
  if(S.phase !== 'race' && S.phase !== 'countdown') return;
  if(S.phase === 'countdown') return;
  S.paused = !S.paused;
  if(S.paused){
    UI.pauseStats.innerHTML = '關卡 <b>'+(S.levelIdx+1)+'</b> · 剩餘 <b>'+fmt(S.tLeft)+'</b>';
    UI.pause.classList.remove('hidden');
  } else UI.pause.classList.add('hidden');
}

// ================= main loop =================
let lastT = performance.now(), acc = 0;
// one FIXED (1/120s) step of world + physics — shared by the render loop
// and the E2E fast-forward hook
function stepSim(){
  S.worldT += FIXED;
  if(S.phase === 'countdown') updateCountdown(FIXED);
  API.updateObstacles(S.worldT, FIXED);
  if(S.phase === 'race'){
    S.raceClock += FIXED;
    S.tLeft -= FIXED;
    if(S.tLeft <= 0){
      S.tLeft = 0;
      // grace: humans within ~1.5% of the finish get 2 extra seconds
      const close = racers.some(r=>r.kind==='human' && !r.finished && progOf(r) > 0.985);
      if(close && !S.extendT){ S.extendT = 2; }
      if(S.extendT > 0){
        S.extendT -= FIXED;
        S.tLeft = 0.1;
      } else {
        endRace('time');
        return;
      }
    }
    const Lc = LVL[S.levelIdx];
    for(const r of racers){
      const B = r.body;
      if(r.finished){
        stepBody(B, celebrateIntent(r), FIXED, r);
      } else {
        const intent = r.kind==='human' ? humanIntent(r)
          : (r.brain ? r.brain.think(r, S, API, FIXED) : {mx:0,mz:1,jump:false,dive:false});
        stepBody(B, intent, FIXED, r);
      }
      if(B.pos.y < -7) fallRespawn(r);
      if(!r.finished && B.pos.z >= Lc.ring[0][2]-1.0 && B.pos.y < 2.5){
        racerFinish(r);
      }
      for(const c of API.RT.collectors){
        if(c.got) continue;
        const dx=c.x-B.pos.x, dy=c.y-B.pos.y-0.4, dz=c.z-B.pos.z;
        if(dx*dx+dy*dy+dz*dz < 1.25){
          c.got = true; c.mesh.visible = false;
          r.coins++;
          if(r.kind==='human'){ AU.coin(); toast('+1 🍬 '+r.name); }
          if(S.particles) S.particles.burst(c.x, c.y, c.z, 0xffd23e, 8, 0.5, 2.5, 2, 0.5);
        }
      }
    }
    separateRacers();
    const humans = racers.filter(r=>r.kind==='human');
    if(humans.length && humans.every(r=>r.finished)){
      S.endGraceT += FIXED;
      if(S.endGraceT > 3.5 || racers.every(r=>r.finished)) endRace('all');
    }
  } else if(S.phase === 'countdown'){
    for(const r of racers){
      const g = API.groundAt(r.body.pos.x, r.body.pos.z, r.body.pos.y);
      if(g.y > -1e8 && r.body.pos.y <= g.y) r.body.pos.y = g.y;
    }
  }
}
function frame(now){
  let dt = Math.min(0.05, (now-lastT)/1000);
  lastT = now;
  if(!S.scene || !S.renderer) return;
  pollPads();

  if(S.phase === 'menu'){
    // idle backdrop: slow orbit around the start area, obstacles keep moving
    S.worldT += dt;
    API.updateObstacles(S.worldT, dt);
    if(S.particles) S.particles.update(dt);
    if(S.water) S.water.material.uniforms.tt.value = S.worldT;
    const a = S.worldT*0.06;
    S.camera.position.set(Math.sin(a)*14, 8+Math.sin(S.worldT*0.13)*1.5, 12+Math.cos(a)*10);
    S.camera.lookAt(0, 1, 16);
    render();
    return;
  }

  if(!S.paused){
    acc += dt;
    let steps = 0;
    while(acc >= FIXED && steps < 6){
      stepSim();
      acc -= FIXED; steps++;
    }
    if(steps === 6) acc = 0;
    if(S.particles) S.particles.update(dt);
    for(const r of racers) updateBeanVisual(r, dt);
    if(S.water) S.water.material.uniforms.tt.value = S.worldT;
    updateHints();
  }
  updateHUD(dt);
  // split-screen renders each viewport itself; solo renders once (bloom path)
  renderRace(dt);
}
function render(){
  if(FX_QUALITY === 'high'){
    if(!S.composer) S.composer = buildComposer();
    if(S.composer) S.composer.render();
    else S.renderer.render(S.scene, S.camera);
  } else {
    S.composer = null;
    S.renderer.render(S.scene, S.camera);
  }
}

// ================= boot =================
function buildMenuScene(){
  if(S.water){ S.water.geometry.dispose(); S.water.material.dispose(); }
  if(S.sky){ S.sky.geometry.dispose(); S.sky.material.dispose(); }
  if(S.particles && S.particles.dispose) S.particles.dispose();
  S.composer = null;
  S.scene = new T.Scene();
  const L = LVL[0];
  S.scene.fog = new T.Fog(new T.Color(L.fog[0],L.fog[1],L.fog[2]).getHex(), 40, 160);
  S.sky = makeSky(L); S.scene.add(S.sky);
  S.sun = makeLights(S.scene, L);
  S.water = makeWater(L); S.scene.add(S.water);
  S.scene.add(API.buildLevel(0).group);
  S.particles = makeParticles(S.scene);
  S.worldT = 0;
}
function boot(){
  if(!window.ThemeAPI || !window.ThemeAPI.buildLevel || !window.LEVELS){ setTimeout(boot, 60); return; }
  initGeo();
  initRenderer();
  buildMenuScene();
  wireButtons();
  refreshLevelSel();
  refreshLobbyUI();
  // rAF-driven loop + watchdog: some webviews throttle rAF in the
  // background — keep the game alive via a light interval fallback
  let lastRaf = 0;
  function tick(now){ lastRaf = now; frame(now); requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  setInterval(()=>{
    const n = performance.now();
    if(n - lastRaf > 200){ lastRaf = n; frame(n); }
  }, 50);
}
addEventListener('beforeunload', ()=>{ try{ localStorage.setItem('srr-color', lobby.humans[0]!==undefined?COLORS[lobby.humans[0].color]:'#ff5c9d'); }catch(e){} });
boot();
