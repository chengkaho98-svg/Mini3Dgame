// ================= SUGAR RUSH ROYALE — bots.js =================
// Generic reactive AI for bot racers. One brain per bot; every replan it
// samples a fan of candidate directions, scores ground / hazards / progress
// and outputs a movement intent identical in shape to human input:
//   {mx, mz, jump, dive}
// Gap crossings use a dedicated GAP MODE controller (sprint + edge jump)
// because direction sampling near an edge is intrinsically unstable.
// main.js runs bot bodies through the exact same physics as humans.
// Exposes window.SRR_AI = {botInfo, createBrain}.
(function(){
'use strict';

const NAMES = ['糖糖仔','閃電泡','跳跳軟糖','棉花團','果凍君','彩虹豆','泡泡糖','太妃糖','Q彈妹','薄荷仔'];
const COLORS = ['#31e6ff','#ffd23e','#58e06c','#a25cff','#ff8a3d','#ff4d4d','#ffa3d1','#aef4d8','#7fd0f7','#ffffff'];

function mulberry(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a>>>15, 1 | a);
    t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t;
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  };
}

// threat weight per collider tag (how badly a bot wants to avoid it)
function tagThreat(t, c){
  if(t === 'punch') return (c._ext||0) > 0.2 ? 1.25 : 0.12;
  if(t === 'pend') return 1.35;
  if(t === 'rotor') return 1.15;
  if(t === 'crush') return 1.25;
  if(t === 'mill') return 1.0;
  if(t === 'roller') return 1.05;
  if(c._bump) return 0.45;
  return 0;
}

function createBrain(id, skill){
  skill = skill || (0.72 + Math.random()*0.33);
  const rng = mulberry(id*7919 + 17);
  const brain = {
    replanT: 0, lastDir: 0, stuck: 0, sideT: 0, sideDir: 0, blockT: 0, chargeT: 0,
    stallT: 0, stallX: 0, stallZ: 0,
    think(r, S, API, dt){
      const B = r.body;
      B.speedMul = 0.86 + skill*0.16;
      // downed: let the get-up timer work; crawl gently forward
      if(!B.upright) return {mx:0, mz:0.35, jump:false, dive:false};

      brain.replanT -= dt;
      if(brain.replanT > 0){
        return brain.commit(r, S, API, dt, brain.lastDir);
      }
      brain.replanT = 0.09 + (1-skill)*0.14;

      const dirs = [0, 0.32, -0.32, 0.75, -0.75, 1.25, -1.25, 1.9, -1.9];
      let bestDir = 0, bestScore = -1e9;
      for(const a of dirs){
        let score = 0;
        const sa = Math.sin(a), ca = Math.cos(a);
        const samples = [1.0, 2.0, 3.2, 4.6];
        for(let si=0; si<samples.length; si++){
          const s = samples[si];
          const px = B.pos.x + sa*s, pz = B.pos.z + ca*s;
          const w = 1/(1 + s*0.33);
          // ground?
          let g = API.groundAt(px, pz, B.pos.y + 0.5);
          let hover = false;
          if(g.y < -1){
            const fan = API.fanAt(px, pz);
            if(fan){ hover = true; score -= 0.2*w; }
          }
          if(g.board && g.board.type === 'tile' && g.board.state !== 'idle'){
            g = {y:-Infinity, board:null};     // armed/falling tile = no ground
          }
          if(g.y < -1 && !hover){
            // void: is it a jumpable gap (ground again a bit further)?
            let groundAgain = false;
            for(let s2 = s+1.2; s2 <= s+2.4; s2 += 0.4){
              const g2 = API.groundAt(B.pos.x + sa*s2, B.pos.z + ca*s2, B.pos.y + 0.5);
              const g2u = API.groundAt(B.pos.x + sa*s2, B.pos.z + ca*s2, B.pos.y + 2.6);
              if(g2.y > -1 || g2u.y > -1 || API.fanAt(B.pos.x + sa*s2, B.pos.z + ca*s2)){ groundAgain = true; break; }
            }
            score += groundAgain ? -0.12*w : -3.6*w;
          } else if(g.y > B.pos.y + 0.55){
            // step-up target (plat ahead) — mild cost, jumping handles it
            score -= 0.12*w;
          }
          // hazards at this sample
          for(const c of API.RT.solids){
            if(c.min.x > 1e8) continue;
            const t = c.tag;
            const th = tagThreat(t, c);
            if(!th) continue;
            if(px > c.min.x-0.55 && px < c.max.x+0.55 &&
               pz > c.min.z-0.55 && pz < c.max.z+0.55 &&
               c.min.y < B.pos.y + 1.25 && c.max.y > B.pos.y + 0.05){
              score -= th * w * 1.15;
            }
          }
        }
        score += 0.4*ca;                        // forward bias
        if(Math.abs(a) > 1.6) score -= 0.4;     // discourage retreat
        score += (rng()-0.5) * (1-skill)*0.9;   // skill noise
        if(score > bestScore){ bestScore = score; bestDir = a; }
      }
      brain.lastDir = bestDir;
      return brain.commit(r, S, API, dt, bestDir);
    },
    commit(r, S, API, dt, dir){
      const B = r.body;
      let mx = Math.sin(dir), mz = Math.cos(dir);
      let jump = false, dive = false;
      const sp = Math.max(2.2, Math.hypot(B.vel.x, B.vel.z));

      // ===== GAP MODE: dedicated crossing controller =====
      // Scan ahead for the PHYSICAL edge (first break in support under our
      // feet) rather than trusting void-band bookkeeping — this is correct on
      // discs (platform edge ≠ band end), moving platforms and tile bridges.
      let physEdge = null, lastHad = true;
      for(let z = B.pos.z + 0.3; z < B.pos.z + 7.5; z += 0.25){
        const has = API.groundAt(B.pos.x, z, B.pos.y + 0.45).y > -1;
        if(lastHad && !has){ physEdge = z - 0.125; break; }
        lastHad = has;
      }
      if(physEdge !== null && physEdge - B.pos.z < 5.5){
        // landing: first standable surface beyond the edge (jump height counts)
        let landing = -1, landingBoard = null;
        for(let z = physEdge + 0.2; z < physEdge + 6.5; z += 0.3){
          const g = API.groundAt(B.pos.x, z, B.pos.y + 2.8);
          if(g.y > -1){ landing = z; landingBoard = g.board; break; }
        }
        // aim INTO a spinning disc (rotation shifts the touch-down point)
        if(landingBoard && landingBoard.type === 'disc'){
          landing = Math.min(landing + landingBoard.r*0.45, landingBoard.cz);
        }
        // ballistic feasibility — HEIGHT-AWARE: an elevated landing shortens
        // the usable arc (you must still be above its top when you arrive)
        const C = window.SRR_CONST || {JUMP_V:11.2, GRAV:34, AIRTIME:0.66};
        const dh = Math.max(0, (landingBoard ? landingBoard.y : 0) - B.pos.y);
        const tExit = dh > 0.4
          ? (C.JUMP_V + Math.sqrt(Math.max(0.2, C.JUMP_V*C.JUMP_V - 2*C.GRAV*(dh+0.12)))) / C.GRAV
          : C.AIRTIME;
        const gapDist = (landing > 0 ? landing : physEdge + 3.2) - physEdge;
        const slack = sp*tExit - gapDist - Math.max(0.35, sp*0.1) - 0.25;
        const fanned = API.fanAt(B.pos.x, physEdge + 1.2);
        const boosted = API.RT.boards.some(b=>b.boost && b.z > B.pos.z-1.5 && Math.abs(b.z - physEdge) < 5.5);
        const jumpable = !!fanned || (slack >= 0 && gapDist <= 6.2) || (boosted && gapDist <= 8.5 && slack >= -2.8);
        if(jumpable){
          mx = Math.max(-0.45, Math.min(0.45, -B.pos.x*0.25));
          mz = Math.sqrt(Math.max(0.15, 1 - mx*mx));
          // counter the disc's tangential drift while riding it
          if(B.groundBoard && B.groundBoard.type === 'disc'){
            const db = B.groundBoard;
            const dx = B.pos.x - db.cx, dz = B.pos.z - db.cz;
            const tx = -dz * (db.omega||0);
            mx = Math.max(-0.7, Math.min(0.7, mx - tx*0.4));
            if(mx*mx > 1) mx = Math.sign(mx);
            mz = Math.sqrt(Math.max(0.2, 1 - mx*mx));
          }
          // overshoot guard: a full-speed leap would fly PAST a small landing
          // platform (e.g. bounce islands) — feather the approach first
          const landEnd = landingBoard
            ? (landingBoard.type === 'disc' ? landingBoard.cz + landingBoard.r
                                            : landingBoard.z + (landingBoard.hz||1))
            : landing + 2.2;
          const takeoffZ = physEdge - Math.max(0.35, sp*0.1);
          if(!fanned && !boosted && takeoffZ + sp*tExit > landEnd + 0.4 && gapDist < 3.6){
            return brain.finish(mx, 0.16, false, false);
          }
          const edge = physEdge - B.pos.z;
          if((edge < Math.max(0.38, sp*0.1) || (boosted && edge < 1.3)) && B.grounded && !fanned) jump = true;
          return brain.finish(mx, mz, jump, false);
        }
        // already riding a ferry (mplat/elevator): sit tight near the center
        // line and let it carry us — the landing scan re-runs every frame and
        // unlocks the hop as soon as the far side comes into range
        if(B.groundBoard && (B.groundBoard.type === 'mplat' || B.groundBoard.type === 'elev')){
          const cb = B.groundBoard;
          return brain.finish(Math.max(-0.4, Math.min(0.4, (cb.x - B.pos.x)*0.6)), 0.12, false, false);
        }
        // not jumpable from here: wait for a carrier (moving platform)
        const plat = findCarrier(API, B);
        if(plat && plat.type === 'mplat'){
          const dxp = plat.x - B.pos.x;
          mx = Math.abs(dxp) > 0.5 ? Math.sign(dxp)*0.85 : 0;
          const dzp = plat.z - B.pos.z;
          mz = (dzp < 2.0 && Math.abs(dxp) < 1.6) ? 1 : 0;
          return brain.finish(mx, mz, false, false);
        }
        // too slow / too far: build a runway — creep back ONLY when almost on
        // top of the edge at a crawl; otherwise charge to build speed (the
        // range check re-runs every replan and unlocks once speed is high)
        mx = Math.max(-0.4, Math.min(0.4, -B.pos.x*0.2));
        if(physEdge - B.pos.z < 1.2 && sp < 2.6 &&
           API.groundAt(B.pos.x, B.pos.z-0.9, B.pos.y+0.5).y > -1){
          return brain.finish(mx, -0.9, false, false);   // retreat for speed
        }
        return brain.finish(mx, 1, false, false);          // charge the edge
      }

      // --- low obstacle hop (roller / glove) directly ahead ---
      if(B.grounded){
        const px = B.pos.x + mx*0.95, pz = B.pos.z + mz*0.95;
        for(const c of API.RT.solids){
          if(c.min.x > 1e8) continue;
          if((c.tag === 'roller' || (c.tag === 'punch' && (c._ext||0) > 0.4)) && c.max.y < 1.9){
            if(px > c.min.x-0.5 && px < c.max.x+0.5 && pz > c.min.z-0.5 && pz < c.max.z+0.5){
              jump = true; break;
            }
          }
        }
      }

      // ===== FAN RIDE: hovering in an updraft in front of a wall =====
      // Walk-in lifts automatically, but charging in at speed exits the far
      // side of the column before clearing the wall — feather the entry,
      // hover inside until high, and retreat back into the column if we
      // overshot onto the wall face.
      let wallNear = null;
      for(const c of API.RT.solids){
        if(c.tag !== 'wallblk' || c.min.x > 1e8) continue;
        if(B.pos.z < c.min.z && c.min.z - B.pos.z < 1.4 &&
           B.pos.x > c.min.x-0.5 && B.pos.x < c.max.x+0.5){
          wallNear = c; break;
        }
      }
      if(wallNear && B.pos.y < wallNear.max.y + 0.2){
        // pressed against the wall too low — back up toward the fan column
        return brain.finish(Math.max(-0.3, Math.min(0.3, -B.pos.x*0.2)), -0.85, false, false);
      }
      const fh = API.fanAt(B.pos.x, B.pos.z) || API.fanAt(B.pos.x, B.pos.z+1.2) || API.fanAt(B.pos.x, B.pos.z+2.4);
      if(fh){
        let wallTop = 0, wallAhead = false;
        for(const c of API.RT.solids){
          if(c.tag !== 'wallblk' || c.min.x > 1e8) continue;
          if(B.pos.z < c.min.z && c.min.z - B.pos.z < 3.8 &&
             B.pos.x > c.min.x-0.4 && B.pos.x < c.max.x+0.4){
            wallAhead = true; wallTop = Math.max(wallTop, c.max.y);
          }
        }
        if(wallAhead){
          if(B.pos.y < wallTop + 0.45 && B.grounded && API.fanAt(B.pos.x, B.pos.z)){
            // inside the column, still low — hover (the updraft does the work)
            return brain.finish(Math.max(-0.3, Math.min(0.3, -B.pos.x*0.2)), 0.03, false, false);
          }
          if(B.pos.y < wallTop + 0.45){
            // approaching the lift — enter slowly so momentum doesn't carry
            // us out the far side before we've risen
            return brain.finish(Math.max(-0.3, Math.min(0.3, -B.pos.x*0.2)), 0.22, false, false);
          }
          return brain.finish(0, 1, false, false);   // high enough — drift over
        }
      }

      // --- hazard holding: whacky collider right in the path, close ---
      // (with a patience timer: after blocking ~1.2s, commit to a burst
      // through the sweep — eating one whack beats freezing forever)
      let danger = 0;
      {
        const px = B.pos.x + mx*1.25, pz = B.pos.z + mz*1.25;
        for(const c of API.RT.solids){
          if(c.min.x > 1e8) continue;
          const th = tagThreat(c.tag, c);
          if(!th) continue;
          if(px > c.min.x-0.5 && px < c.max.x+0.5 && pz > c.min.z-0.5 && pz < c.max.z+0.5 &&
             c.min.y < B.pos.y + 1.25 && c.max.y > B.pos.y + 0.05){
            danger = Math.max(danger, th);
          }
        }
      }
      // sweep-zone patience: near rotors/mills/crushers the danger flickers,
      // so count TIME IN ZONE (not just instantaneous danger); after ~2s,
      // burst the whole band when the near field is clear (or force at 4s)
      let nearSweep = false;
      for(const c of API.RT.solids){
        if(c.min.x > 1e8) continue;
        if(c.tag !== 'rotor' && c.tag !== 'mill' && c.tag !== 'crush') continue;
        if(B.pos.z + 4.2 > c.min.z && B.pos.z < c.max.z + 1.2 &&
           B.pos.x > c.min.x - 4.2 && B.pos.x < c.max.x + 4.2){
          nearSweep = true; break;
        }
      }
      if(danger > 0.85 || nearSweep) brain.blockT += dt;
      else brain.blockT = Math.max(0, brain.blockT - dt*3);
      if(brain.blockT > 2.0){
        let clearNow = true;
        for(const c of API.RT.solids){
          if(c.min.x > 1e8) continue;
          if(!tagThreat(c.tag, c)) continue;
          if(B.pos.x > c.min.x-0.5 && B.pos.x < c.max.x+0.5 &&
             B.pos.z+1.0 > c.min.z-0.3 && B.pos.z < c.max.z+0.5 &&
             c.min.y < B.pos.y + 1.25 && c.max.y > B.pos.y + 0.05){
            clearNow = false; break;
          }
        }
        if(clearNow || brain.blockT > 4.0){ brain.chargeT = 1.1; brain.blockT = 0; }
      }
      if(brain.chargeT > 0){
        brain.chargeT -= dt;
        return brain.finish(Math.max(-0.5, Math.min(0.5, -B.pos.x*0.2)), 1, false, false);
      }
      if(!jump){
        if(danger > 1.1) mz *= 0.22;
        else if(danger > 0.6) mz *= 0.55;
      }

      // --- disc riding: push outward-forward so the spin doesn't dump us ---
      if(B.groundBoard && B.groundBoard.type === 'disc'){
        const b = B.groundBoard;
        const dx = B.pos.x - b.cx, dz = B.pos.z - b.cz;
        const d = Math.max(0.3, Math.hypot(dx, dz));
        mx = mx*0.5 + (dx/d)*0.55;
        mz = Math.max(mz, 0.55);
      }

      // --- stuck watchdog ---
      const spd = Math.hypot(B.vel.x, B.vel.z);
      brain.stuck = spd < 0.4 && mz > 0.3 ? brain.stuck + dt : 0;
      if(brain.stuck > 1.4){
        brain.sideT = 0.5;
        brain.sideDir = rng() < 0.5 ? -1 : 1;
        brain.stuck = 0;
      }
      // global stall breaker: barely moved for 4s anywhere → retreat + sidestep
      brain.stallT += dt;
      if(brain.stallT > 4){
        const moved = Math.hypot(B.pos.x - brain.stallX, B.pos.z - brain.stallZ);
        if(moved < 1.2 && !r.finished){
          brain.sideT = 0.7;
          brain.sideDir = B.pos.x < 0 ? 1 : -1;
          brain.chargeT = 0.9;   // and punch forward through whatever it is
          brain.blockT = 0;
        }
        brain.stallT = 0; brain.stallX = B.pos.x; brain.stallZ = B.pos.z;
      }
      if(brain.sideT > 0){
        brain.sideT -= dt;
        mx = brain.sideDir * 0.9;
        mz = 0.45;
      }

      // --- finish-line flourish: occasional dive ---
      const L = window.LEVELS[S.levelIdx];
      if(L && B.pos.z > L.ring[0][2] - 10 && B.upright && B.grounded && rng() < dt*0.5){
        dive = true;
      }
      return brain.finish(mx, mz, jump, dive);
    },
    finish(mx, mz, jump, dive){
      const l = Math.hypot(mx, mz) || 1;
      return {mx:mx/l, mz:mz/l, jump, dive};
    }
  };
  return brain;
}

// find a moving platform ahead that can carry us over the void
// (discs need no waiting — their landing zone is static, handled by gap mode)
function findCarrier(API, B){
  let best = null, bestD = 1e9;
  for(const b of API.RT.boards){
    if(b.disabled || b.type !== 'mplat') continue;
    const dz = b.z - B.pos.z;
    if(dz > -0.5 && dz < 9 && Math.abs(b.x - B.pos.x) < 3.6){
      const d = Math.abs(dz) + Math.abs(b.x - B.pos.x)*0.5;
      if(d < bestD){ bestD = d; best = b; }
    }
  }
  return best;
}

window.SRR_AI = {
  botInfo(i){ return {name:NAMES[i % NAMES.length], color:COLORS[i % COLORS.length], skill: 0.72 + Math.random()*0.33}; },
  createBrain
};
})();
