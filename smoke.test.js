// Smoke test: load levels.js + build.js under a minimal THREE stub in Node,
// build all 5 levels, animate 10s, and validate the track geometry.
function mkGroup(){
  return {
    children:[],
    position:{x:0,y:0,z:0,set(){},setScalar(){},copy(){}},
    rotation:{x:0,y:0,z:0},
    scale:{x:1,y:1,z:1,set(){},setScalar(){},copy(){}},
    add(){}, visible:true, castShadow:false, receiveShadow:false,
    material:null, isMesh:false, isSprite:false, isPoints:false
  };
}
class V3 {
  constructor(x,y,z){ this.x=x||0; this.y=y||0; this.z=z||0; }
  copy(v){ this.x=v.x; this.y=v.y; this.z=v.z; return this; }
  set(x,y,z){ this.x=x; this.y=y||0; this.z=z||0; return this; }
}
global.window = {
  THREE: {
    Group: mkGroup,
    BoxGeometry: function(){}, SphereGeometry: function(){},
    CylinderGeometry: function(){}, ConeGeometry: function(){},
    TorusGeometry: function(){}, PlaneGeometry: function(){},
    MeshStandardMaterial: function(o){ this.color=o&&o.color; this.emissive=0; },
    MeshBasicMaterial: function(o){ this.color=o&&o.color; },
    Mesh: function(g,m){ const o = mkGroup(); o.material = m || null; return o; },
    Sprite: function(){ return mkGroup(); },
    Vector3: V3
  }
};
require('./levels.js');
require('./build.js');
const API = window.ThemeAPI;
console.log('ThemeAPI keys:', Object.keys(API).join(','));
let fails = 0;
const ok = (cond, msg) => { if(!cond){ fails++; console.error('  FAIL:', msg); } };

for(let li=0; li<window.LEVELS.length; li++){
  const L = window.LEVELS[li];
  const res = API.buildLevel(li);
  console.log('L'+(li+1), L.name, '| len', L.road[1][1], '| obstacles', L.obstacles.length,
    '| solids', window._RT.solids.length, '| boards', window._RT.boards.length,
    '| voids', window._RT.voids.length);
  // animate 10s
  for(let t=0;t<10;t+=1/60) API.updateObstacles(t, 1/60);
  // no NaN colliders
  for(const c of window._RT.solids){
    if(isNaN(c.min.x+c.min.y+c.min.z+c.max.x+c.max.y+c.max.z)){
      fails++; console.error('  FAIL: NaN collider tag='+c.tag); break;
    }
  }
  // ground queries
  ok(API.effectiveSurfaceY(0, L.spawn[2]) === 0, 'spawn ground = 0');
  const g0 = API.groundAt(0, L.spawn[2], 0);
  ok(g0.y === 0, 'groundAt feetY=0 at spawn -> 0, got '+g0.y);
  // first gap is registered as a void rect
  const gap = L.obstacles.find(o=>o.k==='gap');
  if(gap){
    const zm = (gap.z[0]+gap.z[1])/2;
    ok(API.voidAt(0, zm), 'gap z='+zm+' registered as void');
  }
  // walkability: void RUNS between standable slices must be jumpable/boostable
  // (<=5.6m) — moving platforms count across their whole travel band.
  const mplatBands = (L.obstacles||[]).filter(o=>o.k==='mplat'||o.k==='elevator').map(o=>{
    if(o.k==='elevator'){
      const w = o.w||2.2, d = o.d||2.8;
      return {x0:o.x-w/2-0.3, x1:o.x+w/2+0.3, z0:o.z-d/2-0.3, z1:o.z+d/2+0.3};
    }
    const w = o.w||2.4, d = o.d||2.4;
    if((o.axis||'z') === 'z') return {x0:o.x-w/2-0.9, x1:o.x+w/2+0.9, z0:o.z[0]-d/2-0.3, z1:o.z[1]+d/2+0.3};
    return {x0:o.x[0]-w/2-0.3, x1:o.x[1]+w/2+0.3, z0:o.z-d/2-0.9, z1:o.z+d/2+0.9};
  });
  const standable = (x, z) => {
    // landing surfaces count at any height a jump/bounce can reach (2.4m)
    if(API.groundAt(x, z, 2.4).y > -1) return true;
    if(API.fanAt(x, z)) return true;
    for(const b of mplatBands) if(x>=b.x0 && x<=b.x1 && z>=b.z0 && z<=b.z1) return true;
    return false;
  };
  let maxRun = 0, runStart = 0, runZ = 0;
  let inRun = false;
  for(let z=1; z<L.ring[0][2]; z+=0.25){
    const [rx0, rx1] = API.roadXAt(z);
    let found = false;
    for(let x=rx0; x<=rx1 && !found; x+=0.35) if(standable(x, z)) found = true;
    if(!found){
      if(!inRun){ inRun = true; runStart = z; }
      runZ = z;
    } else if(inRun){
      inRun = false;
      maxRun = Math.max(maxRun, runZ - runStart + 0.25);
    }
  }
  if(inRun) maxRun = Math.max(maxRun, runZ - runStart + 0.25);
  ok(maxRun <= 5.6, 'max void run ' + maxRun.toFixed(2) + 'm (jump/boost limit 5.6m)');
  // narrow band check (L3)
  if(L.obstacles.some(o=>o.k==='narrow')){
    const n = L.obstacles.find(o=>o.k==='narrow');
    const [bx0, bx1] = API.roadXAt((n.z[0]+n.z[1])/2);
    ok(bx1-bx0 < (L.road[1][0]-L.road[0][0])-1, 'narrow band pinches road');
  }
}
console.log(fails ? ('FAILURES: '+fails) : 'ALL GOOD');
process.exit(fails ? 1 : 0);
