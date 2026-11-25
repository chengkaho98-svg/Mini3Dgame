// ================= SUGAR RUSH ROYALE — tests/suites.js =================
// Browser regression suites. index.html?test=1 boots the game without WebGL
// (S.testMode) and loads this file; the suites then drive the REAL game
// through window._DBG (start races, fast-forward the simulation, move racers).
// Run them with `npm test` (tests/run.js opens a headless browser) or open
// http://127.0.0.1:8077/index.html?test=1 and read window.SRR_TEST.report().
//
// Conventions: every assertion says what a player would see when it fails.
// Budgets are deliberately loose — they are tripwires for regressions like
// "every bot falls at the same spot", not a tuning reference.
(function(){
'use strict';
const T = { suites: [], results: [], running: false, done: false, error: null, progress: '' };
window.SRR_TEST = T;
T.suite = function(name, fn){ T.suites.push({ name, fn }); };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIXED = 1/120;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- toolkit handed to every suite ----------
function toolkit(){
  const D = window._DBG, A = window.ThemeAPI, LV = window.LEVELS, T3 = window.THREE;
  const t = {
    D, A, LV, T3,
    results: [],
    ok(cond, msg, detail){
      t.results.push({ status: cond ? 'pass' : 'fail', msg, detail: detail === undefined ? '' : String(detail) });
      return !!cond;
    },
    eq(got, want, msg){ return t.ok(Object.is(got, want), msg, 'got ' + got + ', want ' + want); },
    log(msg){ t.results.push({ status: 'pass', msg, detail: '' }); },
    near(got, want, tol, msg){ return t.ok(Math.abs(got - want) <= tol, msg, 'got ' + (+got).toFixed(3) + ', want ' + want + ' ±' + tol); },
    between(got, lo, hi, msg){ return t.ok(got >= lo && got <= hi, msg, 'got ' + (+got).toFixed(3) + ', want ' + lo + '..' + hi); },
    sleep,
    // fast-forward `sec` of race time in small chunks, yielding to the page
    async step(sec){
      let left = sec;
      while(left > 1e-9){
        const s = Math.min(1.5, left);
        D.advance(s); left -= s;
        await sleep(0);
      }
    },
    // fast-forward with a callback before every physics step (precise input)
    async steps(sec, each){
      const n = Math.round(sec / FIXED);
      for(let i = 0; i < n; i++){
        if(each) each(i);
        D.advance(FIXED);
        if((i & 127) === 127) await sleep(0);
      }
    },
    // start a race and skip the countdown. opts: {humans, bots, skill}
    race(level, opts){
      opts = opts || {};
      const humans = opts.humans === undefined ? 1 : opts.humans;
      D.lobbyReset();
      for(let i = 1; i < humans; i++) D.lobby.humans.push({ name: 'P' + (i + 1), color: i, input: { kind: 'kb', map: i } });
      D.lobby.botCount = opts.bots === undefined ? -1 : opts.bots;
      window.SRR_AI.setSkill(opts.skill === undefined ? 0.9 : opts.skill);
      t.clearDrive();
      D.start(level);
      D.advance(3.5);
      return D.racers;
    },
    human(i){ return D.racers.filter(r => r.kind === 'human')[i || 0]; },
    bots(){ return D.racers.filter(r => r.kind === 'bot'); },
    teleport(r, x, y, z){
      const B = r.body;
      B.pos.set(x, y, z); B.vel.set(0, 0, 0);
      B.dive = false; B.diveT = 0; B.upright = true; B.fallT = 0; B.tripSev = 0; B.graceT = 0; B.diveHeld = false;
    },
    ground(x, z){ return A.groundAt(x, z, 3).y; },
    // a straight stretch with nothing on it and no coins (L1, past the last gap)
    lane(){ return { x: -2, z: 121 }; },
    clearDrive(){ for(const k in D.drive) delete D.drive[k]; },
    tiles(){ return A.RT.boards.filter(b => b.type === 'tile'); },
    level(i){ return LV[i]; }
  };
  return t;
}

// ---------- shared helpers ----------
// rotating obstacles (windmill / rotator / fan) are Groups of holder Groups
function rotorHubs(scene, isBlade){
  const out = [];
  scene.traverse(o => {
    if(!o.isGroup) return;
    const holders = o.children.filter(c => c.isGroup);
    if(holders.length < 2) return;
    if(holders.every(h => h.children.some(c => c.isMesh && isBlade(c.scale)))) out.push(o);
  });
  return out;
}
const isMillBlade = s => Math.abs(s.x - 0.5) < 1e-6 && Math.abs(s.z - 0.22) < 1e-6;
const isRotatorArm = s => Math.abs(s.y - 0.38) < 1e-6 && Math.abs(s.z - 0.55) < 1e-6;
// world-space vertical extent of a hub's parts: {bladeLo, bladeHi, tipLo, tipHi}
function hubExtents(hub, isBlade, T3){
  hub.updateWorldMatrix(true, true);
  const box = new T3.Box3();
  const e = { bladeLo: Infinity, bladeHi: -Infinity, tipLo: Infinity, tipHi: -Infinity };
  hub.children.forEach(h => {
    if(!h.isGroup) return;
    h.children.forEach(m => {
      if(!m.isMesh) return;
      box.setFromObject(m);
      const b = isBlade(m.scale);
      const lo = b ? 'bladeLo' : 'tipLo', hi = b ? 'bladeHi' : 'tipHi';
      e[lo] = Math.min(e[lo], box.min.y); e[hi] = Math.max(e[hi], box.max.y);
    });
  });
  return e;
}
// call after every chunk: where did each bot fall in that chunk?
function fallTracker(bots){
  const st = new Map();
  bots.forEach(b => st.set(b, { z: b.body.pos.z, falls: b.falls }));
  return () => {
    const out = [];
    for(const b of bots){
      const s = st.get(b);
      if(b.falls > s.falls) out.push({ name: b.name, z: s.z });
      s.z = b.body.pos.z; s.falls = b.falls;
    }
    return out;
  };
}
function zoneFalls(falls, z0, z1){ return falls.filter(f => f.z >= z0 && f.z < z1).length; }

// =====================================================================
// 1. OBSTACLES — what is drawn must match what hits, and must work
// =====================================================================
T.suite('obstacles', async t => {
  const { D, A, LV, T3 } = t;
  const box = new T3.Box3();

  for(let li = 0; li < LV.length; li++){
    const L = LV[li];
    const hasMill = L.obstacles.some(o => o.k === 'mill');
    const hasRot = L.obstacles.some(o => o.k === 'rotator');
    if(!hasMill && !hasRot) continue;
    t.race(li, { bots: 0 });
    const mills = rotorHubs(D.S.scene, isMillBlade);
    const rotors = rotorHubs(D.S.scene, isRotatorArm);
    t.eq(mills.length, L.obstacles.filter(o => o.k === 'mill').length, 'L' + (li + 1) + ' built every windmill');
    t.eq(rotors.length, L.obstacles.filter(o => o.k === 'rotator').length, 'L' + (li + 1) + ' built every rotator');
    const worst = { bladeLo: Infinity, tipLo: Infinity, rotorTop: -Infinity, rotorCollTop: -Infinity };
    for(let i = 0; i < 420; i++){          // 14s at 30Hz covers a full turn
      D.advance(1 / 30);
      for(const h of mills){
        const e = hubExtents(h, isMillBlade, T3);
        worst.bladeLo = Math.min(worst.bladeLo, e.bladeLo); worst.tipLo = Math.min(worst.tipLo, e.tipLo);
      }
      for(const h of rotors){
        const e = hubExtents(h, isRotatorArm, T3);
        worst.rotorTop = Math.max(worst.rotorTop, e.bladeHi, e.tipHi);
      }
      if((i & 63) === 63) await sleep(0);
    }
    if(mills.length){
      t.ok(worst.bladeLo >= -0.01, 'L' + (li + 1) + ' windmill blades never dip into the road', 'lowest blade point y=' + worst.bladeLo.toFixed(3) + ' (road surface is 0)');
      t.ok(worst.tipLo > 0.02, 'L' + (li + 1) + ' windmill tip balls clear the road', 'lowest tip y=' + worst.tipLo.toFixed(3));
    }
    if(rotors.length){
      const coll = Math.max(...A.RT.solids.filter(c => c.tag === 'rotor').map(c => c.max.y));
      t.ok(coll >= worst.rotorTop - 0.02, 'L' + (li + 1) + ' rotator collider is not shorter than the drawn arm',
        'collider top ' + coll.toFixed(2) + ', drawn top ' + worst.rotorTop.toFixed(2));
      t.ok(coll <= worst.rotorTop + 0.06, 'L' + (li + 1) + ' rotator collider is not taller than the drawn arm (no hits on "air")',
        'collider top ' + coll.toFixed(2) + ', drawn top ' + worst.rotorTop.toFixed(2));
    }
  }

  // a standing bean in the sweep path is still knocked over by both
  {
    t.race(0, { bots: 0 });                       // L1 windmill at z=18
    const P = t.human();
    t.teleport(P, 0, 0.05, 18);
    let hit = false;
    await t.steps(8, () => { if(!P.body.upright) hit = true; });
    t.ok(hit, 'windmill still knocks over a bean standing in its path');
  }
  {
    t.race(3, { bots: 0 });                       // L4 rotator at z=22, r=3.4
    const P = t.human();
    const o = LV[3].obstacles.find(x => x.k === 'rotator');
    t.teleport(P, o.x, 0.05, o.z + o.r * 0.57);
    let hit = false;
    await t.steps(2 * Math.PI / o.speed + 1, () => { if(!P.body.upright) hit = true; });
    t.ok(hit, 'rotator still knocks over a bean standing in its path');
  }

  // falling-tile bridge (L5): stepping on ONE tile drops that tile only
  {
    t.race(4, { bots: 0 });
    const tiles = t.tiles();
    t.eq(tiles.length, 15, 'L5 has 15 falling tiles');
    t.eq(new Set(tiles.map(b => b.mesh.material)).size, tiles.length, 'every tile has its own material');
    const mid = tiles.filter(b => b.z === tiles[0].z).sort((a, b) => a.x - b.x)[1];
    const others = tiles.filter(b => b !== mid);
    const P = t.human();
    t.teleport(P, mid.x, 0.3, mid.z);
    await t.step(0.1);
    t.eq(mid.state, 'armed', 'standing on a tile arms it');
    t.eq(mid.mesh.material.emissive.getHex(), 0x881111, 'the armed tile flashes red');
    t.ok(others.every(b => b.state === 'idle' && b.mesh.material.emissive.getHex() === 0x111144),
      'the other 14 tiles stay put and keep their colour');
    await t.step(0.75);
    t.eq(mid.state, 'falling', 'armed tile drops after 0.7s');
    t.ok(mid.disabled === true, 'a falling tile is no longer standable');
    await t.step(1.6);
    t.eq(mid.state, 'gone', 'fallen tile disappears');
    t.eq(P.falls, 1, 'a bean standing on the dropped tile falls into the void');
    t.ok(P.body.pos.z < 33 || P.body.pos.z > 45.5, 'respawn is on solid road, not on the tile bridge', 'respawn z=' + P.body.pos.z.toFixed(1));
    await t.step(2.3);
    t.eq(mid.state, 'idle', 'tile comes back after ~2.2s');
    t.ok(mid.mesh.visible && !mid.disabled && mid.mesh.material.emissive.getHex() === 0x111144, 'returned tile is standable and back to its colour');
  }
});

// =====================================================================
// 2. BOTS — every bot finishes, and nobody falls off the same spot forever
// =====================================================================
// Per race (9 bots at skill 0.9). L1/L2/L4 run clean; L3 and L5 keep a few
// crowd falls at the ferry and on the tile bridges. Budgets sit well above
// the typical numbers so a blip does not fail, but a loop (a bot falling
// every few seconds) blows straight through them.
const BOT_BUDGET = {
  1: { falls: 6, per: 3 },
  2: { falls: 6, per: 3 },
  3: { falls: 18, per: 8 },
  4: { falls: 6, per: 3 },
  5: { falls: 40, per: 14 }
};
T.suite('bots', async t => {
  const { D, LV } = t;
  for(let li = 0; li < LV.length; li++){
    let aggFalls = 0, aggWorst = 0, aggFinished = 0, trials = 2;
    const zones = { disc: 0, ferry: 0 };
    for(let trial = 0; trial < trials; trial++){
      t.race(li, { bots: -1, skill: 0.9 });
      const bots = t.bots();
      t.eq(bots.length, 9, 'L' + (li + 1) + ' fills the grid with 9 bots');
      const fell = fallTracker(bots);
      let guard = 0;
      while(guard < 160 * 4 && !bots.every(b => b.finished) && D.S.phase === 'race'){
        D.advance(0.25);
        const f = fell();
        if(li === 2){
          zones.disc += zoneFalls(f, 24, 40);
          zones.ferry += zoneFalls(f, 42, 57);
        }
        guard++;
        if((guard & 15) === 15) await sleep(0);
      }
      const falls = bots.reduce((a, b) => a + b.falls, 0);
      const worst = Math.max(...bots.map(b => b.falls));
      const finished = bots.filter(b => b.finished).length;
      aggFalls += falls; aggWorst = Math.max(aggWorst, worst); aggFinished += finished;
    }
    const b = BOT_BUDGET[li + 1];
    t.eq(aggFinished, 9 * trials, 'L' + (li + 1) + ' every bot finishes in every trial');
    t.ok(aggFalls <= b.falls * trials, 'L' + (li + 1) + ' bots do not keep falling (total falls over ' + trials + ' races)',
      aggFalls + ' falls, budget ' + b.falls * trials);
    t.ok(aggWorst <= b.per, 'L' + (li + 1) + ' no single bot falls again and again', 'worst bot fell ' + aggWorst + ' times, budget ' + b.per);
    if(li === 2){
      t.ok(zones.disc <= 10 * trials, 'L3 bots cross the spinning disc (falls at the disc)', zones.disc + ' falls, budget ' + 10 * trials);
      t.ok(zones.ferry <= 12 * trials, 'L3 bots ride the ferry platform (falls at the ferry)', zones.ferry + ' falls, budget ' + 12 * trials);
    }
  }
  window.SRR_AI.setSkill(null);
});

// =====================================================================
// 3. BUMPERS — approach from every angle: never wedged, never bounced off
// =====================================================================
T.suite('bumpers', async t => {
  const { D, A, LV } = t;
  let cases = 0, wedged = 0, fell = 0, skipped = 0, gotThrough = 0;
  const bad = [];
  for(let li = 0; li < LV.length; li++){
    const bumps = LV[li].obstacles.filter(o => o.k === 'bumper');
    if(!bumps.length) continue;
    t.race(li, { bots: 0 });
    const P = t.human();
    for(const o of bumps){
      const reach = o.r * 0.85 + 0.42 * 0.8;
      for(let deg = 0; deg < 360; deg += 15){
        const dx = Math.sin(deg * Math.PI / 180), dz = Math.cos(deg * Math.PI / 180);
        const sx = o.x + dx * 2.4, sz = o.z + dz * 2.4, gx = o.x - dx * 2.4, gz = o.z - dz * 2.4;
        const [rx0, rx1] = A.roadXAt(sz);
        if(sx < rx0 + 0.3 || sx > rx1 - 0.3 || gx < rx0 - 0.2 || gx > rx1 + 0.2 ||
           A.voidAt(sx, sz) || A.groundAt(sx, sz, 3).y < -1 || t.ground(sx, sz) > 0.5 ||
           bumps.some(q => q !== o && Math.hypot(q.x - sx, q.z - sz) < q.r + 1.3)){
          skipped++; continue;
        }
        cases++;
        t.teleport(P, sx, t.ground(sx, sz) + 0.05, sz);
        P.falls = 0;
        // Hold ONE direction, like a player leaning on the stick. (Re-aiming at
        // the goal behind the ball every step would bounce a racer straight
        // back along its own approach forever — no human steers like that.)
        // The case ends as soon as the racer is clear of the ball: whatever
        // happens further on (a windmill, a gap) is not the bumper's doing.
        const dirx = gx - sx, dirz = gz - sz;
        let free = false, touched = false, slowT = 0, travelled = 0;
        for(let i = 0; i < 120 * 4; i++){
          D.drive.P1 = { mx: dirx, mz: dirz, jump: false, dive: false };
          D.advance(FIXED);
          const d = Math.hypot(P.body.pos.x - o.x, P.body.pos.z - o.z);
          if(d < reach + 0.35) touched = true;
          if(P.falls > 0) break;
          if(touched && d > 2.4){ free = true; break; }
          if(touched){
            travelled += Math.hypot(P.body.vel.x, P.body.vel.z) * FIXED;
            if((i & 15) === 15){                       // per 1/8s window
              if(travelled < 0.15) slowT += 0.125; else slowT = 0;   // under ~1.2 m/s
              travelled = 0;
            }
          }
          if((i & 255) === 255) await sleep(0);
        }
        if(P.falls > 0 && touched){ fell++; bad.push('L' + (li + 1) + ' z' + o.z + ' @' + deg + '° fell'); }
        else if(touched && !free && slowT > 1){ wedged++; bad.push('L' + (li + 1) + ' z' + o.z + ' @' + deg + '° wedged'); }
        if(free || !touched) gotThrough++;
      }
    }
  }
  t.ok(cases >= 200, 'bumper matrix has enough cases', cases + ' cases, ' + skipped + ' skipped (start or goal off the road / on another bumper)');
  t.ok(wedged === 0, 'never wedged against a bumper', wedged + ' wedged: ' + bad.filter(x => x.includes('wedged')).slice(0, 8).join('; '));
  t.ok(fell === 0, 'never bounced off a bumper into the void', fell + ' fell: ' + bad.filter(x => x.includes('fell')).slice(0, 8).join('; '));
  t.log('clear of the bumper holding one direction: ' + gotThrough + ' of ' + cases + ' cases');
  t.clearDrive();
});

// =====================================================================
// 4. HUMAN MECHANICS — the things a player immediately feels
// =====================================================================
T.suite('human mechanics', async t => {
  const { D } = t;
  // top speed on flat road
  {
    t.race(0, { bots: 0 });
    const P = t.human(), lane = t.lane();
    t.teleport(P, lane.x, 0.05, lane.z);
    let vmax = 0;
    await t.steps(1.5, () => {
      D.drive.P1 = { mx: 0, mz: 1, jump: false, dive: false };
      vmax = Math.max(vmax, Math.hypot(P.body.vel.x, P.body.vel.z));
    });
    t.between(vmax, 6.0, 6.3, 'run speed tops out at 6.2 m/s');
    t.clearDrive();
  }
  // jump length from a full run-up
  {
    const P = t.human(), lane = t.lane();
    t.teleport(P, lane.x, 0.05, lane.z);
    let takeoff = null, land = null, hold = 0;
    await t.steps(2.5, i => {
      const B = P.body;
      const press = takeoff === null && B.grounded && B.pos.z >= lane.z + 3;
      if(press) takeoff = B.pos.z;
      hold = press ? 3 : Math.max(0, hold - 1);
      D.drive.P1 = { mx: 0, mz: 1, jump: hold > 0, dive: false };
      if(takeoff !== null && land === null && B.pos.z > takeoff + 0.5 && B.grounded) land = B.pos.z;
    });
    t.ok(land !== null, 'a running jump lands again');
    if(land !== null) t.between(land - takeoff, 3.6, 4.4, 'running jump covers about 4.1 m');
    t.clearDrive();
  }
  // buffered jump: a press just before landing fires on touchdown
  {
    const P = t.human();
    t.teleport(P, 0, 0.05, 8);
    let first = false, second = false;
    await t.steps(1.6, i => {
      // airtime is ~0.66s (79 steps): press again at 62..69, i.e. ~0.1s before touchdown
      const press = i < 3 || (i >= 62 && i < 70);
      D.drive.P1 = { mx: 0, mz: 0, jump: press, dive: false };
      if(P.body.vel.y > 5){ if(i < 10) first = true; else second = true; }
    });
    t.ok(first, 'first jump happened');
    t.ok(second, 'jump buffered before landing fires on touchdown (no lost input)');
    t.clearDrive();
  }
  // coyote time: a press just after running off a ledge still jumps
  {
    t.race(2, { bots: 0 });                       // L3 platform at z=15 ends at 16.5
    const P = t.human();
    t.teleport(P, 0, 0.05, 14.2);
    let leftAt = null, jumped = false;
    await t.steps(2.5, i => {
      const B = P.body;
      if(leftAt === null){
        D.drive.P1 = { mx: 0, mz: 1, jump: false, dive: false };
        if(!B.grounded && B.pos.z > 16) leftAt = i;
      } else if(i - leftAt < 8){                 // within ~0.07s of leaving
        D.drive.P1 = { mx: 0, mz: 1, jump: true, dive: false };
        if(B.vel.y > 8) jumped = true;
      } else D.drive.P1 = { mx: 0, mz: 1, jump: false, dive: false };
    });
    t.ok(leftAt !== null, 'ran off the platform edge');
    t.ok(jumped, 'coyote time: jump pressed just after the edge still works');
    t.clearDrive();
  }
  // boost gap (L1 z 29.2-31.4): run over the pad and jump. Start clear of the
  // windmill at z=23.5 so a stray blade cannot make the test flaky.
  {
    t.race(0, { bots: 0 });
    const P = t.human();
    t.teleport(P, 0, 0.05, 25);
    let maxZ = 25;
    await t.steps(3, () => {
      const B = P.body;
      D.drive.P1 = { mx: 0, mz: 1, jump: B.grounded && B.pos.z > 27.0 && B.pos.z < 28.4, dive: false };
      maxZ = Math.max(maxZ, B.pos.z);
    });
    t.eq(P.falls, 0, 'boost pad + jump clears the first gap');
    t.ok(maxZ > 33, '…and lands beyond it', 'reached z=' + maxZ.toFixed(1));
    t.clearDrive();
  }
  // respawn: falling just before that gap never relaunches you, and a jump
  // works on the very first frame after respawning
  {
    const P = t.human(), B = P.body;
    P.falls = 0;
    t.teleport(P, 0, -1, 30.3);                  // inside the gap
    const atRespawn = { upright: false, grounded: false, z: 0, y: 0 };
    await t.steps(2, () => { if(P.falls === 1 && !atRespawn.upright && !atRespawn.grounded && B.pos.y > -1){ atRespawn.upright = B.upright; atRespawn.grounded = B.grounded; atRespawn.z = B.pos.z; atRespawn.y = B.pos.y; } });
    t.eq(P.falls, 1, 'falling into the gap costs one fall');
    t.ok(atRespawn.upright && atRespawn.grounded, 'respawn stands you up immediately', 'upright=' + atRespawn.upright + ' grounded=' + atRespawn.grounded);
    t.ok(atRespawn.z <= 23.9 && atRespawn.z >= 8, 'respawn is clear of the boost pad before the gap', 'respawn z=' + atRespawn.z.toFixed(1));
    await t.step(3);
    t.eq(P.falls, 1, 'standing still after a respawn never drops you again');
    let rose = false;
    await t.steps(0.1, i => {
      D.drive.P1 = { mx: 0, mz: 0, jump: i < 4, dive: false };
      if(B.pos.y > 0.2) rose = true;
    });
    t.ok(rose, 'jump works on the first frame after a respawn');
    t.clearDrive();
  }
  // a jump pressed too early (before the boost pad) still clears the gap:
  // the pad triggers while you fly over it
  {
    const P = t.human();
    P.falls = 0;
    t.teleport(P, 0, 0.05, 24.8);
    let maxZ = 24.8;
    await t.steps(3, () => {
      const B = P.body;
      D.drive.P1 = { mx: 0, mz: 1, jump: B.grounded && B.pos.z > 25.3, dive: false };
      maxZ = Math.max(maxZ, B.pos.z);
    });
    t.eq(P.falls, 0, 'early jump before the boost pad still clears the gap', 'reached z=' + maxZ.toFixed(1));
    t.clearDrive();
  }
});

// =====================================================================
// 5. ANALYTICS — win% is a probability, not a mood
// =====================================================================
T.suite('analytics', async t => {
  const { D } = t;
  const AN = window.SRR_ANALYTICS;
  t.race(0, { bots: -1, skill: 0.9 });
  const sample = n => { for(let i = 0; i < n; i++){ D.advance(0.25); AN.update(D.racers, D.S, 0.25); } };
  sample(16);                                    // 4s of racing
  const wins = () => D.racers.map(r => AN.racers.get(r).win);
  const sum = wins().reduce((a, b) => a + b, 0);
  t.between(sum, 98, 102, 'win% adds up to 100 while everyone is still racing');
  t.ok(wins().every(w => w >= 0 && w <= 100), 'no win% outside 0..100');
  let first = null;
  for(let i = 0; i < 400 && !first; i++){ D.advance(0.25); AN.update(D.racers, D.S, 0.25); first = D.racers.find(r => r.finished); }
  t.ok(!!first, 'a bot eventually finishes');
  sample(8);
  const w = new Map(D.racers.map(r => [r, AN.racers.get(r).win]));
  t.near(w.get(first), 100, 0.5, 'the winner shows 100%');
  t.ok(D.racers.filter(r => !r.finished).every(r => w.get(r) < 1), 'once someone has won, nobody still racing shows a win chance');
});

// =====================================================================
// 6. UI — the things on screen: messages, lobby, menu, split-screen HUD
// =====================================================================
const rect = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

T.suite('ui', async t => {
  const { D } = t;
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  // floating messages actually reach the screen
  {
    D.menu();
    const box = q('#toastBox');
    t.ok(!!box, 'the toast container exists');
    D.toast('測試訊息 123');
    const last = box && box.lastElementChild;
    t.ok(box && last && last.textContent === '測試訊息 123', 'a toast message is added to the screen');
  }
  // lobby colour dot cycles through every colour nobody else uses
  {
    D.lobbyReset();
    const seen = [D.lobby.humans[0].color];
    for(let i = 0; i < 9; i++){ q('#lobbySlots .slot .sdot').click(); seen.push(D.lobby.humans[0].color); }
    t.eq(new Set(seen).size, 10, 'clicking your colour dot reaches all 10 colours', 'visited ' + seen.join(','));
    D.addHuman(1);
    const p1 = D.lobby.humans[0], p2 = D.lobby.humans[1];
    let tookOther = false;
    for(let i = 0; i < 12; i++){ q('#lobbySlots .slot .sdot').click(); if(D.lobby.humans[0].color === p2.color) tookOther = true; }
    t.ok(!tookOther, 'two players are never given the same colour');
    void p1;
  }
  // the whole menu fits a 1280x720 window without scrolling — with one player
  // in the lobby and with all four joined
  {
    const ov = q('#menu-ov');
    for(const n of [1, 2, 4]){
      D.menu();
      D.lobbyReset();
      for(let i = 1; i < n; i++) D.addHuman(i);
      await sleep(60);
      t.ok(ov.scrollHeight <= ov.clientHeight + 1, 'the menu fits the window without scrolling (' + n + ' player' + (n > 1 ? 's' : '') + ' joined)',
        'content ' + ov.scrollHeight + 'px, window ' + ov.clientHeight + 'px');
      t.eq(qa('#lobbySlots .slot').length, n, 'menu lists ' + n + ' player slot' + (n > 1 ? 's' : ''));
    }
    D.lobbyReset();
    t.ok(!!q('#btnPlay'), 'menu shows the start button');
  }
  // solo race: one key widget, no column overlays, hint not printed over the key tags
  {
    t.race(0, { bots: -1 });
    D.ui();
    t.eq(qa('#colHud .colhud').length, 0, 'solo: no split-screen column overlays');
    t.ok(!document.body.classList.contains('split'), 'solo: body is not in split mode');
    t.ok(qa('#hud .keyrow .wk').length === 6, 'solo: P1 key widget shows 6 keys', qa('#hud .keyrow .wk').length + ' keys');
    const rot = q('#rot'), tag = q('#hud .keyrow .wk .tag');
    t.ok(!overlaps(rect(rot), rect(tag)), 'solo: the mouse hint does not overlap the key caption',
      'hint ' + JSON.stringify(rect(rot)) + ' caption ' + JSON.stringify(rect(tag)));
    const clock = rect(q('#clock')), restart = rect(q('#restart'));
    t.ok(!overlaps(clock, restart), 'solo: the restart button does not overlap the clock');
    t.ok(q('#stBox').textContent.indexOf('人混戰') >= 0, 'solo: stats box is filled in');
    // a real key press lights the matching key
    const cap = D.S.keyCaps.find(k => k.cap._codes.indexOf('KeyD') >= 0);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
    D.ui();
    t.ok(cap && cap.cap.classList.contains('on'), 'pressing D lights up the D key on screen');
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true }));
    D.ui();
    t.ok(cap && !cap.cap.classList.contains('on'), 'releasing D dims it again');
  }
  // four players: one overlay per column, each with its own tag, standing, hint and keys
  {
    t.race(0, { humans: 4, bots: 6 });
    D.columns();
    await sleep(40);
    D.ui();
    const cols = qa('#colHud .colhud');
    t.eq(cols.length, 4, '4 players: four column overlays');
    t.ok(document.body.classList.contains('split'), 'split mode is on');
    t.ok(qa('#stBox.solo-only, #rankBox.solo-only, #rot.solo-only, #hud .keyrow.solo-only').length === 4,
      'the single-player panels step aside in split-screen');
    t.ok(cols.every((c, i) => c.querySelector('.ctag').textContent.indexOf('P' + (i + 1)) >= 0), 'each column is tagged with its own player');
    t.ok(cols.every(c => /第 \d+\/10 名/.test(c.querySelector('.cstat').textContent)), 'each column shows that player\'s own standing',
      cols.map(c => c.querySelector('.cstat').textContent).join(' | '));
    t.ok(cols.every((c, i) => c.querySelectorAll('.wk').length === 6), 'each column has its own key widget');
    // the four columns tile the width exactly
    const rs = cols.map(rect), W = innerWidth;
    t.ok(Math.abs(rs[0].l) < 1 && Math.abs(rs[3].r - W) < 1 && rs.every((r, i) => i === 0 || Math.abs(r.l - rs[i - 1].r) < 1),
      'the columns tile the screen edge to edge', rs.map(r => r.l.toFixed(0) + '-' + r.r.toFixed(0)).join(' '));
    // per-player hint: move P3 onto the windmill hint band, P1 stays at the start
    const p3 = D.racers.filter(r => r.kind === 'human')[2];
    const L = window.LEVELS[0];
    const hz = L.hints[2].z, mid = (hz[0] + hz[1]) / 2;
    p3.body.pos.z = mid;
    D.ui();
    t.ok(cols[2].querySelector('.chint').textContent.indexOf(L.hints[2].t) >= 0, 'P3 sees the hint for the part of the track P3 is on');
    t.ok(cols[0].querySelector('.chint').textContent.indexOf(L.hints[2].t) < 0, '…and P1, further back, does not');
    // pause screen lists everyone
    D.S.paused = false;
    D.pause();
    t.ok(D.S.paused, 'Esc pauses the race');
    t.eq(qa('#pauseStats .pauseList .rrow').length, 10, 'the pause screen lists all 10 racers');
    D.pause();
    t.ok(!D.S.paused, 'Esc resumes');
    t.clearDrive();
  }
  // back to one player after a split race: nothing of the split HUD may remain
  {
    t.race(0, { bots: -1 });
    D.ui();
    await sleep(30);
    t.eq(qa('#colHud .colhud').length, 0, 'a solo race after a split race has no leftover column overlays');
    t.ok(!document.body.classList.contains('split'), '…and split mode is off');
    t.ok(qa('.solo-only').length === 0, '…and the single-player panels are back');
    t.ok(q('#stBox').textContent.indexOf('人混戰') >= 0, '…with the stats box filled in');
  }
});

// =====================================================================
// 6. COINS & RESULTS — coins are a "sugar rush", and everyone gets a card
// =====================================================================
T.suite('coins & results', async t => {
  const { D, A } = t;
  const coinBonusOf = r => 1 + 0.015 * Math.min(10, r.coins);
  // P1 stands on a coin: it is collected and the speed limit rises
  {
    t.race(0, { bots: 0 });
    const P = t.human(), B = P.body;
    const coin = A.RT.collectors[0];
    t.teleport(P, coin.x, coin.y - 0.4, coin.z);
    await t.step(0.05);
    t.eq(P.coins, 1, 'standing on a coin collects it');
    t.eq(coin.got, true, '…and the coin is gone from the track');
    const lane = t.lane();
    t.teleport(P, lane.x, 0.05, lane.z);
    let v1 = 0;
    await t.steps(1.2, () => { D.drive.P1 = { mx: 0, mz: 1, jump: false, dive: false }; v1 = Math.max(v1, B.vel.z); });
    t.near(v1, 6.2 * coinBonusOf(P), 0.06, 'one coin raises the top speed by 1.5%');
    t.ok(v1 > 6.25, '…which is faster than without coins', 'v=' + v1.toFixed(2));
    t.clearDrive();
  }
  // bots leave the coins alone
  {
    t.race(0, { bots: 1 });
    await t.step(1);
    const bot = t.bots()[0], coin = A.RT.collectors[0];
    t.teleport(bot, coin.x, coin.y - 0.4, coin.z);
    await t.step(0.05);
    t.eq(coin.got, false, 'a bot running through a coin does not take it');
  }
  // falling spills coins
  {
    t.race(0, { bots: 0 });
    const P = t.human();
    P.coins = 7; P.falls = 0;
    t.teleport(P, 0, -1, 30.3);                   // into the first gap
    await t.step(1.6);
    t.eq(P.falls, 1, 'the bean fell');
    t.eq(P.coins, 4, 'falling spills 3 coins');
    t.teleport(P, 0, -1, 30.3);
    await t.step(1.6);
    t.eq(P.coins, 1, 'falling again spills 3 more (never below zero)');
  }
  // results: podium, a card per player with a personal best, the list, records saved
  {
    localStorage.removeItem('srr-save2');
    t.race(0, { humans: 2, bots: 8 });
    const [p1, p2] = D.racers.filter(r => r.kind === 'human');
    // P2 crosses first, P1 second
    t.teleport(p2, 0, 0.05, window.LEVELS[0].ring[0][2] - 0.5);
    await t.step(0.1);
    p2.coins = 4;
    t.teleport(p1, 0, 0.05, window.LEVELS[0].ring[0][2] - 0.5);
    await t.step(0.1);
    t.ok(p2.finished && p1.finished && p2.finishRank < p1.finishRank, 'both players crossed the line, P2 ahead');
    await t.step(4);                               // end-of-race grace
    t.eq(D.S.phase, 'done', 'the race ends once every human has finished');
    t.ok(!document.getElementById('res-ov').classList.contains('hidden'), 'the results screen is shown');
    t.eq(document.querySelectorAll('#resStats .pod').length >= 2, true, 'the podium shows the top racers');
    t.eq(document.querySelectorAll('#resStats .resCard').length, 2, 'one results card per human player');
    const cards = [...document.querySelectorAll('#resStats .resCard')].map(c => c.textContent);
    t.ok(cards[1].indexOf('P2') === 0 && cards[1].indexOf('第 1 名') > 0, 'P2\'s card says 1st place', cards[1]);
    t.ok(cards[1].indexOf('硬幣 4') > 0 && cards[1].indexOf('+6%') > 0, 'P2\'s card shows the coins and the speed bonus they gave', cards[1]);
    t.ok(cards[0].indexOf('新紀錄') > 0 && cards[1].indexOf('新紀錄') > 0, 'first finish is a new personal best for both players');
    t.eq(document.querySelectorAll('#resStats .resList .rrow').length, 10, 'the full list shows all 10 racers');
    const save = JSON.parse(localStorage.getItem('srr-save2'));
    t.ok(typeof save.best0 === 'number' && typeof save['best0_p1'] === 'number', 'each player\'s best time is saved separately (P1 keeps the original key)');
    // a slower second run: no "new record" for that player
    t.race(0, { humans: 2, bots: 8 });
    const [q1, q2] = D.racers.filter(r => r.kind === 'human');
    await t.step(2.5);                             // a slower run this time
    t.teleport(q1, 0, 0.05, window.LEVELS[0].ring[0][2] - 0.5);
    await t.step(0.1);
    await t.step(6);                               // P1 finishes, P2 does not
    t.teleport(q2, 0, 0.05, window.LEVELS[0].ring[0][2] - 0.5);
    await t.step(0.1);
    await t.step(4);
    const c2 = [...document.querySelectorAll('#resStats .resCard')].map(c => c.textContent);
    t.ok(c2[0].indexOf('新紀錄') < 0, 'a slower run is not a new record', c2[0]);
    t.ok(c2[0].indexOf('個人最佳') > 0, '…but the card still shows the best time', c2[0]);
    t.clearDrive();
  }
});

// =====================================================================
// runner
// =====================================================================
T.report = function(){ return { done: T.done, running: T.running, error: T.error, progress: T.progress, results: T.results }; };
T.run = async function(filter){
  T.running = true; T.done = false; T.error = null; T.results.length = 0; T.progress = '';
  try{
    for(const s of T.suites){
      if(filter && s.name.indexOf(filter) < 0) continue;
      T.progress = s.name;
      const t = toolkit();
      try{ await s.fn(t); }
      catch(e){ t.ok(false, s.name + ' threw', (e && e.stack) || e); }
      for(const r of t.results){ r.suite = s.name; T.results.push(r); }
      await sleep(0);
    }
  }catch(e){ T.error = String((e && e.stack) || e); }
  T.running = false; T.done = true; T.progress = '';
};
T.autorun = function(){
  if(/[?&]manual=1(&|$)/.test(location.search)) return;   // loaded, not started: call SRR_TEST.run() yourself
  const filter = new URLSearchParams(location.search).get('suite') || '';
  setTimeout(() => T.run(filter), 0);
};
// main.js calls autorun() when it finishes booting; if this file loaded after
// that, start from here
if(window._DBG && window._DBG.S.booted && /\/index\.html/.test(location.pathname)) T.autorun();
})();
