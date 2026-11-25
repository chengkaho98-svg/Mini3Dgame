// ================= SUGAR RUSH ROYALE — main.js =================
// Game core: renderer + bloom, fixed-step capsule physics (anti-tunnel),
// up-to-10 local racers (up to 4 on one keyboard + AI bots), countdown,
// one camera per player, particles, HUD, lobby & race flow.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

const T = THREE;
const LVL = window.LEVELS || [];
// Live binding to build.js ThemeAPI (loads after this module may run).
const API = new Proxy({}, {
  get(_t, k){ const a = window.ThemeAPI; if(!a) return undefined; const v = a[k]; return typeof v === 'function' ? v.bind(a) : v; },
  has(_t, k){ return !!(window.ThemeAPI && k in window.ThemeAPI); }
});

// ================= constants =================
const CY_R = 0.42, CY_H = 1.04;
const GRAV = 34, JUMP_V = 11.2, MAX_SPD = 6.2, MOVE_ACC = 46, DIVE_V = 12.5;
const FIXED = 1/120;
const MAX_RACERS = 10;
const BOOST_AIR_HEIGHT = 1.9;   // how high above a boost pad still triggers it
// COINS = SUGAR RUSH: every coin makes you a little faster for the rest of the
// race, and falling spills a few. Only human players collect them (the bots
// leave the coins on the track for you).
const COIN_BOOST = 0.015, COIN_MAX = 10, COINS_LOST_ON_FALL = 3;
const coinBonus = n => COIN_BOOST * Math.min(COIN_MAX, n);
const BOOST_AIR_LIFT = 7.5;     // min upward speed kept when boosted mid-air
const MAX_HUMANS = 4;   // local human players: four keyboard layouts on one keyboard
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
// Every sound effect is synthesised with WebAudio (no sample files). Music is
// optional and file-driven: drop these into assets/audio/ and they are picked
// up automatically, no code change —
//   bgm_menu.mp3, bgm_race.mp3      (seamless loops)
//   jingle_win.mp3, jingle_lose.mp3
// While a file is missing the game simply does without it (the jingles fall
// back to synthesised ones).
const AUDIO_DIR = 'assets/audio/';
const MUSIC_FILES = { menu: 'bgm_menu.mp3', race: 'bgm_race.mp3' };
const MUSIC_LEVEL = 0.55, SFX_LEVEL = 0.9;
function loadAudioPrefs(){
  try{
    const p = JSON.parse(localStorage.getItem('srr-audio') || '{}');
    return { music: typeof p.music === 'number' ? p.music : MUSIC_LEVEL, sfx: typeof p.sfx === 'number' ? p.sfx : SFX_LEVEL };
  }catch(e){ return { music: MUSIC_LEVEL, sfx: SFX_LEVEL }; }
}
const AU = {
  ctx:null, sfxBus:null, noiseBuf:null, muted:false,   // muted while tests fast-forward
  vol: loadAudioPrefs(),        // 0..1 each; 0 = off
  tracks: {},                   // file name -> HTMLAudioElement
  avail: {},                    // file name -> true once it answered
  current: null,                // music name playing now ('menu' | 'race')
  wanted: null,                 // music the game wants once it may play
  get on(){ return this.vol.sfx > 0; },
  ensure(){
    if(this.ctx || S.testMode) return this.ctx;
    try{
      const C = window.AudioContext || window.webkitAudioContext;
      if(!C) return null;
      this.ctx = new C();
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.vol.sfx;
      this.sfxBus.connect(this.ctx.destination);
      // one second of white noise, reused by every noisy effect
      const n = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, n, n), d = buf.getChannelData(0);
      for(let i=0;i<n;i++) d[i] = Math.random()*2 - 1;
      this.noiseBuf = buf;
    }catch(e){}
    return this.ctx;
  },
  setVol(kind, v){
    this.vol[kind] = v;
    try{ localStorage.setItem('srr-audio', JSON.stringify(this.vol)); }catch(e){}
    if(kind === 'sfx'){ if(this.sfxBus) this.sfxBus.gain.value = v; }
    else if(v <= 0) this.stopMusic(); else if(this.wanted) this.startMusic(this.wanted);
  },
  // --- building blocks ---
  tone(o){                      // oscillator with a pitch glide and a soft edge
    const c = this.ensure(); if(!c || this.muted || this.vol.sfx <= 0) return;
    const t0 = c.currentTime + (o.at||0), dur = o.dur||0.1, v = o.vol||0.15;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type||'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if(o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack||0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if(o.lp){ const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(this.sfxBus);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  },
  noise(o){                     // filtered noise burst with a frequency sweep
    const c = this.ensure(); if(!c || this.muted || this.vol.sfx <= 0 || !this.noiseBuf) return;
    const t0 = c.currentTime + (o.at||0), dur = o.dur||0.1;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = o.type||'bandpass'; f.Q.value = o.q||0.8;
    f.frequency.setValueAtTime(o.from||800, t0);
    if(o.to) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol||0.15, t0 + (o.attack||0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.03);
  },
  bell(freq, at, dur, vol){     // a note with its harmonics: coin / fanfare / tick
    this.tone({freq, at, dur, vol, type:'sine'});
    this.tone({freq:freq*2, at, dur:dur*0.7, vol:vol*0.3, type:'sine'});
    this.tone({freq:freq*3.01, at, dur:dur*0.4, vol:vol*0.12, type:'sine'});
  },
  // --- game sounds ---
  click(){ this.bell(1180, 0, 0.05, 0.08); },
  jump(){ this.tone({freq:430, to:820, dur:0.16, vol:0.16}); this.noise({from:1800, to:3200, dur:0.05, vol:0.05, type:'highpass'}); },
  dive(){ this.tone({freq:320, to:170, dur:0.17, vol:0.1, type:'sawtooth', lp:900}); this.noise({from:900, to:300, dur:0.14, vol:0.07}); },
  land(){ this.tone({freq:165, to:88, dur:0.09, vol:0.13, type:'triangle'}); this.noise({from:700, to:250, dur:0.05, vol:0.07, type:'lowpass'}); },
  coin(){ this.bell(988, 0, 0.1, 0.13); this.bell(1319, 0.07, 0.16, 0.13); },
  boing(){ this.tone({freq:230, to:640, dur:0.09, vol:0.2}); this.tone({freq:640, to:260, dur:0.2, vol:0.16, at:0.09}); },
  bump(){ this.noise({from:520, to:170, dur:0.13, vol:0.2, q:1.2}); this.tone({freq:115, to:58, dur:0.13, vol:0.2}); },
  hit(){ this.noise({from:1100, to:160, dur:0.32, vol:0.3, type:'lowpass'}); this.tone({freq:85, to:38, dur:0.28, vol:0.3}); },
  whoosh(){ this.noise({from:320, to:2600, dur:0.16, vol:0.18, q:1.5}); this.noise({from:2600, to:600, dur:0.22, vol:0.14, q:1.5, at:0.16}); },
  fall(){ this.tone({freq:720, to:170, dur:0.5, vol:0.13, type:'triangle'}); this.noise({from:1400, to:260, dur:0.4, vol:0.24, type:'lowpass', at:0.46}); },
  cd(n){ if(n === 0){ this.bell(880, 0, 0.34, 0.16); this.bell(1320, 0.02, 0.3, 0.1); } else this.bell(587, 0, 0.1, 0.14); },
  finish(){ [784, 988, 1175].forEach((f,i)=>this.bell(f, i*0.07, 0.2, 0.14)); },
  win(){ [523, 659, 784, 1047, 1319].forEach((f,i)=>this.bell(f, i*0.11, i === 4 ? 0.5 : 0.24, 0.16)); },
  lose(){ [392, 330, 262, 196].forEach((f,i)=>this.tone({freq:f, to:f*0.94, dur:0.2, vol:0.13, type:'triangle', at:i*0.17, lp:1500})); },
  // --- music (files) ---
  async probe(){                // which music files exist? (asked once, at boot)
    const files = Object.values(MUSIC_FILES).concat(['jingle_win.mp3', 'jingle_lose.mp3']);
    for(const file of files){
      try{ const r = await fetch(AUDIO_DIR + file, { method: 'HEAD' }); if(r.ok) this.avail[file] = true; }catch(e){}
    }
    if(this.wanted && !this.current) this.startMusic(this.wanted);
  },
  unlock(){                     // first user gesture: the browser allows sound now
    const c = this.ensure();
    if(c && c.state === 'suspended') c.resume().catch(()=>{});
    if(this.wanted) this.startMusic(this.wanted);
  },
  fade(a, to, ms, done){
    clearInterval(a._fade);
    const from = a.volume, t0 = performance.now();
    a._fade = setInterval(()=>{
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if(k >= 1){ clearInterval(a._fade); if(done) done(); }
    }, 40);
  },
  startMusic(name){
    this.wanted = name;
    const file = MUSIC_FILES[name];
    if(S.testMode || !file || !this.avail[file] || this.vol.music <= 0){ this.stopMusic(name === null); return; }
    if(this.current === name) return;
    this.stopMusic();
    let a = this.tracks[file];
    if(!a){ a = new Audio(AUDIO_DIR + file); a.loop = true; a.preload = 'auto'; this.tracks[file] = a; }
    a.volume = 0;
    a.play().then(()=>this.fade(a, this.vol.music, 800)).catch(()=>{});
    this.current = name;
  },
  stopMusic(forget){
    if(forget) this.wanted = null;
    for(const k in this.tracks){
      const a = this.tracks[k];
      if(!a.paused) this.fade(a, 0, 450, ()=>a.pause());
    }
    this.current = null;
  },
  jingle(kind){                 // 'win' | 'lose' at the results screen
    const file = 'jingle_' + kind + '.mp3';
    if(!S.testMode && this.avail[file] && this.vol.music > 0){
      this.stopMusic(true);
      const a = new Audio(AUDIO_DIR + file);
      a.volume = this.vol.music;
      a.play().catch(()=>{});
      return;
    }
    this[kind]();
  }
};

// ================= DOM =================
const $ = id => document.getElementById(id);
// Every id here must exist in index.html — tests/dom-contract.test.js checks it
// (a renamed element once silenced every toast message without any error).
const UI = {};
['hud','clock','progbar','racestrip','lvname','lvtime','stBox','hint','rankBox','rankList',
 'menu-ov','pause-ov','res-ov','resTitle','resStats','pauseStats','toastBox','lvlSel','colHud',
 'count-ov','countNum','lobbySlots','btnPlay','btnReset','btnResume','btnQuit',
 'btnNext','btnRetry','btnMenu','botCount','joinKb2','fxSel'].forEach(id=>{ UI[id]=$(id); });
UI.menu = UI['menu-ov']; UI.resOv = UI['res-ov']; UI.count = UI['count-ov'];
UI.pause = UI['pause-ov']; UI.prog = UI.progbar; UI.clockEl = UI.clock;
UI.keyrow = document.querySelector('#hud .keyrow');
UI.rotHint = $('rot');

function fmt(s){ s=Math.max(0,Math.ceil(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }

// small floating messages ("被大球撞飛！", "+1 🍬"). At most three on screen.
function toast(msg){
  const box = UI.toastBox;
  if(!box) return;
  const d = document.createElement('div');
  d.className = 'toast bump'; d.textContent = msg;
  box.appendChild(d);
  setTimeout(()=>{ d.style.transition='opacity .4s'; d.style.opacity='0'; }, 1500);
  setTimeout(()=>{ d.remove(); }, 2000);
  while(box.children.length > 3) box.firstChild.remove();
}

// ================= renderer / scene =================
let FX_QUALITY = 'high';
let SSAO_ON = true;        // contact-shadow pass in the bloom composer (solo view)
// Creating the WebGL renderer is the one step that can legitimately fail on a
// player's machine (no WebGL / blocked GPU). Say so on screen instead of
// leaving a menu whose buttons do nothing.
function initRenderer(){
  try{ initRendererGL(); }
  catch(e){
    console.error('WebGL unavailable:', e);
    S.renderer = null;
    if(window.__srrBootFail) window.__srrBootFail('你嘅瀏覽器不支援 WebGL，無法顯示 3D 畫面。請改用最新版 Chrome、Edge、Firefox 或 Safari。');
  }
}
function initRendererGL(){
  const canvas = $('c');
  S.renderer = new T.WebGLRenderer({canvas, antialias:true});
  S.renderer.setSize(innerWidth, innerHeight);
  S.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  S.renderer.shadowMap.enabled = true;
  S.renderer.shadowMap.type = T.PCFSoftShadowMap;
  S.renderer.toneMapping = T.ACESFilmicToneMapping;
  S.renderer.toneMappingExposure = 1.06;
  // image-based lighting: a neutral studio room prefiltered for PBR materials.
  // Gives every surface soft reflections + ambient fill without any HDR download.
  const pmrem = new T.PMREMGenerator(S.renderer);
  S.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  S.camera = new T.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 320);
  S.camera.position.set(0,6,-8);
  addEventListener('resize', onResize);
}
function onResize(){
  if(!S.renderer) return;
  S.camera.aspect = innerWidth/innerHeight;
  S.camera.updateProjectionMatrix();
  S.renderer.setSize(innerWidth, innerHeight);
  if(S.composer) S.composer.setSize(innerWidth, innerHeight);
  if(S.ssaoPass) S.ssaoPass.setSize(innerWidth, innerHeight);
}
function buildComposer(){
  try{
    const c = new EffectComposer(S.renderer);
    c.addPass(new RenderPass(S.scene, S.camera));
    // ambient occlusion: soft contact shadows where props meet the floor, so
    // the scene reads as solid objects rather than stickers on a plane
    if(SSAO_ON){
      const ssao = new SSAOPass(S.scene, S.camera, innerWidth, innerHeight);
      ssao.kernelRadius = 0.55;      // world-space reach of the occlusion
      ssao.minDistance = 0.001;
      ssao.maxDistance = 0.14;
      ssao.output = SSAOPass.OUTPUT.Default;
      c.addPass(ssao);
      S.ssaoPass = ssao;
    }
    const bloom = new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), 0.32, 0.62, 0.82);
    c.addPass(bloom);
    c.addPass(new OutputPass());
    return c;
  }catch(e){ console.warn('bloom unavailable, plain render', e); return null; }
}

function makeLights(scene, L){
  // theme-tinted IBL: the neutral room map tinted toward the level's sky/fog
  // (cheap: one shared env map, per-scene tint via background/environment color)
  scene.environment = S.envMap;
  const hemi = new T.HemisphereLight(0xffffff, 0x6688cc, 0.55);
  const sun = new T.DirectionalLight(0xfff2dd, 1.15);
  sun.position.set(14, 26, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
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
  const skyTop = new T.Color(L.sky[0], L.sky[1], L.sky[2]);
  const skyBot = new T.Color(L.fog[0], L.fog[1], L.fog[2]);
  // Reflective water. The reflection is a procedural sky gradient sampled along
  // the reflected view ray (tinted per level) instead of a real mirror pass:
  // it costs no extra scene render and works in every split-screen viewport,
  // while a Fresnel term makes far water read as a mirror and near water as
  // deep coloured liquid — the cue players use to spot a drop.
  const mat_ = new T.ShaderMaterial({
    transparent:true,
    uniforms:{ cA:{value:colA}, cB:{value:colB}, skyTop:{value:skyTop}, skyBot:{value:skyBot}, tt:{value:0} },
    vertexShader:`
      varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader:`
      varying vec3 vWorld;
      uniform vec3 cA; uniform vec3 cB; uniform vec3 skyTop; uniform vec3 skyBot; uniform float tt;
      // calm large-scale swell: a few soft sine trains that tilt the normal
      vec3 waveNormal(vec2 p, float t){
        vec2 q = p * 0.22;
        float a = sin(q.x*1.7 + t*0.9) + sin(q.y*2.3 - t*1.1 + sin(q.x*0.8)*1.3);
        float b = sin((q.x+q.y)*1.3 - t*0.7) + sin(q.x*3.1 + q.y*2.2 + t*1.4);
        return normalize(vec3(-a*0.045, 1.0, -b*0.045));
      }
      void main(){
        vec3 N = waveNormal(vWorld.xz, tt);
        vec3 V = normalize(cameraPosition - vWorld);
        // Schlick Fresnel: dark face-on, mirror-like at grazing angles
        float cosT = clamp(dot(N, V), 0.0, 1.0);
        float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
        // deep water colour with a slow drifting tone variation
        float tone = 0.5 + 0.5*sin(vWorld.x*0.11 + vWorld.z*0.07 + tt*0.35);
        vec3 deep = mix(cA, cB, tone*0.35);
        // reflected sky along the mirrored view direction
        vec3 R = reflect(-V, N);
        float h = clamp(R.y, 0.0, 1.0);
        vec3 refl = mix(skyBot, skyTop, pow(h, 0.6));
        vec3 col = mix(deep, refl, fres);
        // soft drifting sparkle band, kept subtle
        float sp = sin(vWorld.x*0.45 + tt*0.8) * sin(vWorld.z*0.38 - tt*0.6);
        col += vec3(1.0) * smoothstep(0.86, 1.0, sp) * 0.08;
        gl_FragColor = vec4(col, 0.97);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const m = new T.Mesh(new T.PlaneGeometry(300, z1+120), mat_);
  m.rotation.x = -Math.PI/2;
  m.position.set(0, -5.5, z1/2);
  return m;
}

// ================= particles =================
function makeParticles(scene){
  const N = 200;
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
  const body = new T.Mesh(GEO.cap, new T.MeshPhysicalMaterial({
    color:col, roughness:0.38, metalness:0.02,
    emissive:col.clone().multiplyScalar(0.1),
    envMapIntensity:0.85,           // strong IBL for the sugar-shell sheen
    clearcoat:1.0, clearcoatRoughness:0.14,
    sheen:0.35, sheenRoughness:0.6, sheenColor:col.clone().lerp(new T.Color(0xffffff), 0.6)
  }));
  body.position.y = CY_H/2;
  body.castShadow = true;
  inner.add(body);
  const belly = new T.Mesh(GEO.sph, new T.MeshPhysicalMaterial({
    color:0xffffff, roughness:0.1, metalness:0.0, transparent:true, opacity:0.32,
    envMapIntensity:1.0, clearcoat:1.0, clearcoatRoughness:0.08
  }));
  belly.position.set(0, CY_H*0.62, 0.26);
  belly.scale.set(1,1.28,0.4);
  inner.add(belly);
  const eyeW = new T.MeshPhysicalMaterial({color:0xffffff, roughness:0.12, envMapIntensity:1.0, clearcoat:1.0, clearcoatRoughness:0.05});
  const eyeB = new T.MeshPhysicalMaterial({color:0x1a1a24, roughness:0.1, envMapIntensity:1.0, clearcoat:1.0, clearcoatRoughness:0.05});
  for(let s of [-1,1]){
    const ew = new T.Mesh(GEO.small, eyeW);
    ew.position.set(s*0.16, CY_H*0.72, 0.33);
    ew.scale.set(1,1.25,0.62);
    inner.add(ew);
    const eb = new T.Mesh(GEO.pupil, eyeB);
    eb.position.set(s*0.17, CY_H*0.74, 0.42);
    inner.add(eb);
  }
  const footM = new T.MeshPhysicalMaterial({color:col.clone().multiplyScalar(0.72), roughness:0.45, envMapIntensity:0.7, clearcoat:0.7, clearcoatRoughness:0.2});
  const armM = new T.MeshPhysicalMaterial({color:col.clone().multiplyScalar(0.9), roughness:0.4, envMapIntensity:0.8, clearcoat:0.9, clearcoatRoughness:0.16});
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
  // OUTLINE SHELL (inverted hull): a slightly inflated, back-face-only white
  // shell around the body. Post-processing outlines don't work with the
  // scissored split-screen viewports, but a hull renders in every viewport
  // for free — so each human player can spot their own bean at a glance.
  let outline = null;
  if(isHuman){
    outline = new T.Mesh(GEO.cap, OUTLINE_MAT);
    outline.scale.setScalar(1.13);
    outline.position.y = CY_H/2;
    outline.renderOrder = -1;
    inner.add(outline);
  }
  g.add(nameTagSprite(name, colorHex, isHuman));
  return {g, inner, armLP, armRP, legL, legR, body, outline};
}

// one shared outline material: unlit white, no depth writes, slightly pulsing
const OUTLINE_MAT = new T.MeshBasicMaterial({
  color:0xffffff, side:T.BackSide, depthWrite:false, toneMapped:false
});
OUTLINE_MAT.__keep = true;   // shared across beans — never disposed with one

// ================= lobby =================
const COLORS = ['#ff5c9d','#31e6ff','#ffd23e','#58e06c','#a25cff','#ff8a3d','#ff4d4d','#ffffff','#ffa3d1','#7fd0f7'];
const lobby = {
  humans: [ {name:'P1', color:0, input:{kind:'kb', map:0}} ],   // map 0 = WASD
  botCount: -1   // -1 = auto fill to 10; 0..9 = explicit bot count
};
function freeColors(){
  const used = new Set(lobby.humans.map(h=>h.color));
  return COLORS.map((c,i)=>i).filter(i=>!used.has(i));
}
// next colour for a player when they click their colour dot: cycles through
// every colour nobody else is using (plus the one they already have)
function nextFreeColor(h){
  const used = new Set(lobby.humans.map(x=>x.color));
  const pool = COLORS.map((c,i)=>i).filter(i => i === h.color || !used.has(i));
  if(pool.length < 2) return h.color;
  return pool[(pool.indexOf(h.color) + 1) % pool.length];
}
function joinHuman(input){
  if(lobby.humans.length >= MAX_HUMANS) return false;
  const free = freeColors();
  if(!free.length) return false;
  const name = 'P'+(lobby.humans.length+1);
  lobby.humans.push({name, color:free[0], input});
  refreshLobbyUI();
  AU.unlock(); AU.click();
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
    const km = KB_MAPS[h.input.map];
    const inTxt = '⌨ '+KB_NAMES[h.input.map]+' · 跳 '+keyLabel(km.jump[0])+' · 撲 '+keyLabel(km.dive[0]);
    d.innerHTML = '<span class="sdot" style="background:'+COLORS[h.color]+'" title="撳一下換顏色"></span>'+
      '<span class="snm">'+h.name+'</span><span class="sin">'+inTxt+'</span>'+
      (i>0?'<span class="srm" title="移除">✕</span>':'<span class="sin">房主</span>');
    d.querySelector('.sdot').onclick = ()=>{ h.color = nextFreeColor(h); refreshLobbyUI(); AU.unlock(); AU.click(); };
    const rm = d.querySelector('.srm');
    if(rm) rm.onclick = ()=>removeHuman(i);
    UI.lobbySlots.appendChild(d);
  });
  const bots = lobby.botCount >= 0 ? Math.min(lobby.botCount, MAX_RACERS - lobby.humans.length) : MAX_RACERS - lobby.humans.length;
  const total = lobby.humans.length + bots;
  const info = document.createElement('div');
  info.className = 'slotinfo';
  info.innerHTML = '👥 玩家：<b>'+lobby.humans.length+' / '+MAX_HUMANS+'</b> 人類（鍵盤）＋ <b>'+bots+'</b> 機械人（共 <b>'+total+'</b> 人混戰）'+
    (lobby.humans.length > 1 ? ' · 🖥 直切分屏 '+lobby.humans.length+' 欄' : '')+
    '<br>⌨ 加入方法：撳 P2 方向鍵 / P3 IJKL / P4 TFGH 任一掣';
  UI.lobbySlots.appendChild(info);
}

// ================= input =================
const KB_MAPS = [
  {left:['KeyA'], right:['KeyD'], up:['KeyW'], down:['KeyS'], jump:['Space'], dive:['ShiftLeft']},
  {left:['ArrowLeft'], right:['ArrowRight'], up:['ArrowUp'], down:['ArrowDown'], jump:['ControlRight','Numpad0','Enter'], dive:['ShiftRight','Slash']},
  {left:['KeyJ'], right:['KeyL'], up:['KeyI'], down:['KeyK'], jump:['KeyU'], dive:['KeyO']},
  {left:['KeyF'], right:['KeyH'], up:['KeyT'], down:['KeyG'], jump:['KeyY'], dive:['KeyR']}
];
const KB_NAMES = ['WASD', '↑↓←→', 'IJKL', 'TFGH'];
const keys = {};
const ALL_KB_CODES = new Set(KB_MAPS.flatMap(m => [...m.left, ...m.right, ...m.up, ...m.down, ...m.jump, ...m.dive]));
addEventListener('keydown', e=>{
  if(ALL_KB_CODES.has(e.code)) e.preventDefault();   // no page scroll / button re-trigger
  keys[e.code] = true;
  if(e.code === 'Escape') togglePause();
  // lobby join: any key belonging to keyboard maps 1..3 while in menu
  if(S.phase === 'menu' && !e.repeat){
    for(let m=1;m<KB_MAPS.length;m++){
      const km = KB_MAPS[m];
      if(km.up.includes(e.code) || km.left.includes(e.code) || km.right.includes(e.code) || km.jump.includes(e.code)){
        if(!lobby.humans.some(h=>h.input.kind==='kb'&&h.input.map===m)) joinHuman({kind:'kb', map:m});
        break;
      }
    }
  }
});
addEventListener('keyup', e=>{ keys[e.code] = false; });
addEventListener('blur', ()=>{ for(const k in keys) keys[k]=false; });

// E2E / debug virtual drive: {racerName: {mx,mz,jump,dive}}
const DBG_DRIVE = {};
// ?test=1 boots without WebGL so the regression suites (tests/) can drive the
// simulation headlessly; everything else behaves exactly as normal.
S.testMode = /[?&]test=1(&|$)/.test(location.search);
window._DBG = { drive: DBG_DRIVE, S, racers, lobby,
  start(idx, opts){ startRace(idx, opts); },
  state(){ return racers.map(r=>({n:r.name, x:+r.body.pos.x.toFixed(2), y:+r.body.pos.y.toFixed(2), z:+r.body.pos.z.toFixed(2), fin:r.finished, rank:r.finishRank, falls:r.falls, up:r.body.upright})); },
  // synchronous fast-forward: run `sec` seconds of simulation without waiting
  // for real time (returns finishers). Audio/toasts muted during the run.
  advance(sec){
    AU.muted = true;
    const n = Math.round(sec / FIXED);
    for(let i=0;i<n;i++){
      if(S.phase === 'done' || S.phase === 'menu') break;
      stepSim();
    }
    AU.muted = false;
    return {
      phase: S.phase, t: +S.raceClock.toFixed(1),
      fin: racers.filter(r=>r.finished).map(r=>({n:r.name, t:+r.finishTime.toFixed(1), rank:r.finishRank})),
      unfin: racers.filter(r=>!r.finished).map(r=>({n:r.name, z:+r.body.pos.z.toFixed(1), falls:r.falls})),
      totalFalls: racers.reduce((a,r)=>a+r.falls,0)
    };
  },
  // --- hooks used by tests/suites.js (harmless in normal play) ---
  ui(){ updateHUD(0.2); updateHints(); updateKeyLights(); },
  columns(){ refreshColumnHud(); },
  toast(msg){ toast(msg); },
  menu(){ backToMenu(); },
  pause(){ togglePause(); },
  addHuman(map){ return joinHuman({kind:'kb', map: map === undefined ? lobby.humans.length : map}); },
  lobbyReset(){ lobby.humans.length = 1; lobby.humans[0].color = 0; lobby.botCount = -1; refreshLobbyUI(); }
};

function humanIntent(r){
  const inp = r.input;
  let ix=0, iz=0, jump=false, dive=false;
  {
    const m = KB_MAPS[inp.map];
    const any = arr=>arr.some(k=>keys[k]);
    if(any(m.left)) ix -= 1;
    if(any(m.right)) ix += 1;
    if(any(m.up)) iz -= 1;
    if(any(m.down)) iz += 1;
    jump = any(m.jump);
    dive = any(m.dive);
  }
  // controls are relative to THIS player's own viewport (P1 = mouse yaw,
  // keyboard-only players keep the default forward view)
  const yaw = (r.view && r.view.yaw !== undefined) ? r.view.yaw : S.camYaw;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
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
    coyote:0, jumpLatch:false, jumpBuf:0, diveHeld:false, diveAir:false, squash:0, grounded:false, groundBoard:null,
    glueMul:1, whackCd:-9, bumpCd:0, boostCd:0, speedMul:1, inFan:false,
    animT:0, runPhase:0, faceYaw:0
  };
}
function makeRacer(opts){
  const r = {
    id: opts.id, name: opts.name, colorHex: opts.colorHex, seat: opts.seat|0,
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
    const lim = (B.dive ? DIVE_V : MAX_SPD) * (glue < 1 ? 0.82 : 1) * (B.speedMul||1) * (1 + (r ? coinBonus(r.coins) : 0));
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
  // Boost pad triggers when you run onto it OR fly over it just above the
  // surface. (Standing-only made an early jump fatal: you sailed clean over
  // the pad with no boost and dropped into the gap it was meant to clear.)
  let boostPad = (gb && gb.boost && wasGrounded) ? gb : null;
  if(!boostPad && B.boostCd <= 0){
    for(const b of API.RT.boards){
      if(!b.boost || b.disabled) continue;
      if(B.pos.x >= b.x-b.hx && B.pos.x <= b.x+b.hx && B.pos.z >= b.z-b.hz && B.pos.z <= b.z+b.hz &&
         B.pos.y > b.y - 0.05 && B.pos.y < b.y + BOOST_AIR_HEIGHT){ boostPad = b; break; }
    }
  }
  if(boostPad && B.boostCd <= 0){
    const airborne = !wasGrounded;
    B.vel.z += boostPad.boost;
    B.vel.x *= 0.35;
    // An airborne boost (early jump) fires mid-arc; without a lift the extra
    // speed would still drop you into the gap. Top the arc up to a minimum
    // rise so an early jump lands as reliably as a jump from the pad itself.
    if(airborne && B.vel.y < BOOST_AIR_LIFT) B.vel.y = BOOST_AIR_LIFT;
    B.boostCd = 1.1;
    if(r && r.kind==='human'){ AU.whoosh(); }
    if(S.particles) S.particles.burst(B.pos.x, B.pos.y+0.3, B.pos.z, 0xffd23e, 10, 0.7, 3, 2, 0.5);
  }

  // --- dive ---
  // Works from the ground AND mid-air (the classic finish-line lunge).
  // Ground dive: a small hop + burst forward. Air dive: converts to a forward
  // lunge without the hop (keeps you from gaining free height).
  if(intent.dive && !B.diveHeld && B.upright && !B.dive){
    B.dive = true; B.diveT = 0; B.diveAir = !wasGrounded;
    const dl = Math.max(0.3, Math.hypot(ix,iz)||1);
    B.vel.x += (ix/dl)*DIVE_V*0.45;
    B.vel.z += (iz/dl)*DIVE_V*0.45;
    if(wasGrounded) B.vel.y = Math.max(B.vel.y, 3.0);
    else if(B.vel.y < -1) B.vel.y = -1;     // soften a fall into a lunge
    if(r && r.kind==='human') AU.dive();
  }
  B.diveHeld = !!intent.dive;
  if(B.dive) B.diveT += dt;   // ended after the ground resolve (see below)

  // --- jump: buffered + coyote-time (kills input latency and "couldn't jump" feels) ---
  // jumpBuf: a press made up to 0.15s before landing is remembered and fires
  //          on touchdown; coyote: a press just after leaving a ledge still works
  if(intent.jump && !B.jumpHeld) B.jumpBuf = 0.15;     // rising edge only
  B.jumpHeld = !!intent.jump;
  B.jumpBuf = Math.max(0, B.jumpBuf - dt);
  if(B.jumpBuf > 0 && B.upright && (wasGrounded || B.coyote > 0) && !B.dive){
    B.vel.y = JUMP_V;
    B.coyote = 0;
    B.jumpBuf = 0;
    B.squash = -0.35;
    B.grounded = false;
    if(r && r.kind==='human') AU.jump();
  }

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
        // standing on a falling-tile bridge arm(s) the tile under our feet
        if(g1.board && g1.board.type === 'tile' && g1.board.state === 'idle') g1.board._stood = true;
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

  // --- dive end (ground state is current here) ---
  // Touching down ends the lunge at once and hands control straight back
  // (no get-up delay): a dive should feel like a slide, not a face-plant.
  // Only a dive that times out still in the air tumbles into a short trip.
  if(B.dive && (B.grounded || B.diveT > 0.6)){
    const landed = B.grounded;
    B.dive = false;
    // keep the forward momentum on touchdown: the dive is a lunge, and the
    // slide afterwards IS the distance you bought (drag bleeds it off naturally)
    if(landed){ B.squash = 0.3; }
    else tripBody(B, 0.3);
  }

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
  B.graceT = Math.max(0, (B.graceT||0) - dt);
}

function tripBody(B, sev){
  if(!B.upright || (B.graceT||0) > 0) return;
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
      if(c._circle){
        // ROUND footprint (bumpers are balls). Push out along the centre
        // normal, so contact always has a sideways component that carries
        // you around the ball instead of pinning you on a flat face.
        let nx = B.pos.x - c._cx, nz = B.pos.z - c._cz;
        let d = Math.hypot(nx, nz);
        const reach = c._cr + r_;
        if(d >= reach){
          // AABB overlap test hit a corner the round footprint doesn't cover
          continue;
        }
        if(d < 1e-4){ nx = 0; nz = -1; d = 1; }
        nx /= d; nz /= d;
        let px = c._cx + nx * (reach + 0.001), pz = c._cz + nz * (reach + 0.001);
        // RAIL CORNER: a ball that sits close to the side rail also has a
        // corner where "straight out from the centre" points INTO the rail.
        // The road clamp then pushes us back into the ball and we are pinned.
        // Slide to the nearest point of the circle that is still on the road.
        const rx2 = API.roadXAt(B.pos.z);
        const loX = rx2[0] + CY_R*0.8, hiX = rx2[1] - CY_R*0.8;
        if(px < loX || px > hiX){
          const cxn = ((px < loX ? loX : hiX) - c._cx) / (reach + 0.001);
          if(Math.abs(cxn) < 1){
            const sz = Math.sqrt(1 - cxn*cxn) * (nz >= 0 ? 1 : -1);
            nx = cxn; nz = sz;
            px = px < loX ? loX : hiX;
            pz = c._cz + sz * (reach + 0.001);
          }
        }
        B.pos.x = px;
        B.pos.z = pz;
        // kill only the velocity going INTO the ball (tangential part is kept)
        const into = B.vel.x*nx + B.vel.z*nz;
        if(into < 0){ B.vel.x -= nx*into; B.vel.z -= nz*into; }
        c._hitNx = nx; c._hitNz = nz;       // for the kick direction below
      }
      else if(m === pxL){ B.pos.x = c.min.x - r_ - 0.001; if(B.vel.x>0) B.vel.x = 0; }
      else if(m === pxR){ B.pos.x = c.max.x + r_ + 0.001; if(B.vel.x<0) B.vel.x = 0; }
      else if(m === pzL){ B.pos.z = c.min.z - r_ - 0.001; if(B.vel.z>0) B.vel.z = 0; }
      else { B.pos.z = c.max.z + r_ + 0.001; if(B.vel.z<0) B.vel.z = 0; }
      if(c._bump){
        if(now - (B.bumpCd||0) > 0.35){
          B.bumpCd = now;
          // kick along the contact normal (falls back to centre-to-body)
          let kx = c._hitNx, kz = c._hitNz;
          if(kx === undefined){
            kx = B.pos.x - c._cx; kz = B.pos.z - c._cz;
            const kl = Math.max(0.05, Math.hypot(kx, kz)); kx /= kl; kz /= kl;
          }
          // HEAD-ON KICK: when the normal is nearly front-to-back, a kick
          // straight back returns you to the same spot and you walk straight
          // back in — forever (a player holding "forward" yo-yos at the ball).
          // Any contact flatter than ~24° is leaned to ~28° toward the side
          // you are steering, or away from the nearer rail if you are not.
          if(Math.abs(kx) < 0.4){
            const side = (B.vel.x > 0.05) ? 1 : (B.vel.x < -0.05) ? -1 : (c._cx <= 0 ? 1 : -1);
            const zSign = kz >= 0 ? 1 : -1;
            kx = side * 0.47; kz = zSign * 0.883;
          }
          B.vel.x = kx*c._kick;
          B.vel.z = kz*c._kick;
          B.vel.y = Math.max(B.vel.y, 3.2);
          if(r && r.kind==='human') AU.boing();
          if(S.particles) S.particles.burst(B.pos.x, B.pos.y+0.5, B.pos.z, 0xff5c9d, 8, 0.6, 2, 3, 0.4);
        }
        continue;
      }
      if(now - B.whackCd > 0.6 && (B.graceT||0) <= 0){
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
          // bots are gentle with each other: nine of them funnelling onto one
          // 3m pad otherwise shove the front runner to nearly twice the run
          // speed. Any collision involving a human keeps the full push.
          const imp = rel*((racers[i].kind === 'bot' && racers[j].kind === 'bot') ? 0.12 : 0.35);
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
function safeSpot(x, z, human){
  const g = API.groundAt(x, z, 3);
  if(g.y < 0) return false;
  if(g.board && (g.board.bounce || g.board.disabled)) return false;
  // never on a falling tile: a bot respawns lying down for ~0.6s and the tile
  // drops at 0.5s, so it would go straight back into the void
  if(g.board && g.board.type === 'tile') return false;
  // humans only: never respawn on a surface that pushes you on its own — a
  // boost pad right before a gap would relaunch you into the void and loop
  // the respawn forever (the "fall again right after respawn" bug)
  if(human && g.board && (g.board.boost || g.board.belt)) return false;
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
// true when a boost/bounce pad sits within `ahead` metres in front of (x, z)
function launchPadAhead(x, z, ahead){
  for(const b of API.RT.boards){
    if(!(b.boost || b.bounce) || b.disabled) continue;
    if(Math.abs(b.x - x) > (b.hx||1) + 0.5) continue;
    if(b.z + (b.hz||1) > z - 0.3 && b.z - (b.hz||1) < z + ahead) return true;
  }
  return false;
}
// true when any point within `clear` metres ahead/around (x, z) is over void
function nearVoidEdge(x, z, clear){
  for(let dz = -clear; dz <= clear; dz += 0.4){
    for(let dx = -0.6; dx <= 0.6; dx += 0.6){
      if(API.voidAt(x+dx, z+dz)) return true;
    }
  }
  return false;
}
function fallRespawn(r){
  r.falls++;
  const L = LVL[S.levelIdx];
  if(r.kind==='human'){
    AU.fall();
    const spilled = Math.min(r.coins, COINS_LOST_ON_FALL);
    r.coins -= spilled;
    if(spilled) toast('🍬 ' + r.name + ' 跌甩咗 ' + spilled + ' 粒硬幣');
  }
  if(S.particles) S.particles.burst(r.body.pos.x, -5.5, r.body.pos.z, 0x9fe8ff, 16, 1.4, 6, 8, 0.8);
  const baseZ = Math.max(L.spawn[2], r.body.pos.z - 5);
  const slots = [r.body.pos.x, 0, -1.2, 1.2, -2.4, 2.4];
  // HUMANS get the forgiving respawn (stand up instantly, keep clear of drops
  // and launch pads, brief invulnerability). BOTS keep the ORIGINAL behaviour
  // (the short get-up stumble), which is what naturally staggers a crowd of
  // bots after they fall together — changing it made them pile onto narrow
  // platforms and shove each other off.
  const human = r.kind === 'human';
  let found = false;
  for(let dz=0; dz<=20 && !found; dz+=0.6){
    const cz = baseZ - dz;
    if(cz < L.spawn[2]) break;
    const rxz = API.roadXAt(cz);
    for(const sx of slots){
      const cx = Math.max(rxz[0]+0.5, Math.min(rxz[1]-0.5, sx));
      let ok = safeSpot(cx, cz, human);
      if(ok){
        // stay clear of the next drop so the get-up (bots lie down ~0.6s)
        // cannot end with a step into nothing. Humans also keep clear of
        // launch pads in the run-up (2.5m) so a respawn can't be
        // auto-launched straight back into the void
        ok = !nearVoidEdge(cx, cz, human ? 1.6 : 1.2) && !(human && launchPadAhead(cx, cz, 2.5));
      }
      if(ok){
        const g = API.groundAt(cx, cz, 3);
        r.body.pos.set(cx, Math.max(0.05, g.y+0.02), cz);
        r.body.vel.set(0,0,0);
        r.body.dive = false;
        r.body.coyote = 0;
        if(human){
          // full control at once — no get-up lockout, no stale jump state.
          // Feet go exactly on the surface and coyote is primed, so a jump
          // pressed the instant you respawn works on the very first frame.
          r.body.pos.y = Math.max(0, g.y);
          r.body.grounded = true; r.body.coyote = 0.12;
          r.body.upright = true; r.body.fallT = 0; r.body.tripSev = 0; r.body.diveT = 0;
          r.body.jumpHeld = false; r.body.jumpBuf = 0;
          r.body.graceT = 0.8;
        } else {
          // original bot behaviour, untouched
          r.body.upright = false; r.body.fallT = 0; r.body.tripSev = 0.35;
          r.body.graceT = 0;
        }
        found = true;
        break;
      }
    }
  }
  if(!found){
    r.body.pos.set(L.spawn[0], L.spawn[1]+0.02, L.spawn[2]);
    r.body.vel.set(0,0,0);
    if(human){
      r.body.upright = true; r.body.fallT = 0; r.body.tripSev = 0;
      r.body.dive = false; r.body.jumpHeld = false; r.body.jumpBuf = 0;
      r.body.graceT = 0.8;
    } else {
      r.body.upright = true; r.body.fallT = 0;
      r.body.graceT = 0;
    }
  }
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
  // release the previous build's own GPU resources (per-gap materials, fan
  // columns, tile materials); _GEO / MAT_CACHE entries are shared and stay
  if(API.disposeLevel) API.disposeLevel();
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
    else bots = MAX_RACERS - lobby.humans.length;
  }
  const total = lobby.humans.length + bots;
  lobby.humans.forEach((h,i)=>{
    racers.push(makeRacer({id:i, name:h.name, colorHex:COLORS[h.color], kind:'human', input:h.input, seat:i}));
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
  clearViewComposers();
  rebuildViews();
  refreshColumnHud();

  S.worldT = 0; S.raceClock = 0; S.tLeft = L.time;
  if(window.SRR_ANALYTICS && window.SRR_ANALYTICS.reset) window.SRR_ANALYTICS.reset();
  S.finishCount = 0; S.endGraceT = 0; S.extendT = 0;
  S.phase = 'countdown'; S.countdownT = 3.4; S.paused = false;
  S.camYaw = Math.PI; S.camPitch = 0.46; S.camDist = 9.5; S.camShake = 0;
  cdLast = 4;
  hintIdx = -1;
  UI.hint.textContent = '';      // not the previous race's hint until the first band

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
  AU.startMusic('race');
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
    // retrigger the CSS pop for each tick: remove the class, force a reflow, re-add
    UI.countNum.classList.remove('go', 'tick');
    void UI.countNum.offsetWidth;
    if(n > 0){ UI.countNum.textContent = n; UI.countNum.classList.add('tick'); AU.cd(n); }
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
    AU.finish();
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
  AU.stopMusic(true);            // the results jingle takes over
  buildResults(reason);
}

// ---- personal records: best time + stars, one set per seat and level ----
// Seat 0 (P1) keeps the original keys, so existing saves still count.
function recordKeys(levelIdx, seat){
  return seat === 0 ? { best: 'best' + levelIdx, stars: 'stars' + levelIdx }
                    : { best: 'best' + levelIdx + '_p' + seat, stars: 'stars' + levelIdx + '_p' + seat };
}
function starsFor(tUsed, L){
  return tUsed <= L.time*0.45 ? 3 : tUsed <= L.time*0.7 ? 2 : 1;
}
const medalOf = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';

function buildResults(reason){
  const L = LVL[S.levelIdx];
  const order = standingsOrder();
  const humans = racers.filter(r => r.kind === 'human');
  const st = store.get();
  let anyFinished = false;
  // one card per human player: place, time, coins, falls, personal best
  const cards = humans.map(r => {
    const k = recordKeys(S.levelIdx, r.seat|0);
    const prev = st[k.best];
    let isNew = false;
    if(r.finished){
      anyFinished = true;
      if(prev === undefined || r.finishTime < prev){ st[k.best] = r.finishTime; isNew = true; }
      st[k.stars] = Math.max(starsFor(r.finishTime, L), st[k.stars] || 0);
    }
    return { r, isNew, best: st[k.best] };
  });
  if(anyFinished){
    st.cur = Math.min(LVL.length-1, S.levelIdx+1);      // remember where we got to
    store.set(st);
    refreshLevelSel();
  }
  // the title follows the best-placed human
  const ranked = cards.slice().sort((a, b) => (a.r.finished ? a.r.finishRank : 99) - (b.r.finished ? b.r.finishRank : 99));
  const best = ranked[0];
  let title, titleCls;
  if(best && best.r.finished){
    const rk = best.r.finishRank;
    title = rk === 1 ? '🥇 冠軍！' : rk === 2 ? '🥈 亞軍！' : rk === 3 ? '🥉 季軍！' : '🏁 第 ' + rk + ' 名';
    titleCls = 'win';
  } else {
    title = '⏰ 時間到！';
    titleCls = 'lose';
  }
  let html = '';
  // the podium
  html += '<div class="podium">' + order.slice(0, 3).map((r, i) =>
    '<div class="pod" style="border-color:' + r.colorHex + '">' + medalOf(i) + ' ' + r.name +
    '<span>' + (r.finished ? r.finishTime.toFixed(1) + 's' : '完成 ' + Math.round(progOf(r)*100) + '%') + '</span></div>').join('') + '</div>';
  // every human player's own numbers
  if(cards.length){
    html += '<div class="resCards">' + cards.map(c => {
      const r = c.r, n = starsFor(r.finishTime, L);
      return '<div class="resCard" style="border-color:' + r.colorHex + '">' +
        '<div class="cn">' + r.name + ' · ' + (r.finished ? '第 ' + r.finishRank + ' 名' : '未完成') + '</div>' +
        '<div class="ct">' + (r.finished ? r.finishTime.toFixed(1) + 's' : Math.round(progOf(r)*100) + '%') + '</div>' +
        (r.finished ? '<div class="cs">' + '★'.repeat(n) + '☆'.repeat(3 - n) + '</div>' : '') +
        '<div>🍬 硬幣 ' + r.coins + ' <span class="mut">（加速 +' + Math.round(coinBonus(r.coins)*100) + '%）</span></div>' +
        '<div>💀 落水 ' + r.falls + ' 次</div>' +
        (c.best !== undefined ? '<div class="mut">個人最佳 ' + c.best.toFixed(1) + 's' + (c.isNew ? ' <span class="new">★ 新紀錄！</span>' : '') + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  // everyone, in finishing order
  html += '<div class="resList">' + order.map((r, i) =>
    '<div class="rrow' + (r.kind === 'human' ? ' me' : '') + (r.finished ? ' fin' : '') + '" style="animation-delay:' + (0.12 + i*0.04).toFixed(3) + 's">' +
    '<span class="rp' + (r.kind === 'human' ? ' me' : '') + '">' + (medalOf(i) || (i + 1)) + '</span>' +
    '<span class="dot" style="background:' + r.colorHex + '"></span>' +
    '<span class="nm">' + r.name + (r.kind === 'human' ? ' 👤' : ' 🤖') + '</span>' +
    '<span class="rk">' + (r.finished ? r.finishTime.toFixed(1) + 's' : Math.round(progOf(r)*100) + '%') + '</span></div>').join('') + '</div>';
  UI.resTitle.textContent = title;
  UI.resTitle.className = titleCls;
  UI.resStats.innerHTML = html;
  UI.btnNext.textContent = S.levelIdx + 1 < LVL.length ? '➜ 下一關' : '🏆 完賽！返回主選單';
  UI.resOv.classList.remove('hidden');
  AU.jingle(best && best.r.finished ? 'win' : 'lose');
}

function progOf(r){
  const L = LVL[S.levelIdx];
  return Math.min(1, Math.max(0, (r.body.pos.z - L.spawn[2])/(L.ring[0][2]-L.spawn[2])));
}

// ================= split-screen HUD =================
// One screen column per human player, so each player can tell which view is
// theirs and sees their OWN standing / win% / hint / keys. The single-player
// panels (full standings list, stats box, key widget, mouse hint) would all
// land on top of the right-most player's view, so they are solo-only; the
// full standings are on the pause screen instead.
const KEY_LABEL = { Space:'Space', ShiftLeft:'左Shift', ShiftRight:'右Shift', ControlRight:'右Ctrl', Numpad0:'Num0', Enter:'Enter', Slash:'/',
  ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→' };
const keyLabel = code => KEY_LABEL[code] || code.replace('Key','');

// on-screen key widget for one player: their own keys, lighting up when pressed
function buildKeyWidget(box, map){
  const m = KB_MAPS[map];
  box.innerHTML = '';
  const row = () => { const r = document.createElement('div'); r.className = 'rowk'; box.appendChild(r); return r; };
  const cap = (r, codes, cls, tag) => {
    const k = document.createElement('div');
    k.className = 'wk' + (cls ? ' ' + cls : '');
    k.innerHTML = '<span>' + keyLabel(codes[0]) + '</span>' + (tag ? '<div class="tag">' + tag + '</div>' : '');
    k._codes = codes;
    r.appendChild(k);
    return k;
  };
  const r1 = row(); cap(r1, m.dive, 'sh', '撲倒'); cap(r1, m.jump, 'sp');
  const r2 = row(); cap(r2, m.left); cap(r2, m.up); cap(r2, m.down); cap(r2, m.right);
  return [...box.querySelectorAll('.wk')];
}
function refreshColumnHud(){
  const humans = racers.filter(r=>r.kind==='human');
  const split = humans.length > 1;
  for(const el of [UI.rankBox, UI.stBox, UI.rotHint, UI.keyrow, UI.hint]) if(el) el.classList.toggle('solo-only', split);
  document.body.classList.toggle('split', split);
  S.keyCaps = [];
  // start from a clean slate every time: a race that goes from four players
  // to one must not keep the old columns under the solo panels
  if(UI.colHud) UI.colHud.innerHTML = '';
  for(const r of racers) r.colEl = null;
  if(!split){
    // one player: the key widget lives in the corner and shows P1's keys
    if(UI.keyrow) for(const c of buildKeyWidget(UI.keyrow, humans[0] ? humans[0].input.map : 0)) S.keyCaps.push({ cap: c });
    return;
  }
  const box = UI.colHud;
  if(!box) return;
  box.innerHTML = '';
  const n = humans.length;
  humans.forEach((r, i)=>{
    const col = document.createElement('div');
    col.className = 'colhud';
    col.style.left = (i*100/n) + '%';
    col.style.width = (100/n) + '%';
    col.innerHTML =
      '<div class="cprog"><i></i></div>' +
      '<div class="ctag"><i style="background:' + r.colorHex + '"></i>' + r.name + '<span>' + KB_NAMES[r.input.map] + '</span></div>' +
      '<div class="cstat"></div>' +
      '<div class="chint"></div>' +
      '<div class="ckeys"></div>' +
      (i > 0 ? '<div class="cdiv"></div>' : '');
    box.appendChild(col);
    r.colEl = { prog: col.querySelector('.cprog i'), stat: col.querySelector('.cstat'), hint: col.querySelector('.chint'), hintIdx: -1 };
    for(const c of buildKeyWidget(col.querySelector('.ckeys'), r.input.map)) S.keyCaps.push({ cap: c, racer: r });
  });
}
function updateKeyLights(){
  for(const k of S.keyCaps) k.cap.classList.toggle('on', k.cap._codes.some(c => keys[c]));
}
function clearColumnHud(){
  if(UI.colHud) UI.colHud.innerHTML = '';
  for(const r of racers) r.colEl = null;
  S.keyCaps = [];
  for(const el of [UI.rankBox, UI.stBox, UI.rotHint, UI.keyrow, UI.hint]) if(el) el.classList.remove('solo-only');
  document.body.classList.remove('split');
}

// ================= camera / split-screen views =================
// One follow-camera per HUMAN racer. Solo (or bots-only spectate) renders
// full-frame; 2-4 humans render side-by-side full-height columns (all splits
// vertical), each with its own post chain and scissored viewport.
function makeView(racer){
  return {
    racer,
    cam: new T.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 320),
    yaw: Math.PI, pitch: 0.46, dist: 9.5,
    tgt: new T.Vector3(),
    comp: null, compW: 0, compH: 0
  };
}
// One post chain per split viewport, drawn straight into a scissored region
// of the screen. EffectComposer resizes every pass to the full viewport, so
// SSAO cannot be run at a reduced internal resolution — and SSAO re-renders
// the scene for depth+normals, which multiplies with the number of views.
// Measured on the dev machine (4 views, 1280x720): plain 8.8ms, +bloom 9.3ms,
// +SSAO 15.8ms. So: SSAO only with up to 2 views; 3-4 views keep bloom.
// The last pass must not clear, otherwise it wipes the columns beside it.
const SPLIT_SSAO_MAX_VIEWS = 2;
function buildViewComposer(v, w, h, withSSAO){
  try{
    const c = new EffectComposer(S.renderer);
    c.setSize(w, h);
    c.addPass(new RenderPass(S.scene, v.cam));
    if(SSAO_ON && withSSAO){
      const ssao = new SSAOPass(S.scene, v.cam, w, h);
      ssao.kernelRadius = 0.55; ssao.minDistance = 0.001; ssao.maxDistance = 0.14;
      c.addPass(ssao);
    }
    c.addPass(new UnrealBloomPass(new T.Vector2(w, h), 0.32, 0.62, 0.82));
    c.addPass(new OutputPass());
    return c;
  }catch(e){ console.warn('view composer unavailable', e); return null; }
}
function disposeViewComposer(v){
  if(!v.comp) return;
  try{ v.comp.passes.forEach(p=>{ if(p.dispose) p.dispose(); }); v.comp.dispose(); }catch(e){}
  v.comp = null; v.compW = 0; v.compH = 0;
}
function rebuildViews(){
  S.views = [];
  const humans = racers.filter(r=>r.kind==='human');
  for(const h of humans){ const v = makeView(h); h.view = v; S.views.push(v); }
  if(!S.views.length && racers.length) S.views.push(makeView(racers[0]));
  if(S.views.length){
    S.camera = S.views[0].cam;   // menu / solo path shares view0's camera
    S.composer = null;           // composer caches the camera — rebuild
  }
}
function clearViewComposers(){
  if(S.views) for(const v of S.views) disposeViewComposer(v);
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
  const humans = racers.filter(r=>r.kind==='human');
  if(humans.length > 1){
    // ALL VERTICAL SPLITS: one full-height column per player, side by side
    const n = Math.min(humans.length, S.views.length);
    const R = S.renderer;
    const vw = innerWidth/n, vh = innerHeight;
    const usePost = FX_QUALITY === 'high';
    R.setScissorTest(true);
    for(let i=0;i<n;i++){
      const v = S.views[i];
      const px = i*vw, py = 0;
      updateFollowCam(v, dt);
      v.cam.aspect = vw/vh;
      v.cam.updateProjectionMatrix();
      if(usePost){
        // (re)build this view's chain when it is missing or was resized
        const withSSAO = n <= SPLIT_SSAO_MAX_VIEWS;
        if(!v.comp || v.compW !== vw || v.compH !== vh || v.compSSAO !== withSSAO){
          disposeViewComposer(v);
          v.comp = buildViewComposer(v, vw, vh, withSSAO);
          v.compW = vw; v.compH = vh; v.compSSAO = withSSAO;
        }
        if(v.comp){
          // the chain renders full-target; confine it to this column
          R.setRenderTarget(null);
          R.setViewport(px, py, vw, vh);
          R.setScissor(px, py, vw, vh);
          v.comp.render();
          continue;
        }
      }
      R.setViewport(px, py, vw, vh);
      R.setScissor(px, py, vw, vh);
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
  // outline shell breathes so the player's bean stays easy to spot
  if(P.outline){
    P.outline.scale.setScalar(1.13 + 0.03*Math.sin(S.worldT*4.5));
  }
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
  // standings: full list on the right in solo, on the pause screen, and a
  // one-line chip per player in split-screen
  const order = standingsOrder();
  const AN = window.SRR_ANALYTICS;
  const winOf = (r) => (AN && AN.racers.get(r)) ? (AN.racers.get(r).win || 0) : 0;
  const standings = (AN && AN.standings) ? AN.standings(racers) : null;
  const posOf = r => standings ? standings.findIndex(x=>x.r === r) + 1 : order.indexOf(r) + 1;
  UI.rankList.innerHTML = standingRows(order, winOf, posOf);
  const p1h = racers.find(r=>r.kind==='human');
  UI.rankBox.querySelector('.rt').textContent = p1h
    ? '🏁 AI 勝率 · 你（' + p1h.name + '）第 ' + posOf(p1h) + '/' + racers.length + ' · ' + (p1h.finished ? '已衝線' : winOf(p1h).toFixed(0) + '%')
    : '🏁 AI 勝率';
  for(const r of racers){
    if(r.kind !== 'human') continue;
    if(r.colEl){
      r.colEl.stat.textContent = (r.finished ? '🏁 第 ' + r.finishRank + ' 名 · ' + r.finishTime.toFixed(1) + 's'
        : '第 ' + posOf(r) + '/' + racers.length + ' 名 · 勝率 ' + winOf(r).toFixed(0) + '%') + ' · 落水 ' + r.falls +
        (r.coins ? ' · 🍬 ' + r.coins + '（加速 +' + Math.round(coinBonus(r.coins)*100) + '%）' : ' · 🍬 0');
      r.colEl.prog.style.width = (progOf(r)*100).toFixed(1) + '%';
    } else if(r === p1h){
      UI.stBox.innerHTML = '<div>👥 <b>'+racers.length+'</b> 人混戰</div>'+
        '<div>🍬 硬幣 <b>'+r.coins+'</b>'+(r.coins ? ' <span class="mut">加速 +'+Math.round(coinBonus(r.coins)*100)+'%</span>' : '')+'</div>'+
        '<div>💀 落水 <b>'+r.falls+'</b></div>';
    }
  }
}

// race order: finished racers by crossing time, then everyone by progress
function standingsOrder(){
  return [...racers].sort((a,b)=>{
    if(a.finished && b.finished) return a.finishRank - b.finishRank;
    if(a.finished) return -1;
    if(b.finished) return 1;
    return progOf(b) - progOf(a);
  });
}
// the list rows used by the solo rank panel and the pause screen
function standingRows(order, winOf, posOf){
  let html = '';
  order.forEach((r,i)=>{
    const w = winOf ? winOf(r) : 0;
    const rank = posOf ? posOf(r) : i + 1;
    html += '<div class="rrow'+(r.kind==='human'?' me':'')+(r.finished?' fin':'')+'">'+
      '<span class="rp'+(r.kind==='human'?' me':'')+'">'+(r.finished?'🏆':rank)+'</span>'+
      '<span class="dot" style="background:'+r.colorHex+'"></span>'+
      '<span class="nm">'+r.name+(r.kind==='human'?' 👤':'')+'</span>'+
      (r.finished ? '<span class="rk">'+r.finishTime.toFixed(1)+'s</span>'
                  : '<span class="pb" title="勝率 '+w.toFixed(0)+'%"><i class="win" style="width:'+Math.max(4, w).toFixed(0)+'%"></i></span>'+
                    '<span class="wp">'+w.toFixed(0)+'%</span>')+
      '</div>';
  });
  return html;
}

let hintIdx = -1;
// gameplay hints: one global line for P1 in solo, each player's own line in split
function updateHints(){
  const L = LVL[S.levelIdx];
  if(!L || !L.hints || !L.hints.length) return;
  for(const r of racers){
    if(r.kind !== 'human') continue;
    let idx = -1;
    for(let i=0;i<L.hints.length;i++){
      const h = L.hints[i];
      if(r.body.pos.z >= h.z[0] && r.body.pos.z <= h.z[1]) idx = i;
    }
    if(r.colEl){
      if(idx !== r.colEl.hintIdx){
        r.colEl.hintIdx = idx;
        r.colEl.hint.textContent = idx >= 0 ? '💡 ' + L.hints[idx].t : '';
      }
    } else if(idx !== hintIdx){
      hintIdx = idx;
      UI.hint.textContent = idx >= 0 ? '💡 ' + L.hints[idx].t : '';
    }
  }
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
      AU.unlock(); AU.click();
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
  $('btnPlay').onclick = e=>{ e.target.blur(); AU.unlock(); startRace(store.get().cur||0); };
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
  // sound: music and effects switch separately, and the choice is remembered
  const wireVol = (id, kind, onLevel) => {
    const el = $(id); if(!el) return;
    el.value = AU.vol[kind] > 0 ? 'on' : 'off';
    el.onchange = ()=>{ AU.unlock(); AU.setVol(kind, el.value === 'on' ? onLevel : 0); if(kind === 'sfx' && AU.vol.sfx > 0) AU.click(); };
  };
  wireVol('musicSel', 'music', MUSIC_LEVEL);
  wireVol('sfxSel', 'sfx', SFX_LEVEL);
  if(UI.botCount) UI.botCount.onchange = ()=>{ lobby.botCount = parseInt(UI.botCount.value, 10); refreshLobbyUI(); };
  if(UI.joinKb2) UI.joinKb2.onclick = e=>{ e.target.blur();
    for(let m=1;m<KB_MAPS.length;m++){
      if(!lobby.humans.some(h=>h.input.kind==='kb'&&h.input.map===m)){ joinHuman({kind:'kb', map:m}); return; }
    }
  };
  if(UI.fxSel){
    UI.fxSel.onchange = ()=>{ FX_QUALITY = UI.fxSel.value; S.composer = null; };
  }
  // AI commentator toggle: only enable once the local model answers
  const commBox = $('aiComm'), commStatus = $('aiStatus');
  if(commBox && window.SRR_COMMENTATOR){
    const C = window.SRR_COMMENTATOR;
    // 'absent' = this host has no game server (static hosting): the feature is
    // not offered there, so the whole row is hidden rather than showing an error
    const aiRow = $('aiRow');
    const paint = ()=>{
      if(C.health === 'absent'){
        aiRow.hidden = true;
        commBox.checked = false; C.on = false;
        return;
      }
      aiRow.hidden = false;
      commStatus.textContent = C.health === 'ok'
        ? ('✅ 已連接 ' + (C.model || ''))
        : C.health === 'down' ? '❌ 本地模型未有回應' : '偵測中…';
      commStatus.style.color = C.health === 'ok' ? '#7ee7a2' : (C.health === 'down' ? '#ff8a8a' : '#9a86c8');
    };
    commBox.onchange = ()=>{ C.on = commBox.checked; if(C.on) C.lastT = -99; };
    const poll = ()=> C.checkHealth().then(h => { paint(); if(h === 'absent') clearInterval(timer); return h; });
    const timer = setInterval(poll, 15000);
    poll();
    if(commBox.disabled !== undefined) commBox.disabled = false;
  }
}
function backToMenu(){
  S.phase = 'menu';
  UI.btnNext.textContent = '➜ 下一關';
  S.paused = false;
  AU.startMusic('menu');
  for(const r of racers){
    if(r.mesh.parent) r.mesh.parent.remove(r.mesh);
    disposeBean(r);
  }
  racers.length = 0;
  clearViewComposers();
  S.views = [];
  clearColumnHud();
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
    // the full standings live here (in split-screen the rank panel is hidden)
    const AN = window.SRR_ANALYTICS;
    const winOf = r => (AN && AN.racers.get(r)) ? (AN.racers.get(r).win || 0) : 0;
    const st = (AN && AN.standings) ? AN.standings(racers) : null;
    UI.pauseStats.innerHTML = '關卡 <b>'+(S.levelIdx+1)+'</b> · 剩餘 <b>'+fmt(S.tLeft)+'</b>'+
      '<div class="pauseList">'+standingRows(standingsOrder(), winOf, r => st ? st.findIndex(x=>x.r === r) + 1 : 0)+'</div>';
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
      if(r.kind !== 'human') continue;              // bots leave the coins for the players
      for(const c of API.RT.collectors){
        if(c.got) continue;
        const dx=c.x-B.pos.x, dy=c.y-B.pos.y-0.4, dz=c.z-B.pos.z;
        if(dx*dx+dy*dy+dz*dz < 1.25){
          c.got = true; c.mesh.visible = false;
          r.coins++;
          AU.coin();
          toast('+1 🍬 ' + r.name + '　糖分加速 +' + Math.round(coinBonus(r.coins)*100) + '%');
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
// adaptive resolution: keep 60fps by scaling render resolution
S.fpsEMA = 60; S.basePR = Math.min(devicePixelRatio, 2); S.curPR = S.basePR;
S.prCheckT = 0;
function adaptiveRes(dt){
  S.fpsEMA += (1/Math.max(0.001, dt) - S.fpsEMA) * 0.05;
  S.prCheckT += dt;
  if(S.prCheckT < 2) return;
  S.prCheckT = 0;
  if(S.fpsEMA < 45 && S.curPR > 1){
    S.curPR = Math.max(1, S.curPR - 0.25);
    S.renderer.setPixelRatio(S.curPR);
    if(S.composer) S.composer.setSize(innerWidth, innerHeight);
  } else if(S.fpsEMA > 57 && S.curPR < S.basePR){
    S.curPR = Math.min(S.basePR, S.curPR + 0.25);
    S.renderer.setPixelRatio(S.curPR);
    if(S.composer) S.composer.setSize(innerWidth, innerHeight);
  }
}
function frame(now){
  let dt = Math.min(0.05, (now-lastT)/1000);
  lastT = now;
  if(!S.scene || !S.renderer) return;
  adaptiveRes(dt);

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
  updateKeyLights();
  updateHUD(dt);
  // live analytics (win% + events) — read-only, never affects the race
  if(window.SRR_ANALYTICS) window.SRR_ANALYTICS.update(racers, S, dt);
  if(window.SRR_COMMENTATOR) window.SRR_COMMENTATOR.update(racers, S, dt);
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
  if(API.disposeLevel) API.disposeLevel();
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
  if(!S.testMode) initRenderer();   // headless test mode: no WebGL, sim only
  buildMenuScene();
  wireButtons();
  refreshLevelSel();
  refreshLobbyUI();
  // Music is optional (files in assets/audio/). Ask which files exist now;
  // playing waits for the first click or key press, when browsers allow sound.
  AU.wanted = 'menu';
  AU.probe();
  addEventListener('pointerdown', () => AU.unlock());
  addEventListener('keydown', () => AU.unlock());
  // rAF-driven loop + watchdog: some webviews throttle rAF in the
  // background — keep the game alive via a light interval fallback
  let lastRaf = 0;
  function tick(now){ lastRaf = now; frame(now); requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  setInterval(()=>{
    const n = performance.now();
    if(n - lastRaf > 200){ lastRaf = n; frame(n); }
  }, 50);
  S.booted = true;
  window.__srrBooted = true;      // stops the "could not start" timer in index.html
  document.documentElement.classList.add('srr-booted');
  if(S.testMode && window.SRR_TEST && window.SRR_TEST.autorun) window.SRR_TEST.autorun();
}
boot();
