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
    replanT: 0, lastDir: 0, stuck: 0, sideT: 0, sideDir: 0, blockT: 0, chargeT: 0, waitT: 0, leapT: 0, pulse: 0, why: '', dbg: null,
    stallT: 0, stallX: 0, stallZ: 0,
    think(r, S, API, dt){
      const B = r.body;
      B.speedMul = 0.86 + skill*0.16;
      // downed: let the get-up timer work; crawl gently forward
      // downed: let the get-up timer work; crawl gently forward — unless the
      // crawl would take us over an edge
      if(!B.upright){
        const edgeNear = API.groundAt(B.pos.x, B.pos.z + 1.3, B.pos.y + 0.45).y < -1;
        return {mx:0, mz: edgeNear ? -0.3 : 0.35, jump:false, dive:false};
      }

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
      // PAD AIM: only when a bounce pad is THE way across a drop — i.e. the
      // pad sits on solid ground and the road ends within 2.5m past it.
      // (Island bounce chains are excluded: there the pad is the landing spot
      // of a jump, not a walk-on launcher, and hijacking the controller there
      // stops the bot from ever jumping.)
      let padAim = null;
      for(const b of API.RT.boards){
        if(!b.bounce || b.disabled) continue;
        if(b.z > B.pos.z + 0.5 && b.z - B.pos.z < 6 && Math.abs(b.x - B.pos.x) < 3.2){
          // ground must continue for ~1m before the pad (walk-on, not an island)
          const groundBefore = API.groundAt(b.x, b.z - b.hz - 0.8, b.y + 0.6).y > -1;
          // and must end shortly after it
          let endsAfter = false;
          for(let z = b.z + b.hz; z < b.z + b.hz + 2.5; z += 0.25){
            if(API.groundAt(b.x, z, b.y + 0.6).y < -1){ endsAfter = true; break; }
          }
          if(groundBefore && endsAfter && (!padAim || b.z < padAim.z)) padAim = b;
        }
      }
      // walk-on launcher ahead: line up with it. Ground only — once we
      // are airborne (bounce-island chains) the flight controller decides.
      if(padAim && B.grounded && B.pos.z < padAim.z + padAim.hz){
        // damped aim: converge on the pad's centre line without carrying
        // sideways speed into the launch
        const mxAim = Math.max(-0.9, Math.min(0.9, (padAim.x - B.pos.x)*1.6 - B.vel.x*0.3));
        return brain.finish(mxAim, Math.max(0.35, Math.sqrt(Math.max(0.1, 1 - mxAim*mxAim))), false, false);
      }
      let physEdge = null, lastHad = true;
      for(let z = B.pos.z + 0.3; z < B.pos.z + 7.5; z += 0.25){
        const has = API.groundAt(B.pos.x, z, B.pos.y + 0.45).y > -1;
        if(lastHad && !has){ physEdge = z - 0.125; break; }
        lastHad = has;
      }
      if(physEdge !== null && physEdge - B.pos.z < 5.5){
        const C = window.SRR_CONST || {JUMP_V:11.2, GRAV:34, MAX_SPD:6.2};
        const V = C.JUMP_V, G = C.GRAV;
        // airtime of a full jump from our feet down to a landing 'dh' above us
        // (negative = landing lower, which buys extra distance). 0 = too high.
        const arcFor = dh => { const d = V*V - 2*G*(dh + 0.04); return d > 0 ? (V + Math.sqrt(d))/G : 0; };
        const topSpd = C.MAX_SPD * (B.speedMul || 1);
        const edge = physEdge - B.pos.z;
        const fanned = API.fanAt(B.pos.x, physEdge + 1.2);
        const boosted = !fanned && API.RT.boards.some(b => b.boost && !b.disabled && b.z > B.pos.z - 1.5 && Math.abs(b.z - physEdge) < 5.5);

        // --- updraft or launch pad carries us across: run straight in ---
        if(fanned || boosted){
          mx = Math.max(-0.45, Math.min(0.45, -B.pos.x*0.25));
          mz = Math.sqrt(Math.max(0.15, 1 - mx*mx));
          if(((boosted && edge < 1.3) || edge < Math.max(0.38, sp*0.1)) && B.grounded && !fanned) jump = true;
          return brain.finish(mx, mz, jump, false);
        }

        // first standable surface beyond the edge, along the lane at x
        const landingAt = x => {
          for(let z = physEdge + 0.2; z < physEdge + 6.5; z += 0.3){
            const g = API.groundAt(x, z, B.pos.y + 2.8);
            if(g.y > -1) return { z, board: g.board };
          }
          return null;
        };
        const gb = B.groundBoard;
        const onDisc = !!(gb && gb.type === 'disc');
        const onTile = !!(gb && gb.type === 'tile');
        const carrier = gb && (gb.type === 'mplat' || gb.type === 'elev') ? gb : null;

        // A lane whose landing we can reach. Feasibility is measured to the
        // NEAR side of the landing: aiming deep into a small pad (the old
        // rule) made every disc read as "unjumpable", and the bot then
        // charged straight off the edge.
        const laneFor = (x, dx) => {
          const l = landingAt(x);
          if(!l) return null;
          // plain road comes back with no board object (its surface is y = 0)
          const t = arcFor((l.board ? l.board.y : 0) - B.pos.y);
          if(t <= 0) return null;
          const near = l.z - 0.15;
          // a ferry that is receding will have moved on by the time we land
          const vAway = l.board && l.board.type === 'mplat' ? Math.max(0, (l.board._dz || 0) / Math.max(1e-3, dt)) : 0;
          // 0.5 = take-off slack + the minimum clearance we insist on
          const need = Math.max(0.3, near - physEdge) + 0.5 + vAway*t*0.9;
          if(topSpd*t < need) return null;
          // far end of the landing surface, for the overshoot guard
          let end = l.z;
          if(l.board && l.board.type === 'disc') end = l.board.cz + l.board.r*0.9;
          else if(l.board) end = l.board.z + l.board.hz;
          else{
            // road: runs until the next void or the next raised platform
            // (flat pads on the road do not interrupt it)
            while(end < l.z + 14){
              const g = API.groundAt(x, end + 0.25, B.pos.y + 0.45);
              if(g.y < -1 || (g.board && g.board.type)) break;
              end += 0.25;
            }
          }
          return { t, near, end, board: l.board, mx: dx === 0 ? Math.max(-0.45, Math.min(0.45, -B.pos.x*0.25)) : Math.max(-0.8, Math.min(0.8, dx*0.9)) };
        };
        let lane = laneFor(B.pos.x, 0);
        if(!lane){
          // straight ahead is out of reach: try the nearest side lane (a tile
          // bridge with holes, a disc off our line)
          const [rx0, rx1] = API.roadXAt(B.pos.z);
          for(const dx of [0.65, -0.65, 1.3, -1.3, 1.95, -1.95, 2.6, -2.6]){
            const x2 = B.pos.x + dx;
            if(x2 < rx0 + 0.4 || x2 > rx1 - 0.4) continue;
            if(API.groundAt(x2, Math.min(physEdge - 0.3, B.pos.z + 0.5), B.pos.y + 0.45).y < -1) continue;
            lane = laneFor(x2, dx);
            if(lane) break;
          }
        }
        if(lane){
          const { t, near, end } = lane;
          let lx = lane.mx, lz = Math.sqrt(Math.max(0.15, 1 - lx*lx));
          if(lane.board && lane.board.type === 'disc'){
            lx = Math.max(-0.6, Math.min(0.6, (lane.board.cx - B.pos.x)*0.5));
            lz = Math.sqrt(Math.max(0.15, 1 - lx*lx));
          }
          // counter the disc's tangential drift while riding it
          if(onDisc){
            const tx = -(B.pos.z - gb.cz) * (gb.omega||0);
            lx = Math.max(-0.7, Math.min(0.7, lx - tx*0.4));
            lz = Math.sqrt(Math.max(0.2, 1 - lx*lx));
          }
          // (A jump under pressure is taken without an air dive: the dive adds
          //  5.6 m/s, and a 12 m/s bot shoves whoever is ahead straight into
          //  the next gap. brain.leapT stays 0.)
          if(brain.leapT > 0){
            brain.leapT -= dt;
            if(brain.leapT <= 0){
              brain.leapT = 0;
              if(!B.grounded) return { mx: lx, mz: lz, jump: false, dive: true };
            }
          }

          // WHERE to come down. A bounce pad is aimed at its centre so the
          // chain keeps going through the next launch; a pad that bobs,
          // travels or spins is aimed at its centre too (it moves while we
          // are in the air). Anything else: as far onto it as the jump can
          // reach — the more of the arc left after the near side, the safer.
          const lo = near + 0.35, hi = end - 0.35;
          let centre = null;
          if(lane.board){
            const b = lane.board;
            const pad = b.type === 'disc' || b.type === 'elev' || b.type === 'mplat' ||
              API.RT.boards.some(p => p !== b && p.bounce && !p.disabled && Math.abs(p.x - b.x) < 0.3 && Math.abs(p.z - b.z) < (b.hz||1)*0.5);
            if(pad) centre = b.type === 'disc' ? b.cz : b.z;
          }
          const aim = pred => centre !== null ? Math.max(lo, Math.min(hi, centre)) : Math.max(lo, Math.min(hi, pred));

          if(!B.grounded){
            // IN FLIGHT. Work out where the arc comes down and steer the
            // horizontal speed so that point is a good landing spot. The
            // surface under that point is NOT the lane found from the edge
            // scan (that one lies beyond it), so the standable stretches
            // along our line are listed here from scratch, and we pick the
            // one that needs the least change to our current speed: a bot
            // that arrives too fast simply flies on to the next pad.
            // Forward input is always NORMALISED — the physics caps speed
            // along the input direction, so a short intent would let the
            // bot run past its own limit.
            // landable = at or below the top of our arc (we may still be rising)
            const apex = B.pos.y + Math.max(0, B.vel.y*B.vel.y/(2*G));
            const ivs = [];                              // [from, to, surfaceY, board]
            let ia = null, iay = 0, iab = null, izLast = B.pos.z;
            for(let z = B.pos.z + 0.3; z < B.pos.z + 9; z += 0.25){
              const g = API.groundAt(B.pos.x, z, apex + 0.05);       // only surfaces the arc can come down on
              if(g.y > -1){ if(ia === null){ ia = z; iay = g.y; iab = g.board; } }
              else if(ia !== null){ ivs.push([ia - 0.12, z - 0.13, iay, iab]); ia = null; }
              izLast = z;
            }
            if(ia !== null) ivs.push([ia - 0.12, izLast, iay, iab]);
            const vz = Math.max(0, B.vel.z);
            const vTop = Math.max(topSpd, vz);
            let best = null;
            ivs.forEach((iv, idx) => {
              if(apex < iv[2] - 0.02) return;           // above the top of our arc: unreachable
              const b = iv[3];
              const isPad = !!b && (b.type === 'disc' || b.type === 'elev' || b.type === 'mplat' ||
                API.RT.boards.some(p => p !== b && p.bounce && !p.disabled && Math.abs(p.x - b.x) < 0.3 && Math.abs(p.z - b.z) < (b.hz||1)*0.5));
              const lo = iv[0] + 0.35;
              // a plain platform: before a long next gap, land as close to its
              // far edge as is safe (the next jump needs every metre); before a
              // short one leave room for the run-up
              const gapAfter = ivs[idx + 1] ? ivs[idx + 1][0] - iv[1] : 0;
              const hi = iv[1] - (b && !isPad ? (gapAfter > 2.2 ? 0.25 : 0.6) : 0.35);
              if(B.pos.z > hi) return;                   // even standing still we are past it
              const tr = (B.vel.y + Math.sqrt(Math.max(0, B.vel.y*B.vel.y + 2*G*(B.pos.y - iv[2])))) / G;
              let want = Math.max(lo, Math.min(hi, B.pos.z + vz*tr));
              if(isPad) want = Math.max(lo, Math.min(hi, b.type === 'disc' ? b.cz : b.z));
              const vNeed = (want - B.pos.z)/tr;
              if(vNeed > vTop + 0.3){
                // more speed than we have: only an air dive gets us there, and
                // a dive is a last resort (it makes the bot a projectile)
                return;                                 // (no air dives: see leapT below)
              }
              const cost = Math.abs(vNeed - vz) + idx*0.15;
              if(!best || cost < best.cost) best = { want, tr, lo, cost, dive: false, idx, cx: b ? (b.type === 'disc' ? b.cx : b.x) : null };
            });
            brain.dbg = { n: ivs.length, best, vz, z: B.pos.z, y: B.pos.y, vy: B.vel.y };
            if(!best){ brain.why = 'fly'; return brain.finish(lx, Math.max(0.6, lz), false, false); }
            // sideways: line up with the middle of what we land on and kill
            // sideways speed (pads and islands are only ~3m wide)
            const [rx0, rx1] = API.roadXAt(B.pos.z);
            const cx = best.cx === null ? Math.max(rx0 + 0.8, Math.min(rx1 - 0.8, B.pos.x)) : best.cx;
            const sx = Math.max(-0.8, Math.min(0.8, (cx - B.pos.x)*0.9 - B.vel.x*0.4));
            const p = B.pos.z + vz*best.tr;              // where we come down at this speed
            if(p > best.want + 0.2){
              if(B.pos.z + Math.max(0, vz - 0.5)*best.tr >= best.lo - 0.1){ brain.why = 'flyBrake'; return { mx: sx, mz: -0.7, jump: false, dive: false }; }
              brain.why = 'flyHold';
              return { mx: sx, mz: 0, jump: false, dive: false };
            }
            if(p < best.want - 0.2){ brain.why = 'flyGo'; return brain.finish(sx, Math.max(0.6, lz), false, false); }
            brain.why = 'flyCoast';
            return { mx: sx, mz: 0, jump: false, dive: false };
          }

          // ON THE GROUND
          // A whacking obstacle right in front of us on the way to the take-off:
          // wait until it has swung clear (never while standing on a tile or a
          // carrier — those do not wait for us).
          if(B.grounded && edge > 1.2 && !onTile && !carrier){
            // A pendulum guards this take-off: cross its swing only while the
            // ball is near the end of its arc (it needs over a second to come
            // back; the crossing takes about half). Until then wait behind its reach.
            for(const c of API.RT.solids){
              if(c.min.x > 1e8 || c.tag !== 'pend' || c.max.z <= B.pos.z || c.min.z >= physEdge) continue;
              const cx = (c.min.x + c.max.x)/2;
              if(B.pos.z < c.min.z - 1.5 && Math.abs(cx) < 2.6){
                brain.why = 'waitPendulum';
                return { mx: lx*0.3, mz: B.pos.z < c.min.z - 1.9 ? 0.35 : 0, jump: false, dive: false };
              }
            }
            const hx = B.pos.x, hz = B.pos.z + 1.25;
            for(const c of API.RT.solids){
              if(c.min.x > 1e8 || tagThreat(c.tag, c) < 0.9) continue;
              if(B.pos.z < c.min.z - 1.0 &&                        // only while still behind it
                 hx > c.min.x - 0.5 && hx < c.max.x + 0.5 && hz > c.min.z - 0.5 && hz < c.max.z + 0.5 &&
                 c.min.y < B.pos.y + 1.25 && c.max.y > B.pos.y + 0.05){ brain.why = 'waitHazard'; return { mx: lx*0.3, mz: 0, jump: false, dive: false }; }
            }
          }
          const jumpZ = physEdge - 0.25;                 // where we leave the ground
          if(edge < 1.0) lx *= 0.3;                      // close to the edge, forward is what matters
          lz = Math.sqrt(Math.max(0.15, 1 - lx*lx));
          const fwd = sp * lz;                           // speed along our heading
          const pred = jumpZ + fwd * t;                  // where a jump from here would come down
          // Run-up speed whose jump lands on the aim point: the centre of a
          // pad (a bounce chain keeps its speed through the next launch) or
          // of a pad that moves; anything else as far as a full-speed jump
          // reaches — unless that would fly past the landing into nothing,
          // then the aim point (already inside its far end).
          let vTarget = Math.min(topSpd, Math.max(0.8, (aim(jumpZ + topSpd*t) - jumpZ) / t));
          const isPadLanding = centre !== null;
          if(!isPadLanding && API.groundAt(B.pos.x, jumpZ + topSpd*t, B.pos.y + 2.8).y > -1) vTarget = topSpd;
          if(fwd > vTarget + 0.15){
            const brakeDist = (fwd*fwd - vTarget*vTarget) / (2*46);    // MOVE_ACC
            // regulate only once we are inside braking range — and on a tile as
            // late as possible: lingering on one tile lets it drop under us
            if(edge < brakeDist + (onTile ? 0.22 : 0.6) && edge > brakeDist + 0.1){
              if(edge > 1.0) return brain.finish(lx, -1, false, false);    // room: slow down to the landing speed
              return { mx: lx*0.3, mz: -0.7, jump: false, dive: false };   // nearly there: bleed speed, stay ready to jump
            }
            if(pred > end - 0.2 && API.groundAt(B.pos.x, pred, B.pos.y + 2.8).y < -1){
              jump = true;                               // no room to slow down: leap
            }
          }
          // clearance a jump RIGHT NOW would have past the landing's near side
          const spare = fwd*t - (near - physEdge) - edge;
          if(!jump && spare >= 0.2 && edge <= Math.max(0.22, fwd*0.045)){
            jump = true;                                 // late take-off = most clearance
          } else if(!jump && spare < 0.2 && edge < 0.45){
            // too slow to clear it from here — and never just walk off.
            const canStop = fwd*fwd/(2*46) + 0.15 < edge;
            if(!canStop || onTile || fwd >= topSpd - 0.2){
              jump = true;                               // cannot stop in time / nothing to gain: leap
            }
            else if(API.groundAt(B.pos.x, B.pos.z - 0.9, B.pos.y + 0.5).y > -1) return brain.finish(lx, -0.9, false, false);   // step back for a run-up
            else return { mx: lx*0.3, mz: -0.2, jump: false, dive: false };                                              // no room behind: hold
          }
          return brain.finish(lx, lz, jump, false);
        }
        if(carrier){
          // not crossable from here yet. Hold near the middle of the platform
          // and re-check every step. Moves are short pulses of a NORMALISED
          // direction: a small un-normalised intent would sidestep the
          // run-speed cap, full input all the time would overshoot.
          const rx = carrier.x - B.pos.x, rz = carrier.z - B.pos.z;
          if(Math.abs(rx) <= 0.3 && Math.abs(rz) <= 0.4) return { mx: 0, mz: 0, jump: false, dive: false };
          brain.pulse = (brain.pulse + 1) % 6;
          if(brain.pulse) return { mx: 0, mz: 0, jump: false, dive: false };
          return brain.finish(Math.abs(rx) > 0.3 ? Math.sign(rx) : 0, Math.abs(rz) > 0.4 ? Math.sign(rz) : 0, false, false);
        }
        if(onTile){ brain.replanT = 0; return { mx: 0, mz: -0.2, jump: false, dive: false }; }   // let the direction sampler pick a way through
        if(!B.grounded){
          // airborne with nothing reachable ahead: usually a small hop after a
          // knock, still over solid ground. Bleed speed if the arc would come
          // down past the edge; otherwise leave the arc alone.
          brain.why = 'flyNoLane';
          const fall = (B.vel.y + Math.sqrt(Math.max(0, B.vel.y*B.vel.y + 2*G*Math.max(0, B.pos.y)))) / G;
          const landZ = B.pos.z + Math.max(0, B.vel.z)*fall + 0.4;
          const inFan = API.fanAt(B.pos.x, B.pos.z) || API.fanAt(B.pos.x, B.pos.z + 1.2) || API.fanAt(B.pos.x, B.pos.z + 2.4);
          if(inFan) return brain.finish(0, 1, false, false);          // floating in the updraft: keep going
          if(fall < 0.45 && API.groundAt(B.pos.x, landZ, B.pos.y + 0.5).y < -1) return { mx: 0, mz: -0.7, jump: false, dive: false };
          return { mx: 0, mz: 0, jump: false, dive: false };
        }
        brain.waitT += dt;

        // Nothing reachable in a straight line: wait for a ferry, or for a
        // tile bridge to regrow. Both always come back, so wait as long as
        // it takes — about 1.3m short of the drop (crowds shove), edged
        // there with short pulses so the bot actually comes to rest.
        const plat = findCarrier(API, B);
        const standX = Math.max(-0.4, Math.min(0.4, ((plat ? plat.x : 0) - B.pos.x)*0.2));
        // stand far enough back that nothing between us and the edge can reach us
        let standOff = 1.3;
        for(const c of API.RT.solids){
          if(c.min.x > 1e8 || tagThreat(c.tag, c) < 0.9) continue;
          // a sweeper covers the whole road even while it is swung away from us
          const sweeps = c.tag === 'pend' || c.tag === 'mill' || c.tag === 'rotor' || c.tag === 'roller';
          if(!sweeps && (c.min.x > B.pos.x + 1.0 || c.max.x < B.pos.x - 1.0)) continue;
          // 1.5 = collider reach + our body radius, plus a little
          if(c.max.z > B.pos.z - 1.6 && c.min.z < physEdge) standOff = Math.max(standOff, physEdge - c.min.z + 1.5);
        }
        const hold = () => {
          const err = edge - standOff;
          if(Math.abs(err) < 0.25) return { mx: 0, mz: 0, jump: false, dive: false };
          if(Math.abs(err) > 0.8) return brain.finish(standX, Math.sign(err), false, false);   // far from the spot: get there
          brain.pulse = (brain.pulse + 1) % 3;                                               // near it: edge in
          if(brain.pulse) return { mx: 0, mz: 0, jump: false, dive: false };
          return brain.finish(standX, Math.sign(err), false, false);
        };
        if(plat){
          const dzp = plat.z - B.pos.z, dxp = plat.x - B.pos.x;
          if(dzp < 2.0 && Math.abs(dxp) < 1.6){
            mx = Math.abs(dxp) > 0.5 ? Math.sign(dxp)*0.85 : 0;
            return brain.finish(mx, 1, false, false);   // it is here: walk on
          }
          return hold();
        }
        const tilesAhead = API.RT.boards.some(b => b.type === 'tile' && b.z > B.pos.z && b.z < physEdge + 6.5);
        if(tilesAhead || brain.waitT < 2.5) return hold();
        if(edge < 0.3 && B.grounded){ brain.waitT = 0; jump = true; }        // last resort: leap rather than walk off
        return brain.finish(standX, 1, jump, false);
      }
      brain.waitT = 0;

      // --- low obstacle hop (an extended glove directly ahead; the big
      //     rolling balls are ~2m tall and cannot be jumped) ---
      if(B.grounded){
        const px = B.pos.x + mx*0.95, pz = B.pos.z + mz*0.95;
        for(const c of API.RT.solids){
          if(c.min.x > 1e8) continue;
          if(c.tag === 'punch' && (c._ext||0) > 0.4 && c.max.y < 1.9){
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
  botInfo(i){ return {name:NAMES[i % NAMES.length], color:COLORS[i % COLORS.length],
    skill: SRR_AI_SKILL !== null ? SRR_AI_SKILL : 0.72 + Math.random()*0.33}; },
  createBrain
};
// fixed bot skill for the regression suites (null = random, as in play)
let SRR_AI_SKILL = null;
window.SRR_AI.setSkill = function(s){ SRR_AI_SKILL = (typeof s === 'number') ? s : null; };
})();
