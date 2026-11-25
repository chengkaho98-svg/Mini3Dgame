// Level data test (Node, no browser): every level's data is well-formed and
// describes a track that can actually be built and crossed.
//   node tests/levels.test.js   (or: npm test)
'use strict';
const assert = require('assert');
let fails = 0;
const check = (cond, msg) => { if(!cond){ fails++; console.error('  FAIL: ' + msg); } };

// --- static data checks (no THREE needed) --------------------------------
global.window = {};                       // levels.js / build.js are browser scripts
require('../levels.js');
const LV = global.window.LEVELS;
check(LV.length === 5, 'five levels');

const KINDS = {
  mill: ['x','z','r'], roller: ['z'], elevator: ['x','z'], bounce: ['x','z'], belt: ['x','z'],
  bumper: ['x','z'], honey: ['x','z'], rotator: ['x','z'], pendulum: ['x','z'], crusher: ['x','z'],
  puncher: ['side','z'], gap: ['z'], plat: ['x','z'], mplat: ['x'], disc: ['x','z'], tiles: ['z'],
  fan: ['x','z'], boost: ['x','z'], narrow: ['z','x'], wall: ['z']
};
const finite = v => typeof v === 'number' && Number.isFinite(v);
function walk(v, path, out){
  if(typeof v === 'number'){ if(!Number.isFinite(v)) out.push(path); return; }
  if(v && typeof v === 'object') for(const k of Object.keys(v)) walk(v[k], path + '.' + k, out);
}
const isIsland = o => ['plat','mplat','disc','tiles','bounce','elevator','fan','gap','boost'].includes(o.k);
const halfX = o => o.k === 'disc' ? o.r : o.k === 'tiles' ? (o.cols||3)*(o.cw||2.6)/2 : o.k === 'crusher' ? 0 : o.k === 'puncher' ? 0 : o.k === 'mill' || o.k === 'rotator' ? o.r : o.k === 'belt' ? (o.w||5)/2 : o.k === 'boost' ? (o.w||6)/2 : o.k === 'bounce' ? (o.r||1.2) : o.k === 'narrow' ? 0 : o.w !== undefined ? o.w/2 : o.r || 1.0;
const zRange = o => {
  if(o.k === 'gap' || o.k === 'narrow') return o.z;
  if(o.k === 'mplat') return o.axis === 'x' ? [o.z - (o.d||2.4)/2, o.z + (o.d||2.4)/2] : [o.z[0] - (o.d||2.4)/2, o.z[1] + (o.d||2.4)/2];
  if(o.k === 'tiles') return [o.z - (o.rows||4)*(o.cd||3.4)/2, o.z + (o.rows||4)*(o.cd||3.4)/2];
  if(o.k === 'crusher') return [o.z - 1.35, o.z + 1.35];
  return [o.z - (o.r || o.d || (o.k === 'belt' ? o.L : 1))/2, o.z + (o.r || o.d || (o.k === 'belt' ? o.L : 1))/2];
};

for(let li = 0; li < LV.length; li++){
  const L = LV[li], tag = 'L' + (li + 1) + ' ';
  const bad = [];
  walk(L, 'level', bad);
  check(bad.length === 0, tag + 'no NaN/Infinity in the data ' + bad[0]);
  check(finite(L.time) && L.time > 60, tag + 'time limit is a sane number');
  check(L.name && L.nameEn && L.theme, tag + 'name / English name / theme present');
  check(Array.isArray(L.road) && L.road[0][0] < 0 && L.road[1][0] > 0 && L.road[1][1] > 100, tag + 'road runs from 0 to its length and is centred on x = 0');
  check(L.spawn[2] >= 0 && L.spawn[2] < 10 && L.ring[0][2] > L.road[1][1] - 5, tag + 'spawn at the start, finish line at the end');
  check(Math.abs(L.ring[0][2] - L.beam[2] - 0.1) < 1e-6, tag + 'finish line sits just past the finish beam');
  check(Array.isArray(L.hints) && L.hints.length >= 4, tag + 'has gameplay hints');
  for(let i = 1; i < L.hints.length; i++) check(L.hints[i].z[0] >= L.hints[i-1].z[0], tag + 'hints are in track order');

  const gaps = L.obstacles.filter(o => o.k === 'gap');
  for(const o of L.obstacles){
    const need = KINDS[o.k];
    check(!!need, tag + 'known obstacle kind "' + o.k + '"');
    if(!need) continue;
    for(const k of need) check(o[k] !== undefined, tag + o.k + ' at z=' + o.z + ' is missing "' + k + '"');
    const [z0, z1] = zRange(o);
    check(z1 > z0 && z0 >= -1 && z1 <= L.road[1][1] + 6, tag + o.k + ' at z=' + o.z + ' lies on the track');
    if(o.k !== 'roller' && o.k !== 'puncher' && o.k !== 'gap' && o.k !== 'narrow' && o.k !== 'crusher'){
      const hx = halfX(o), cx = o.x || 0;
      check(cx - hx >= L.road[0][0] - 0.05 && cx + hx <= L.road[1][0] + 0.05,
        tag + o.k + ' at z=' + o.z + ' fits across the road (x ' + (cx - hx).toFixed(2) + '..' + (cx + hx).toFixed(2) + ', road ' + L.road[0][0] + '..' + L.road[1][0] + ')');
    }
    // nothing that is not an island may sit over a hole
    if(!isIsland(o)){
      for(const g of gaps){
        check(z1 <= g.z[0] + 0.01 || z0 >= g.z[1] - 0.01, tag + o.k + ' at z=' + o.z + ' sits over the gap ' + g.z.join('..'));
      }
    }
  }
  // each gap is served by something that gets you across (smoke-tested for real
  // by geometry.test.js; here only that the data has a crossing aid nearby)
  for(const g of gaps){
    const served = L.obstacles.some(o => o !== g && isIsland(o) && o.k !== 'gap' && zRange(o)[1] > g.z[0] - 5 && zRange(o)[0] < g.z[1] + 5) ||
      (g.z[1] - g.z[0]) <= 2.6;
    check(served, tag + 'gap ' + g.z.join('..') + ' is jumpable or has a crossing aid');
  }
  check(Array.isArray(L.coins) && L.coins.length >= 10, tag + 'has coins');
  for(const c of L.coins){
    check(c.length === 3 && c.every(finite), tag + 'coin [x,y,z] with numbers');
    check(c[2] > L.spawn[2] && c[2] < L.ring[0][2], tag + 'coin z=' + c[2] + ' is between start and finish');
  }
}

// --- built checks (THREE stub) -------------------------------------------
const mkGroup = () => ({ children: [], position: { set(){}, setScalar(){}, copy(){} }, rotation: { x:0, y:0, z:0 },
  scale: { x:1, y:1, z:1, set(){}, setScalar(){}, copy(){} }, add(){}, visible: true, castShadow: false, receiveShadow: false, material: null, isMesh: false });
class V3 { constructor(x,y,z){ this.x=x||0; this.y=y||0; this.z=z||0; } copy(v){ this.x=v.x; this.y=v.y; this.z=v.z; return this; } set(x,y,z){ this.x=x; this.y=y||0; this.z=z||0; return this; } }
class StubMat { constructor(o){ this.color = o && o.color; this.emissive = 0; } clone(){ return new StubMat(this); } dispose(){} }
class StubGeo { dispose(){} }
global.window.THREE = { Group: function(){ return mkGroup(); }, BoxGeometry: StubGeo, SphereGeometry: StubGeo, CylinderGeometry: StubGeo, ConeGeometry: StubGeo,
  TorusGeometry: StubGeo, PlaneGeometry: StubGeo, MeshStandardMaterial: StubMat, MeshPhysicalMaterial: StubMat, MeshBasicMaterial: StubMat,
  Mesh: function(g,m){ const o = mkGroup(); o.material = m || null; return o; }, Sprite: mkGroup, Vector3: V3 };
require('../build.js');
const API = global.window.ThemeAPI, RT = global.window._RT;
for(let li = 0; li < LV.length; li++){
  const L = LV[li], tag = 'L' + (li + 1) + ' ';
  API.buildLevel(li);
  // every standable board that is not an island sits across the road
  let outside = 0;
  for(const b of RT.boards){
    if(b.type === 'disc' || b.type === 'mplat' || b.type === 'elev' || b.type === 'tile') continue;
    if(b.x - (b.hx||0) < L.road[0][0] - 0.3 || b.x + (b.hx||0) > L.road[1][0] + 0.3) outside++;
  }
  check(outside === 0, tag + outside + ' standable surface(s) stick out past the road');
  check(RT.solids.length > 0 && RT.anims.length > 0, tag + 'builds colliders and animations');
}

console.log(fails ? 'FAILURES: ' + fails : 'LEVEL DATA ALL GOOD');
process.exit(fails ? 1 : 0);
