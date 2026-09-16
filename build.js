// ================= SUGAR RUSH ROYALE — build.js =================
// Scene assembly + obstacle factory + per-frame obstacle animation.
// Exposes window.ThemeAPI = {buildLevel, updateObstacles, groundAt,
//   effectiveSurfaceY, roadXAt, voidAt, glueAt, beltAt, fanAt, PAL, RT, STEP_UP}
// Consumed by main.js + bots.js. Reads window.LEVELS from levels.js.
(function(){
'use strict';
const THREE = window.THREE;
const LEVELS = window.LEVELS;
if(!THREE){
  // Module scripts resolve async; bail now, main.js retry loop will re-eval.
  setTimeout(function(){
    const s = document.createElement('script');
    s.src = 'build.js?r=' + Date.now();
    document.body.appendChild(s);
  }, 80);
  return;
}

const STEP_UP = 0.36;   // max ledge a capsule walks up automatically

// ---------- palette ----------
const PAL = {
  candyPink:0xff5c9d, candyBlue:0x33c6ff, candyYellow:0xffd23e, candyGreen:0x58e06c,
  candyPurple:0xa25cff, candyOrange:0xff8a3d, candyWhite:0xfff7f2, candyDeep:0xe6486e,
  foam:0xbfe9ff, foamDeep:0x7fd0f7, gunMetal:0x5b6478, cream:0xfff3d6,
  honey:0xffb347, honeyDeep:0xd9902a, mint:0xaef4d8, bubblegum:0xffa3d1,
  trackBlue:0x4f74ff, trackPurple:0x7a4fff, darkPlum:0x2b1b4e,
  jelly:0x7ce8a4, jellyDeep:0x3fae6e, stormGray:0x8a93c8, red:0xff4d4d
};
window._PAL = PAL;

// ---------- material helpers ----------
const MAT_CACHE = new Map();
function mat(color, opts){
  opts = opts || {};
  const key = color + '|' + JSON.stringify(opts);
  if(MAT_CACHE.has(key)) return MAT_CACHE.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: color,
    roughness: opts.rough !== undefined ? opts.rough : 0.65,
    metalness: opts.metal !== undefined ? opts.metal : 0.02,
    emissive: opts.emissive !== undefined ? opts.emissive : 0x000000,
    emissiveIntensity: opts.ei !== undefined ? opts.ei : 1.0,
    transparent: !!opts.transparent,
    opacity: opts.opacity !== undefined ? opts.opacity : 1.0
  });
  MAT_CACHE.set(key, m);
  return m;
}
function setEmissive(m, hex){ if(m.emissive && m.emissive.setHex) m.emissive.setHex(hex); }

// ---------- shared geometry ----------
const _GEO = {
  box: new THREE.BoxGeometry(1,1,1),
  sph: new THREE.SphereGeometry(1,20,14),
  cyl: new THREE.CylinderGeometry(1,1,1,18),
  cone: new THREE.ConeGeometry(1,1,16),
  torus: new THREE.TorusGeometry(1,0.28,10,24),
  plane: new THREE.PlaneGeometry(1,1),
  hex: new THREE.CylinderGeometry(0.7,0.7,0.3,6)
};
function makeBox(w,h,d,color,opts){
  const m = new THREE.Mesh(_GEO.box, mat(color,opts));
  m.scale.set(w,h,d);
  return m;
}
function makeBall(r,color,opts){
  const m = new THREE.Mesh(_GEO.sph, mat(color,opts));
  m.scale.setScalar(r);
  return m;
}
function makeCyl(r,h,color,opts){
  const m = new THREE.Mesh(_GEO.cyl, mat(color,opts));
  m.scale.set(r,h,r);
  return m;
}
function makeCone(r,h,color,opts){
  const m = new THREE.Mesh(_GEO.cone, mat(color,opts));
  m.scale.set(r,h,r);
  return m;
}

// ================= level runtime data =================
const RT = {
  solids: [],      // {min,max,tag,...} AABB colliders (many stamped live by anims)
  anims: [],       // (t, dt) => void
  boards: [],      // standable surfaces {x,z,hx,hz,y,...flags} (+type/disc/tile)
  voids: [],       // {x0,x1,z0,z1}
  fans: [],        // {x,z,r,force}
  narrows: [],     // {z0,z1,x0,x1}
  collectors: [],  // coins
  group: null
};
window._RT = RT;

function resetRuntime(){
  RT.solids.length = 0;
  RT.anims.length = 0;
  RT.boards.length = 0;
  RT.voids.length = 0;
  RT.fans.length = 0;
  RT.narrows.length = 0;
  RT.collectors.length = 0;
}
function addSolidBox(cx,cy,cz,hx,hy,hz,tag){
  RT.solids.push({
    min: new THREE.Vector3(cx-hx, cy-hy, cz-hz),
    max: new THREE.Vector3(cx+hx, cy+hy, cz+hz),
    tag: tag || ''
  });
}
function deadCollider(tag){
  return {min:new THREE.Vector3(1e9,1e9,1e9), max:new THREE.Vector3(1e9,1e9,1e9), tag:tag};
}

// ================= obstacle builders =================

// --- candy windmill: 3 blades rotating in XY plane at fixed z ---
// Hub is placed so the lowest blade tip sweeps just above the floor
// (tip clearance 0.15m — never clips through the road slab).
function buildMill(g, L, o){
  const r = o.r, hubY = r + 0.15, speed = o.speed || 0.9;
  const hub = new THREE.Group();
  hub.position.set(o.x, hubY, o.z);
  g.add(hub);
  hub.add(makeBall(0.55, PAL.candyYellow, {rough:0.4}));
  const colors = [PAL.candyPink, PAL.candyBlue, PAL.candyYellow];
  for(let i=0;i<3;i++){
    const holder = new THREE.Group();
    const b = makeBox(0.5, r, 0.22, colors[i], {emissive:0x331122, ei:0.35});
    b.position.y = r*0.5 + 0.3;
    holder.add(b);
    holder.rotation.z = i * (Math.PI*2/3);
    hub.add(holder);
    const tip = makeBall(0.3, PAL.candyWhite);
    tip.position.set(0, r - 0.25, 0);
    holder.add(tip);
  }
  const cols = [];
  for(let i=0;i<9;i++){
    const c = deadCollider('mill');
    RT.solids.push(c); cols.push(c);
  }
  RT.anims.push(function(t){
    const a = (o.a0||0) + speed*t;
    hub.rotation.z = a;
    let idx = 0;
    for(let i=0;i<3;i++){
      const baseA = a + i*(Math.PI*2/3);
      const dirX = -Math.sin(baseA), dirY = Math.cos(baseA);
      for(let s=0;s<3;s++){
        const r0 = 0.4 + s*(r-0.4)/3;
        const r1 = 0.4 + (s+1)*(r-0.4)/3;
        const rm = (r0+r1)/2;
        const px = o.x + dirX*rm;
        const py = hubY + dirY*rm;
        const half = (r1-r0)/2 + 0.28;
        cols[idx].min.set(px-half, py-half, o.z - 0.24);
        cols[idx].max.set(px+half, py+half, o.z + 0.24);
        idx++;
      }
    }
  });
}

// --- giant rolling candy ball sweeping ACROSS the road (Big-Balls style) ---
function buildRoller(g, L, o){
  const r = o.r || 1.15, speed = o.speed || 2.8, phase = o.phase || 0;
  const z = o.z;
  const xA = L.road[0][0] + r*0.25, xB = L.road[1][0] - r*0.25;
  const b = makeBall(r, PAL.candyOrange, {rough:0.3, emissive:0x442200, ei:0.4});
  b.position.set(o.x, r*0.97, z);
  b.castShadow = true;
  g.add(b);
  const stripe = new THREE.Mesh(_GEO.torus, mat(PAL.candyWhite));
  stripe.scale.setScalar(r*0.94);
  stripe.rotation.y = Math.PI/2;
  b.add(stripe);
  const c = deadCollider('roller');
  RT.solids.push(c);
  let prevX = o.x !== undefined ? o.x : (L.road[0][0] + L.road[1][0]) / 2;
  RT.anims.push(function(t){
    const p = (((t*speed)/((xB-xA)) + phase) % 2 + 2) % 2;
    const u = p < 1 ? p : 2 - p;
    const x = xA + (xB-xA)*u;
    b.position.x = x;
    b.rotation.z -= (x - prevX)/r;
    prevX = x;
    c.min.set(x-r*0.92, 0, z-r*0.92);
    c.max.set(x+r*0.92, r*1.72, z+r*0.92);
    c._vx = x - (c._lx === undefined ? x : c._lx);
    c._lx = x;
  });
}

// --- elevator pad (bobs up & down; carries the rider) ---
function buildElevator(g, L, o){
  const w=o.w||2.2, d=o.d||2.8, lift=o.lift||2.4, period=o.period||4, phase=o.phase||0;
  const b = makeBox(w, 0.5, d, PAL.candyBlue, {rough:0.5, emissive:0x113355, ei:0.4});
  b.position.set(o.x, 0, o.z);
  b.castShadow = true;
  g.add(b);
  const stripeL = makeBox(w*0.2, 0.54, d*0.9, PAL.candyGreen);
  stripeL.position.set(w*0.3, 0, 0);
  b.add(stripeL);
  const skirt = makeBox(w*0.96, 1.6, d*0.96, PAL.gunMetal, {transparent:true, opacity:0.35});
  skirt.position.set(o.x, -1.0, o.z);
  g.add(skirt);
  const board = {x:o.x, z:o.z, hx:w/2, hz:d/2, y:0.25, type:'elev'};
  RT.boards.push(board);
  RT.anims.push(function(t, dt){
    const s = 0.5 - 0.5*Math.cos((t/period + phase)*Math.PI*2);
    // sinking cycle: top stays at or below walk-on height (+0.36) so the
    // platform is NEVER a wall — the challenge is it dips toward the void
    const y = s*lift - lift*0.78;
    const ny = y + 0.25;
    board._dy = ny - board.y;
    board.y = ny;
    b.position.y = y;
  });
}

// --- bounce pad ---
function buildBounce(g, L, o){
  const r = o.r || 1.2, power = o.power || 11;
  const pad = makeCyl(r, 0.3, PAL.candyGreen, {emissive:0x1d5c26, ei:0.8});
  pad.position.set(o.x, 0.15, o.z);
  g.add(pad);
  const arrow = makeCone(0.44, 0.7, PAL.candyWhite, {emissive:0x445544, ei:0.5});
  arrow.position.set(o.x, 0.62, o.z);
  g.add(arrow);
  RT.boards.push({x:o.x, z:o.z, hx:r, hz:r, y:0.3, bounce:power});
  RT.anims.push(function(t){
    const s = 1 + 0.09*Math.sin(t*3.2);
    pad.scale.x = r*s; pad.scale.z = r*s;
  });
}

// --- conveyor belt ---
// No moving stripes: the surface stays uniform (moving bars read as crawling
// shadows); two static edge rails mark the belt zone instead.
function buildBelt(g, L, o){
  const Lx = o.L || 8, w = o.w || 5, speed = o.speed||2.4, dir = o.dir||-1;
  const b = makeBox(w, 0.3, Lx, PAL.darkPlum, {rough:0.85});
  b.position.set(o.x, 0.15, o.z);
  b.receiveShadow = true;
  g.add(b);
  for(let si=0; si<2; si++){
    const side = si===0?-1:1;
    const rail = makeBox(0.16, 0.34, Lx, 0x3a4a8f, {rough:0.7, emissive:0x0a1030, ei:0.3});
    rail.position.set(o.x + side*(w/2-0.1), 0.17, o.z);
    g.add(rail);
  }
  RT.boards.push({x:o.x, z:o.z, hx:w/2, hz:Lx/2, y:0.3, belt:speed*dir});
}

// --- bumper ---
function buildBumper(g, L, o){
  const r = o.r || 1.0, kick = o.kick || 6;
  const bb = makeBall(r, PAL.candyDeep, {rough:0.35, emissive:0x551122, ei:0.6});
  bb.position.set(o.x, r*0.9, o.z);
  g.add(bb);
  const band = new THREE.Mesh(_GEO.torus, mat(PAL.candyWhite));
  band.scale.setScalar(r*0.92);
  bb.add(band);
  const c = deadCollider('bumper');
  c._kick = kick; c._bump = true;
  c.min.set(o.x-r*0.85, 0, o.z-r*0.85);
  c.max.set(o.x+r*0.85, r*1.8, o.z+r*0.85);
  RT.solids.push(c);
  RT.anims.push(function(t){
    bb.scale.setScalar(r*(1+0.07*Math.sin(t*4 + o.z)));
  });
}

// --- honey glue pool ---
function buildHoney(g, L, o){
  const w = o.w||5, d = o.d||4, mul = o.mul||0.42;
  const pool = makeBox(w, 0.22, d, PAL.honey, {rough:0.22, emissive:0x553300, ei:0.35, transparent:true, opacity:0.93});
  pool.position.set(o.x, 0.11, o.z);
  g.add(pool);
  const dr1 = makeBall(0.45, PAL.honeyDeep);
  dr1.scale.y = 0.55; dr1.position.set(o.x-w*0.28, 0.26, o.z+d*0.22);
  g.add(dr1);
  const dr2 = makeBall(0.34, PAL.honeyDeep);
  dr2.scale.y = 0.55; dr2.position.set(o.x+w*0.25, 0.24, o.z-d*0.24);
  g.add(dr2);
  RT.boards.push({x:o.x, z:o.z, hx:w/2, hz:d/2, y:0.22, glue:mul});
}

// --- ground spin rotator: arms sweeping low ---
function buildRotator(g, L, o){
  const r = o.r||3, speed = o.speed||1.4, arms = o.arms||6, hubY = o.hubY||0.55;
  const hub = new THREE.Group();
  hub.position.set(o.x, hubY, o.z);
  g.add(hub);
  hub.add(makeBall(0.5, PAL.candyPurple));
  for(let i=0;i<arms;i++){
    const holder = new THREE.Group();
    const arm = makeBox(r, 0.38, 0.55, PAL.candyPurple, {emissive:0x2a1140, ei:0.5});
    arm.position.x = r*0.5;
    holder.add(arm);
    holder.rotation.y = i*(Math.PI*2/arms);
    hub.add(holder);
    const tip = makeBall(0.24, PAL.candyWhite);
    tip.position.x = r;
    holder.add(tip);
  }
  const cols = [];
  for(let i=0;i<arms*2;i++){
    const c = deadCollider('rotor');
    RT.solids.push(c); cols.push(c);
  }
  RT.anims.push(function(t){
    hub.rotation.y = speed*t;
    let idx = 0;
    for(let i=0;i<arms;i++){
      const a = speed*t + i*(Math.PI*2/arms);
      for(let s=0;s<2;s++){
        const rr = r*(0.32 + s*0.5);
        const px = o.x + Math.cos(a)*rr;
        const pz = o.z - Math.sin(a)*rr;
        const half = r*0.27;
        cols[idx].min.set(px-half, 0, pz-half);
        cols[idx].max.set(px+half, 1.15, pz+half);
        idx++;
      }
    }
  });
}

// --- pendulum hammer ---
// Pivot height follows the arm so the ball sweeps just above the floor
// (ball bottom clears 0.15m at the lowest swing — no ground clipping).
// A gantry (side posts + crossbar) anchors the pivot visually.
function buildPendulum(g, L, o){
  const arm = o.arm||5, speed = o.speed||1.2, phase=o.phase||0;
  const hubY = arm + 1.7;
  const pivot = new THREE.Group();
  pivot.position.set(o.x, hubY, o.z);
  g.add(pivot);
  const rod = makeBox(0.24, arm, 0.24, PAL.gunMetal);
  rod.position.y = -arm/2;
  pivot.add(rod);
  const ball = makeBall(1.05, PAL.candyYellow, {rough:0.3});
  ball.position.y = -arm - 0.5;
  ball.castShadow = true;
  pivot.add(ball);
  const star = makeBox(0.9, 0.9, 0.9, PAL.candyPurple);
  ball.add(star); star.scale.setScalar(0.38);
  const MAXA = 1.0;
  const c = deadCollider('pend');
  RT.solids.push(c);
  RT.anims.push(function(t){
    const a = Math.sin(t*speed + phase)*MAXA;
    pivot.rotation.z = a;
    const by = -arm - 0.5;
    const wx = o.x + Math.sin(a)*(-by);
    const wy = hubY + Math.cos(a)*(by);
    c.min.set(wx-0.98, Math.max(0.02, wy-0.98), o.z-0.98);
    c.max.set(wx+0.98, wy+0.98, o.z+0.98);
  });
  // gantry mount: crossbar + two posts at the road edges
  const halfRoad = Math.min(Math.abs(L.road[0][0]), Math.abs(L.road[1][0]));
  const barW = (halfRoad + 1.2) * 2;
  const mount = makeBox(barW, 0.42, 0.9, PAL.gunMetal);
  mount.position.set(o.x, hubY+0.21, o.z);
  g.add(mount);
  for(let si=0; si<2; si++){
    const sx = (si===0 ? -1 : 1) * (halfRoad + 1.0);
    const post = makeCyl(0.16, hubY+0.42, PAL.gunMetal);
    post.position.set(o.x + sx, (hubY+0.42)/2, o.z);
    g.add(post);
  }
}

// --- crusher piston (slams down across part of the road) ---
function buildCrusher(g, L, o){
  const spd = o.spd||6, phase=o.phase||0;
  const x0 = o.x[0], x1 = o.x[1], z = o.z;
  const bodyW = x1-x0, bodyD = 1.9;
  const frameL = makeBox(0.5, 6, bodyD+0.6, PAL.gunMetal);
  frameL.position.set(x0-0.25, 3, z);
  g.add(frameL);
  const frameR = makeBox(0.5, 6, bodyD+0.6, PAL.gunMetal);
  frameR.position.set(x1+0.25, 3, z);
  g.add(frameR);
  const body = makeBox(bodyW, 0.9, bodyD, PAL.candyDeep, {rough:0.5});
  body.position.set((x0+x1)/2, 3.6, z);
  g.add(body);
  // head offset keeps the slab bottom above the floor at the lowest slam
  const head = makeBox(bodyW, 1.0, bodyD+0.4, PAL.candyYellow, {rough:0.35});
  head.position.y = -0.35;
  body.add(head);
  const c = deadCollider('crush');
  c._push = 10; c._crush = true; c._cz = z;
  RT.solids.push(c);
  o._saw = function(t){ return Math.abs(((t*spd+phase)%2)-1); };
  RT.anims.push(function(t){
    const saw = o._saw(t);
    const y = 0.5 + saw*3.0;
    body.position.y = y + 0.45;
    c.min.set(x0+0.15, y-0.45, z-bodyD/2-0.2);
    c.max.set(x1-0.15, y+0.45, z+bodyD/2+0.2);
    c._saw = saw;
  });
}

// --- boxing glove punching out of a side wall ---
function buildPuncher(g, L, o){
  const side = o.side||-1, len = o.len||3.4, speed = o.speed||1.2, phase = o.phase||0;
  const z = o.z;
  const [rx0, rx1] = L.road[0][0] < L.road[1][0] ? [L.road[0][0], L.road[1][0]] : [L.road[1][0], L.road[0][0]];
  const wallX = side === -1 ? rx0 : rx1;
  // wall plate
  const plate = makeBox(0.5, 2.2, 1.6, PAL.gunMetal);
  plate.position.set(wallX + side*-0.3, 1.1, z);
  g.add(plate);
  const pivot = new THREE.Group();
  pivot.position.set(wallX, 1.0, z);
  g.add(pivot);
  const armM = makeCyl(0.18, 1, PAL.foamDeep, {metal:0.5, rough:0.35});
  armM.rotation.z = Math.PI/2;
  armM.position.x = 0.5;
  pivot.add(armM);
  const glove = makeBall(0.62, PAL.red, {rough:0.3, emissive:0x551111, ei:0.5});
  glove.position.x = 1.15;
  pivot.add(glove);
  const cuff = makeCyl(0.4, 0.3, PAL.candyWhite);
  cuff.rotation.z = Math.PI/2;
  cuff.position.x = 0.86;
  pivot.add(cuff);
  const c = deadCollider('punch');
  c._side = side;
  RT.solids.push(c);
  RT.anims.push(function(t){
    const cyc = ((t*speed + phase) % 1 + 1) % 1;
    const ext = cyc < 0.42 ? Math.sin(cyc/0.42*Math.PI) : 0;
    const reach = 0.3 + ext*len;
    pivot.scale.x = 1 + ext*len*0.82;
    armM.scale.y = 1 + ext*len*0.82;
    const inner = side === -1 ? wallX + reach : wallX - reach;
    c.min.set(Math.min(wallX, inner), 0.15, z-0.62);
    c.max.set(Math.max(wallX, inner), 1.85, z+0.62);
    c._ext = ext;
    c._vx = (side===-1 ? 1 : -1) * ext;   // punch direction * extension
  });
}

// --- void band (gap to jump; subtracts the road) + bold hazard edges ---
function buildGap(g, L, o){
  const z0 = o.z[0], z1 = o.z[1];
  const x0 = o.x0 !== undefined ? o.x0 : L.road[0][0]-0.6;
  const x1 = o.x1 !== undefined ? o.x1 : L.road[1][0]+0.6;
  RT.voids.push({x0:x0, x1:x1, z0:z0, z1:z1});
  const cx = (x0+x1)/2, w = x1-x0;
  for(let si=0; si<2; si++){
    const zz = si===0 ? z0 : z1;
    const dir = si===0 ? -1 : 1;   // facing the approaching runner
    // wide chevron strip: alternating yellow / dark blocks across the width
    const nBlk = Math.max(4, Math.round(w/1.1));
    for(let bi=0; bi<nBlk; bi++){
      const bw = w/nBlk;
      const blk = makeBox(bw*0.92, 0.1, 0.75,
        bi%2 ? 0x1c1030 : PAL.candyYellow,
        bi%2 ? {rough:0.6} : {rough:0.35, emissive:0x9a7000, ei:1.1});
      blk.position.set(x0 + bw/2 + bi*bw, 0.05, zz + dir*0.5);
      g.add(blk);
    }
    // glowing edge line right at the drop
    const lip = makeBox(w, 0.07, 0.16, PAL.red, {emissive:0xaa2222, ei:1.0, rough:0.3});
    lip.position.set(cx, 0.045, zz + dir*0.09);
    g.add(lip);
  }
  // corner posts at the gap mouth (tall enough to read from a distance)
  for(const sxx of [x0+0.3, x1-0.3]){
    for(const szz of [z0, z1]){
      const post = makeCyl(0.14, 1.5, PAL.candyYellow, {emissive:0x775500, ei:0.7});
      post.position.set(sxx, 0.75, szz);
      g.add(post);
      const cap = makeBall(0.22, PAL.red, {emissive:0xaa2222, ei:0.9});
      cap.position.set(sxx, 1.62, szz);
      g.add(cap);
    }
  }
  // JUMP arrow decal on the approach lane (visible from far away)
  if(typeof document !== 'undefined'){
    const dcnv = document.createElement('canvas');
  dcnv.width = 256; dcnv.height = 256;
  const dctx = dcnv.getContext('2d');
  dctx.fillStyle = 'rgba(255,210,62,0.94)';
  dctx.beginPath();
  if(dctx.roundRect) dctx.roundRect(8, 8, 240, 240, 40); else dctx.rect(8,8,240,240);
  dctx.fill();
  dctx.fillStyle = '#7a1010';
  dctx.font = '900 92px "Segoe UI", sans-serif';
  dctx.textAlign = 'center'; dctx.textBaseline = 'middle';
  dctx.fillText('JUMP', 128, 178);
  dctx.beginPath();
  dctx.moveTo(128, 28); dctx.lineTo(208, 120); dctx.lineTo(158, 120);
  dctx.lineTo(158, 148); dctx.lineTo(98, 148); dctx.lineTo(98, 120);
  dctx.lineTo(48, 120); dctx.closePath();
  dctx.fill();
  const dtex = new THREE.CanvasTexture(dcnv);
  const decal = new THREE.Mesh(_GEO.plane, new THREE.MeshBasicMaterial({map:dtex, transparent:true, depthWrite:false}));
  decal.rotation.set(-Math.PI/2, 0, Math.PI);   // arrow points +z toward the gap
  decal.scale.set(Math.min(3.2, w*0.8), 3.2, 1);
  // pick an approach slot not covered by a boost pad / bounce pad
  const slotBusy = (zz)=>{
    for(const b of RT.boards){
      if(!zz || zz - 1.6 > b.z + (b.hz||1) || zz + 1.6 < b.z - (b.hz||1)) continue;
      if(Math.abs(b.x - cx) < (b.hx||1) + 1.6 && b.y > 0.05) return true;
    }
    return false;
  };
  let dz = null;
  for(const cand of [z0-2.2, z0-3.6, z0-1.4, z0-5.0]){
    if(cand > 1 && !slotBusy(cand)){ dz = cand; break; }
  }
  decal.position.set(cx, 0.025, dz === null ? Math.max(z0-2.2, 1) : dz);
  g.add(decal);
  }
  // water glow panel just under the hole — makes the drop read as WATER even
  // at shallow viewing angles (the road slab hides it from the sides)
  const wcol = L.theme === 'honey' ? 0xffb347 : L.theme === 'canyon' ? 0x53e08c : 0x3fb4ff;
  const glow = new THREE.Mesh(
    _GEO.plane,
    new THREE.MeshBasicMaterial({color:wcol, transparent:true, opacity:0.6, depthWrite:false})
  );
  glow.rotation.x = -Math.PI/2;
  glow.scale.set(w, z1-z0, 1);
  glow.position.set(cx, -1.15, (z0+z1)/2);
  g.add(glow);
  RT.anims.push(function(t){
    glow.material.opacity = 0.5 + 0.14*Math.sin(t*2.6);
  });
}

// --- static platform island ---
function buildPlat(g, L, o){
  const w = o.w||3, d = o.d||3, y = o.y||0;
  const th = 0.55;
  const p = makeBox(w, th, d, PAL.jelly, {rough:0.5, emissive:0x0e3a22, ei:0.35});
  p.position.set(o.x, y - th/2, o.z);
  p.castShadow = true; p.receiveShadow = true;
  g.add(p);
  const rim = makeBox(w*0.9, 0.06, d*0.9, PAL.mint, {emissive:0x1a4433, ei:0.4});
  rim.position.set(o.x, y+0.01, o.z);
  g.add(rim);
  RT.boards.push({x:o.x, z:o.z, hx:w/2, hz:d/2, y:y});
  if(y > 0.4){
    addSolidBox(o.x, y - th/2, o.z, w/2, th/2, d/2, 'platside');
  }
}

// --- moving platform over void (carries the rider) ---
function buildMplat(g, L, o){
  const w = o.w||2.4, d = o.d||2.4, speed = o.speed||2, phase = o.phase||0;
  const axis = o.axis || 'z';
  const m = makeBox(w, 0.45, d, PAL.candyPurple, {rough:0.5, emissive:0x241040, ei:0.5});
  m.castShadow = true;
  g.add(m);
  const cap = makeBox(w*0.8, 0.07, d*0.8, PAL.candyYellow, {emissive:0x554411, ei:0.5});
  const board = {x:0, z:0, hx:w/2, hz:d/2, y:0.35, type:'mplat', _dx:0, _dz:0};
  RT.boards.push(board);
  const yBase = 0.35;
  let a0 = 0, a1 = 0, fixed = 0;
  if(axis === 'z'){ a0 = o.z[0]; a1 = o.z[1]; fixed = o.x; }
  else { a0 = o.x[0]; a1 = o.x[1]; fixed = o.z; }
  RT.anims.push(function(t){
    const per = (a1-a0)/ (speed||1) * 2;
    const u = (Math.sin((t/per + phase)*Math.PI*2)*0.5+0.5);
    const pos = a0 + (a1-a0)*u;
    let nx = fixed, nz = fixed;
    if(axis === 'z'){ nz = pos; } else { nx = pos; }
    board._dx = nx - board.x; board._dz = nz - board.z;
    board.x = nx; board.z = nz;
    m.position.set(nx, yBase-0.225, nz);
    cap.position.set(nx, yBase+0.035, nz);
  });
  g.add(cap);
}

// --- spinning turntable disc (carries you around its center) ---
function buildDisc(g, L, o){
  const r = o.r||2.5, speed = o.speed||1.2;
  const disc = makeCyl(r, 0.3, PAL.trackPurple, {rough:0.5, emissive:0x151044, ei:0.4});
  disc.position.set(o.x, 0.14, o.z);
  disc.castShadow = true; disc.receiveShadow = true;
  g.add(disc);
  const swirl = new THREE.Group();
  swirl.position.set(o.x, 0.30, o.z);
  g.add(swirl);
  for(let i=0;i<4;i++){
    const s = makeBox(r*0.9, 0.04, 0.34, i%2?PAL.candyYellow:PAL.candyPink, {emissive:0x442244, ei:0.5});
    s.position.x = r*0.48;
    const holder = new THREE.Group();
    holder.add(s);
    holder.rotation.y = i*(Math.PI/2);
    swirl.add(holder);
  }
  const cap = makeCyl(0.35, 0.42, PAL.candyWhite, {emissive:0x444444, ei:0.3});
  cap.position.set(o.x, 0.32, o.z);
  g.add(cap);
  RT.boards.push({x:o.x, z:o.z, hx:r, hz:r, y:0.29, type:'disc', cx:o.x, cz:o.z, r:r, omega:speed});
  RT.anims.push(function(t){
    swirl.rotation.y = speed*t;
  });
}

// --- falling-tile bridge (Tip-Toe style): tiles drop after being stepped on ---
function buildTiles(g, L, o){
  const rows = o.rows||4, cols = o.cols||3, cw = o.cw||2.6, cd = o.cd||3.4;
  const z = o.z;
  const totalW = cols*cw;
  const tiles = [];
  for(let ri=0; ri<rows; ri++){
    for(let ci=0; ci<cols; ci++){
      const tx = -totalW/2 + cw/2 + ci*cw;
      const tz = z - (rows-1)*cd/2 + ri*cd;
      const m = makeBox(cw*0.94, 0.26, cd*0.94,
        (ri+ci)%2 ? PAL.candyBlue : PAL.bubblegum,
        {rough:0.5, emissive:0x111144, ei:0.35});
      m.position.set(tx, 0.13, tz);
      m.castShadow = true;
      g.add(m);
      const board = {x:tx, z:tz, hx:cw*0.47, hz:cd*0.47, y:0.26, type:'tile',
        state:'idle', timer:0, mesh:m, _stood:false, fallV:0, fallT:0, respawnT:0};
      RT.boards.push(board);
      tiles.push(board);
    }
  }
  RT.anims.push(function(t, dt){
    dt = dt || 0.016;
    for(const tl of tiles){
      if(tl.state === 'idle'){
        if(tl._stood){
          tl.state = 'armed'; tl.timer = 0.5;
          setEmissive(tl.material, 0x881111);
        }
        tl._stood = false;
      } else if(tl.state === 'armed'){
        tl.timer -= dt;
        tl.mesh.position.x = tl.x + Math.sin(tl.timer*55)*0.05;
        if(tl.timer <= 0){
          tl.state = 'falling'; tl.fallT = 0; tl.fallV = 0;
          tl.disabled = true;
        }
      } else if(tl.state === 'falling'){
        tl.fallT += dt;
        tl.fallV += 22*dt;
        tl.mesh.position.y -= tl.fallV*dt;
        tl.mesh.rotation.x += dt*1.6;
        if(tl.fallT > 1.4){
          tl.state = 'gone'; tl.respawnT = 3.2;
          tl.mesh.visible = false;
        }
      } else if(tl.state === 'gone'){
        tl.respawnT -= dt;
        if(tl.respawnT <= 0){
          tl.state = 'idle'; tl.disabled = false;
          tl.mesh.visible = true;
          tl.mesh.position.set(tl.x, 0.13, tl.z);
          tl.mesh.rotation.x = 0;
          setEmissive(tl.material, 0x111144);
        }
      }
    }
  });
}

// --- updraft fan column (float across the void) ---
function buildFan(g, L, o){
  const r = o.r||1.7, force = o.force||46;
  // rotor below
  const rotor = new THREE.Group();
  rotor.position.set(o.x, -3.2, o.z);
  g.add(rotor);
  const hub = makeCyl(0.3, 0.3, PAL.gunMetal);
  rotor.add(hub);
  for(let i=0;i<3;i++){
    const blade = makeBox(r*1.15, 0.06, 0.5, PAL.foam, {transparent:true, opacity:0.8});
    blade.position.x = r*0.6;
    const holder = new THREE.Group();
    holder.add(blade);
    holder.rotation.y = i*(Math.PI*2/3);
    rotor.add(holder);
  }
  // translucent lift column
  const colGeo = new THREE.CylinderGeometry(r, r*0.85, 7.5, 18, 1, true);
  const col = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({
    color:0x9fe8ff, transparent:true, opacity:0.13, side:THREE.DoubleSide, depthWrite:false
  }));
  col.position.set(o.x, 0.6, o.z);
  g.add(col);
  const ringT = new THREE.Mesh(_GEO.torus, mat(PAL.candyWhite, {emissive:0x668899, ei:0.5}));
  ringT.scale.setScalar(r*1.05);
  ringT.rotation.x = Math.PI/2;
  ringT.position.set(o.x, -2.6, o.z);
  g.add(ringT);
  RT.fans.push({x:o.x, z:o.z, r:r, force:force});
  RT.anims.push(function(t){
    rotor.rotation.y = t*9;
    col.material.opacity = 0.10 + 0.05*Math.sin(t*5);
  });
}

// --- forward boost strip ---
function buildBoost(g, L, o){
  const w = o.w||6, d = o.d||2, push = o.push||5.5;
  const pad = makeBox(w, 0.12, d, PAL.candyOrange, {emissive:0x663300, ei:0.55, rough:0.4});
  pad.position.set(o.x, 0.06, o.z);
  g.add(pad);
  for(let i=0;i<2;i++){
    const chev = makeCone(0.55, 0.8, PAL.candyYellow, {emissive:0x775500, ei:0.7});
    chev.rotation.x = Math.PI/2;
    chev.position.set(o.x, 0.3, o.z - d*0.28 + i*d*0.56);
    g.add(chev);
  }
  RT.boards.push({x:o.x, z:o.z, hx:w/2, hz:d/2, y:0.12, boost:push});
}

// --- solid candy wall (jump / fly over it) ---
function buildWall(g, L, o){
  const w = o.w||8, h = o.h||2.3, d = o.d||0.8;
  const wall = makeBox(w, h, d, PAL.candyDeep, {rough:0.5, emissive:0x33101c, ei:0.4});
  wall.position.set(o.x||0, h/2, o.z);
  wall.castShadow = true;
  g.add(wall);
  const top = makeBox(w*1.05, 0.18, d*1.15, PAL.candyYellow, {emissive:0x554411, ei:0.6});
  top.position.set(o.x||0, h+0.05, o.z);
  g.add(top);
  addSolidBox(o.x||0, h/2, o.z, w/2, h/2, d/2, 'wallblk');
}

// --- narrow band: pinch the road (chicane / balance beam) ---
function buildNarrow(g, L, o){
  const z0 = o.z[0], z1 = o.z[1], bx0 = o.x[0], bx1 = o.x[1];
  RT.narrows.push({z0:z0, z1:z1, x0:bx0, x1:bx1});
  const len = z1 - z0;
  for(let si=0; si<2; si++){
    const edgeX = si===0 ? bx0 : bx1;
    const outerX = si===0 ? L.road[0][0]-0.5 : L.road[1][0]+0.5;
    const wSeg = Math.abs(outerX - edgeX)/1 + 0.3;
    const rail = makeBox(wSeg, 0.9, len, PAL.foam, {transparent:true, opacity:0.5, rough:0.55});
    rail.position.set((edgeX + outerX)/2, 0.45, (z0+z1)/2);
    g.add(rail);
  }
}

// ================= static level pieces =================
function buildPodium(g, L){
  const rb = L.ring[0], rr = L.ring[1];
  const beam = makeBox(5.6, 0.35, 1.1, PAL.candyYellow, {emissive:0x574200, ei:0.7});
  beam.position.set(L.beam[0], 0.18, L.beam[2]);
  g.add(beam);
  // NOTE: no solid collider on the finish beam — it must never block the
  // crossing (bots & players step onto it via its standable board below)
  RT.boards.push({x:L.beam[0], z:L.beam[2], hx:2.8, hz:0.55, y:0.35});
  // finish arch
  for(let si=0; si<2; si++){
    const s = si===0?-1:1;
    const pole = makeCyl(0.16, 6.2, PAL.candyWhite);
    pole.position.set(rb[0]+s*3.1, 3.1, rb[2]);
    g.add(pole);
    const ball = makeBall(0.42, PAL.candyPink, {emissive:0x441122, ei:0.5});
    ball.position.set(rb[0]+s*3.1, 6.4, rb[2]);
    g.add(ball);
  }
  const banner = makeBox(6.8, 1.0, 0.3, PAL.candyPink, {emissive:0x551133, ei:0.55});
  banner.position.set(rb[0], 6.0, rb[2]);
  g.add(banner);
  const ring = new THREE.Mesh(_GEO.torus, mat(PAL.candyWhite,{emissive:0x776644, ei:0.4}));
  ring.scale.setScalar(rr);
  ring.rotation.x = Math.PI/2;
  ring.position.set(rb[0], rb[1]-0.35, rb[2]);
  g.add(ring);
  // start gate
  for(let si=0; si<2; si++){
    const s = si===0?-1:1;
    const pole = makeCyl(0.14, 5.2, PAL.candyBlue);
    pole.position.set(s*3.4, 2.6, 4);
    g.add(pole);
  }
  const sbanner = makeBox(7.4, 0.9, 0.28, PAL.candyBlue, {emissive:0x113366, ei:0.55});
  sbanner.position.set(0, 5.0, 4);
  g.add(sbanner);
}

function buildCoins(g, L){
  for(let i=0;i<L.coins.length;i++){
    const cc = L.coins[i];
    const coin = new THREE.Mesh(_GEO.torus, mat(PAL.candyYellow,{emissive:0x7a5800, ei:0.9, metal:0.35, rough:0.25}));
    coin.scale.setScalar(0.32);
    coin.position.set(cc[0], cc[1], cc[2]);
    g.add(coin);
    RT.collectors.push({mesh:coin, x:cc[0], y:cc[1], z:cc[2], got:false, idx:i});
  }
}

function mulberry(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a>>>15, 1 | a);
    t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t;
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  };
}

// ---- per-theme decorations ----
function foamRailsAndClouds(g, L, rnd, cloudColor, cloudN){
  const x0 = L.road[0][0], x1 = L.road[1][0], z1 = L.road[1][1];
  for(let si=0; si<2; si++){
    const side = si===0?-1:1;
    const railX = side===-1 ? x0-0.62 : x1+0.62;
    const rail = makeBox(0.75, 0.75, z1+9, PAL.foam, {rough:0.55, transparent:true, opacity:0.5});
    rail.position.set(railX, 0.62, z1/2-4);
    g.add(rail);
  }
  for(let i=0;i<cloudN;i++){
    const cl = new THREE.Group();
    const nb = 2 + Math.floor(rnd()*3);
    for(let j=0;j<nb;j++){
      const b = makeBall(0.8+rnd()*1.1, cloudColor, {rough:0.9, transparent:true, opacity:0.75});
      b.position.set((rnd()-0.5)*2.8, (rnd()-0.5)*0.6, (rnd()-0.5)*2.0);
      cl.add(b);
    }
    const cy = 11 + rnd()*10;
    const cz = rnd()*z1*1.1 - 3;
    const cx0 = (rnd()-0.5)*46;
    cl.position.set(cx0, cy, cz);
    g.add(cl);
    const sp = 0.25 + rnd()*0.35;
    const dirx = rnd()<0.5?-1:1;
    RT.anims.push(function(t, dt){
      cl.position.x += dirx*sp*(dt||0.016);
      if(cl.position.x > 30) cl.position.x = -30;
      if(cl.position.x < -30) cl.position.x = 30;
    });
  }
}

function decorateStreet(g, L){
  const rnd = mulberry(11);
  foamRailsAndClouds(g, L, rnd, PAL.foam, 10);
  const x0 = L.road[0][0], x1 = L.road[1][0], z1 = L.road[1][1];
  const candyColors = [PAL.candyPink, PAL.candyBlue, PAL.candyGreen, PAL.candyPurple, PAL.candyOrange];
  for(let z=3; z<z1+5; z+=9){
    for(let si=0; si<2; si++){
      const side = si===0?-1:1;
      const h = 1.6 + rnd()*1.8;
      const rr = 0.5 + rnd()*0.55;
      const x = side===-1 ? x0-2.0-rnd()*2.4 : x1+2.0+rnd()*2.4;
      const zz = z + rnd()*2.5;
      const stick = makeCyl(0.07, h, PAL.candyWhite);
      stick.position.set(x, h/2, zz);
      g.add(stick);
      const head = makeBall(rr, candyColors[Math.floor(rnd()*candyColors.length)], {rough:0.32, emissive:0x221033, ei:0.3});
      head.scale.y = rr*1.12;
      head.position.set(x, h + rr*1.05, zz);
      g.add(head);
    }
  }
}

function decorateFactory(g, L){
  const rnd = mulberry(23);
  foamRailsAndClouds(g, L, rnd, PAL.foamDeep, 6);
  const x0 = L.road[0][0], x1 = L.road[1][0], z1 = L.road[1][1];
  for(let z=4; z<z1; z+=11){
    for(let si=0; si<2; si++){
      const side = si===0?-1:1;
      const x = side===-1 ? x0-1.6-rnd()*1.6 : x1+1.6+rnd()*1.6;
      // pipe stack
      const h = 2.2 + rnd()*2.5;
      const pipe = makeCyl(0.45+rnd()*0.3, h, PAL.gunMetal, {metal:0.4, rough:0.5});
      pipe.position.set(x, h/2, z);
      g.add(pipe);
      const capC = makeCyl(0.55+rnd()*0.3, 0.3, PAL.candyBlue, {emissive:0x113355, ei:0.4});
      capC.position.set(x, h+0.15, z);
      g.add(capC);
      // gear
      if(rnd() < 0.6){
        const gear = new THREE.Mesh(_GEO.torus, mat(PAL.candyYellow, {metal:0.5, rough:0.4}));
        gear.scale.setScalar(0.8+rnd()*0.5);
        gear.position.set(x - side*0.9, 2.6+rnd()*1.5, z+rnd()*3-1.5);
        g.add(gear);
        const spin = 0.4 + gear.scale.x*0.4;
        RT.anims.push(function(t){ gear.rotation.z = t*spin; });
      }
    }
  }
  // floating bubbles
  const bubbles = [];
  for(let i=0;i<12;i++){
    const b = makeBall(0.25+rnd()*0.5, PAL.foam, {transparent:true, opacity:0.4, rough:0.1});
    b.position.set((rnd()-0.5)*(x1-x0), rnd()*3, rnd()*z1);
    g.add(b);
    bubbles.push({m:b, vy:0.4+rnd()*0.6, wob:rnd()*6});
  }
  RT.anims.push(function(t, dt){
    for(const bb of bubbles){
      bb.m.position.y += bb.vy*(dt||0.016);
      bb.m.position.x += Math.sin(t*2+bb.wob)*0.004;
      if(bb.m.position.y > 5){ bb.m.position.y = 0.2; }
    }
  });
}

function decorateCanyon(g, L){
  const rnd = mulberry(37);
  foamRailsAndClouds(g, L, rnd, PAL.foam, 8);
  const x0 = L.road[0][0], x1 = L.road[1][0], z1 = L.road[1][1];
  // mesa rocks + candy crystals
  for(let z=2; z<z1+6; z+=8){
    for(let si=0; si<2; si++){
      const side = si===0?-1:1;
      const x = side===-1 ? x0-2.2-rnd()*3 : x1+2.2+rnd()*3;
      const h = 2 + rnd()*4;
      const rock = makeBox(1.6+rnd()*2, h, 1.6+rnd()*2, PAL.jellyDeep, {rough:0.85});
      rock.position.set(x, h/2-0.5, z+rnd()*4);
      rock.rotation.y = rnd()*0.8;
      g.add(rock);
      if(rnd() < 0.5){
        const cr = makeCone(0.3+rnd()*0.3, 1.2+rnd()*1.4, PAL.mint, {emissive:0x1a5544, ei:0.5, transparent:true, opacity:0.85});
        cr.position.set(x+rnd()*1.4-0.7, h-0.4, z+rnd()*2);
        cr.rotation.z = (rnd()-0.5)*0.5;
        g.add(cr);
      }
    }
  }
}

function decorateHoney(g, L){
  const rnd = mulberry(53);
  foamRailsAndClouds(g, L, rnd, 0xffe0b0, 7);
  const x0 = L.road[0][0], x1 = L.road[1][0], z1 = L.road[1][1];
  for(let z=3; z<z1+6; z+=8.5){
    for(let si=0; si<2; si++){
      const side = si===0?-1:1;
      const x = side===-1 ? x0-2.0-rnd()*2 : x1+2.0+rnd()*2;
      // honeycomb cell (hex cylinder)
      const h = 1.8 + rnd()*2.2;
      const cell = new THREE.Mesh(_GEO.hex, mat(PAL.honey, {rough:0.3, emissive:0x442200, ei:0.35}));
      cell.rotation.x = Math.PI/2;
      cell.position.set(x, h, z+rnd()*3);
      g.add(cell);
      const drip = makeCyl(0.1, 0.8+rnd(), PAL.honey, {transparent:true, opacity:0.8});
      drip.position.set(x, h-1.0, z+rnd()*3);
      g.add(drip);
    }
  }
}

function decorateStorm(g, L){
  const rnd = mulberry(71);
  foamRailsAndClouds(g, L, rnd, PAL.stormGray, 14);
  const x0 = L.road[0][0], x1 = L.road[1][0], z1 = L.road[1][1];
  for(let z=2; z<z1+6; z+=10){
    for(let si=0; si<2; si++){
      const side = si===0?-1:1;
      const x = side===-1 ? x0-2.4-rnd()*3 : x1+2.4+rnd()*3;
      const h = 1.5+rnd()*3;
      const spike = makeCone(0.5+rnd()*0.5, h, PAL.trackPurple, {rough:0.6, emissive:0x1a1044, ei:0.4});
      spike.position.set(x, h/2, z+rnd()*4);
      g.add(spike);
    }
  }
}

function decorate(g, L){
  switch(L.theme){
    case 'factory': decorateFactory(g, L); break;
    case 'canyon': decorateCanyon(g, L); break;
    case 'honey': decorateHoney(g, L); break;
    case 'storm': decorateStorm(g, L); break;
    default: decorateStreet(g, L);
  }
}

// ================= main builder =================
// merged void z-bands from the level's gap obstacles (used to CUT the road
// slab, stripes and rails so holes are actually visible from above)
function voidBands(L){
  const bands = [];
  for(const o of L.obstacles){ if(o.k === 'gap') bands.push([o.z[0], o.z[1]]); }
  bands.sort((a,b)=>a[0]-b[0]);
  const merged = [];
  for(const b of bands){
    if(merged.length && b[0] <= merged[merged.length-1][1] + 0.01)
      merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], b[1]);
    else merged.push(b.slice());
  }
  return merged;
}

function buildLevel(index){
  const L = window.LEVELS[index];
  resetRuntime();
  const g = new THREE.Group();

  const x0 = L.road[0][0], x1 = L.road[1][0], z1 = L.road[1][1];
  const wRoad = x1 - x0;
  const bands = voidBands(L);
  const inBand = (z, m)=> bands.some(b=> z >= b[0]-m && z <= b[1]+m);

  // walkable z segments: everything except void bands
  const segs = [];
  {
    let cur = -6;
    for(const b of bands){ if(b[0] > cur) segs.push([cur, b[0]]); cur = Math.max(cur, b[1]); }
    if(cur < z1+6) segs.push([cur, z1+6]);
  }

  // road material
  const slabMat = L.theme==='honey' ? mat(PAL.honeyDeep,{rough:0.5,emissive:0x332200,ei:0.3})
    : L.theme==='storm' ? mat(PAL.trackPurple,{rough:0.55,emissive:0x140a2e,ei:0.3})
    : L.theme==='canyon' ? mat(0x3e6e58,{rough:0.7,emissive:0x0a2018,ei:0.25})
    : mat(PAL.trackBlue,{rough:0.55,emissive:0x0a1040,ei:0.32});

  // road slab SEGMENTS (holes at voids so the water below is visible)
  for(const sg of segs){
    const len = sg[1]-sg[0];
    if(len <= 0.05) continue;
    const roadSlab = new THREE.Mesh(_GEO.box, slabMat);
    roadSlab.scale.set(wRoad+1.7, 1.0, len);
    roadSlab.position.set((x0+x1)/2, -0.5, (sg[0]+sg[1])/2);
    roadSlab.receiveShadow = true;
    g.add(roadSlab);
    // dark cliff rim at each cut edge (makes the drop read clearly)
    for(const ez of sg){
      if(ez <= -5.9 || ez >= z1+5.9) continue;
      const rim = makeBox(wRoad+1.7, 1.04, 0.18, 0x1a1030, {rough:0.9});
      rim.position.set((x0+x1)/2, -0.5, ez);
      g.add(rim);
    }
  }

  // subtle center lane stripes (skip voids)
  const stripes = Math.ceil(z1/2);
  for(let i=0;i<stripes;i++){
    const zs = i*2+1;
    if(inBand(zs, 0.3)) continue;
    const s = makeBox(wRoad*0.42, 0.026, 0.5, i%2?PAL.candyPink:PAL.candyBlue, {rough:0.65, emissive:0x120a26, ei:0.28});
    s.position.set((x0+x1)/2, 0.015, zs);
    g.add(s);
  }

  // spawn pad
  const spawnPad = makeBox(6.4, 0.22, 2.8, PAL.candyWhite, {emissive:0x514733, ei:0.4});
  spawnPad.position.set(L.spawn[0], 0.11, L.spawn[2]-1.6);
  g.add(spawnPad);

  // end walls (back + far past finish); sides are handled by roadXAt clamp
  addSolidBox(0, 2.0, -3.4, wRoad/2+2.0, 4.0, 0.45, 'wall');
  addSolidBox(0, 2.0, z1+5.4, wRoad/2+2.0, 4.0, 0.45, 'wall');

  // side foam rails per SEGMENT (they stop at holes, so gaps stay obvious)
  for(const sg of segs){
    const len = sg[1]-sg[0];
    if(len <= 0.4) continue;
    for(let si=0; si<2; si++){
      const side = si===0?-1:1;
      const railX = side===-1 ? x0-0.62 : x1+0.62;
      const rail = makeBox(0.75, 0.75, len, PAL.foam, {rough:0.55, transparent:true, opacity:0.5});
      rail.position.set(railX, 0.62, (sg[0]+sg[1])/2);
      g.add(rail);
    }
  }
  // translucent side walls (visual only, full length)
  for(let si=0; si<2; si++){
    const side = si===0?-1:1;
    const wall = makeBox(0.9, 4.0, z1+17, PAL.candyDeep, {rough:0.5, transparent:true, opacity:0.14});
    wall.position.set(side===-1?x0-0.85:x1+0.85, 2.0, z1/2-4);
    g.add(wall);
  }

  buildPodium(g, L);
  buildCoins(g, L);
  decorate(g, L);

  for(let i=0;i<L.obstacles.length;i++){
    const o = L.obstacles[i];
    switch(o.k){
      case 'mill': buildMill(g,L,o); break;
      case 'roller': buildRoller(g,L,o); break;
      case 'elevator': buildElevator(g,L,o); break;
      case 'bounce': buildBounce(g,L,o); break;
      case 'belt': buildBelt(g,L,o); break;
      case 'bumper': buildBumper(g,L,o); break;
      case 'honey': buildHoney(g,L,o); break;
      case 'rotator': buildRotator(g,L,o); break;
      case 'pendulum': buildPendulum(g,L,o); break;
      case 'crusher': buildCrusher(g,L,o); break;
      case 'puncher': buildPuncher(g,L,o); break;
      case 'gap': buildGap(g,L,o); break;
      case 'plat': buildPlat(g,L,o); break;
      case 'mplat': buildMplat(g,L,o); break;
      case 'disc': buildDisc(g,L,o); break;
      case 'tiles': buildTiles(g,L,o); break;
      case 'fan': buildFan(g,L,o); break;
      case 'boost': buildBoost(g,L,o); break;
      case 'narrow': buildNarrow(g,L,o); break;
      case 'wall': buildWall(g,L,o); break;
      default: console.warn('unknown obstacle kind', o.k);
    }
  }

  RT.group = g;
  window._currentLevel = L;
  return {group:g, mode:'road'};
}

// ---------- per-frame updates ----------
function updateObstacles(t, dt){
  for(let i=0;i<RT.anims.length;i++) RT.anims[i](t, dt);
  for(let i=0;i<RT.collectors.length;i++){
    const cc = RT.collectors[i];
    if(cc.got) continue;
    cc.mesh.rotation.y += 0.035;
    cc.mesh.position.y = cc.y + 0.15*Math.sin(t*2.2 + i);
  }
}

// ---------- spatial queries ----------
function roadXAt(z){
  const L = window._currentLevel;
  let bx0 = L.road[0][0], bx1 = L.road[1][0];
  for(let i=0;i<RT.narrows.length;i++){
    const n = RT.narrows[i];
    if(z >= n.z0 && z <= n.z1){
      bx0 = Math.max(bx0, n.x0);
      bx1 = Math.min(bx1, n.x1);
    }
  }
  return [bx0, bx1];
}
function voidAt(px, pz){
  for(let i=0;i<RT.voids.length;i++){
    const v = RT.voids[i];
    if(px >= v.x0 && px <= v.x1 && pz >= v.z0 && pz <= v.z1) return true;
  }
  return false;
}
// Highest standable surface at or below feetY+STEP_UP. Returns {y, board}.
function groundAt(px, pz, feetY){
  if(feetY === undefined) feetY = 1e9;
  let best = -Infinity, bestB = null;
  const [rx0, rx1] = roadXAt(pz);
  if(px >= rx0-0.3 && px <= rx1+0.3 && !voidAt(px, pz) && 0 <= feetY + STEP_UP){
    best = 0;
  }
  const lim = feetY + STEP_UP;
  for(let i=0;i<RT.boards.length;i++){
    const b = RT.boards[i];
    if(b.disabled) continue;
    if(b.type === 'disc'){
      const dx = px-b.cx, dz = pz-b.cz;
      if(dx*dx+dz*dz <= b.r*b.r && b.y <= lim && b.y > best){ best = b.y; bestB = b; }
    } else {
      if(px >= b.x-b.hx-0.12 && px <= b.x+b.hx+0.12 && pz >= b.z-b.hz-0.12 && pz <= b.z+b.hz+0.12 &&
         b.y <= lim && b.y > best){ best = b.y; bestB = b; }
    }
  }
  return {y:best, board:bestB};
}
function effectiveSurfaceY(px, pz){
  return groundAt(px, pz, 1e9).y;
}
function glueAt(px, pz){
  for(let i=0;i<RT.boards.length;i++){
    const b = RT.boards[i];
    if(b.glue && px>=b.x-b.hx && px<=b.x+b.hx && pz>=b.z-b.hz && pz<=b.z+b.hz) return b.glue;
  }
  return 1;
}
function beltAt(px, pz){
  for(let i=0;i<RT.boards.length;i++){
    const b = RT.boards[i];
    if(b.belt && px>=b.x-b.hx && px<=b.x+b.hx && pz>=b.z-b.hz && pz<=b.z+b.hz) return b.belt;
  }
  return 0;
}
function fanAt(px, pz){
  for(let i=0;i<RT.fans.length;i++){
    const f = RT.fans[i];
    const dx = px-f.x, dz = pz-f.z;
    if(dx*dx+dz*dz <= f.r*f.r) return f;
  }
  return null;
}

window.ThemeAPI = {buildLevel, updateObstacles, groundAt, effectiveSurfaceY,
  roadXAt, voidAt, glueAt, beltAt, fanAt, PAL, RT, STEP_UP};
})();
