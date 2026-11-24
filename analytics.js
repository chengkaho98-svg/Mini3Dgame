// ================= SUGAR RUSH ROYALE — analytics.js =================
// Live race analytics. Reads racer state (read-only) a few times a second and
// produces, for every racer:
//   win%  — a calibrated score of "how likely is this one to win from here"
//   form  — short-term momentum (speed trend, recent tumbles)
//   events — notable things that just happened (feeds the AI commentator)
// Nothing here touches physics or game flow; main.js polls it for the HUD.
//
// The win score is deliberately simple and interpretable (no ML): racers are
// ranked by how far ahead they are relative to the field, damped by how
// error-prone they have been, then squashed through a softmax so the field
// always sums to 100%.
(function(){
'use strict';

const SAMPLE_DT = 0.25;        // seconds between samples
const SPEED_WIN = 2.0;         // window (s) for the speed estimate
const FALL_DECAY = 0.045;      // per-fall penalty, fading over ~22s
const LEAD_GAIN = 5.2;         // how strongly being ahead translates to win%
const FOCUS_GAIN = 1.3;        // pace vs the field's pace

const A = {
  racers: new Map(),           // racer -> per-racer analytics record
  time: 0, acc: 0,
  events: [],                  // recent notable events (ring buffer)
  history: [],                 // per-sample snapshot of leader/win% (for the LLM)
  lastProgress: new Map(),
  enabled: true
};
window.SRR_ANALYTICS = A;

function rec(r){
  let x = A.racers.get(r);
  if(!x){
    x = { speed: 0, speedSamples: [], fallsSeen: 0, fallPenalty: 0, falls: 0,
          lastZ: r.body.pos.z, lastT: 0, tumbles: 0, downed: false,
          win: 0, form: 0, peakWin: 0, streak: 0 };
    A.racers.set(r, x);
  }
  return x;
}

A.reset = function(){
  A.racers.clear(); A.events.length = 0; A.history.length = 0;
  A.lastProgress.clear(); A.time = 0; A.acc = 0; lastEventAt.clear(); A.lastLeader = null;
};

const EVENT_PRIO = { finish: 5, lead: 4, fall: 3, boostJump: 2, tumble: 1 };
const EVENT_COOLDOWN = { tumble: 6, fall: 3, lead: 4, finish: 0, boostJump: 5 };
const lastEventAt = new Map();          // "kind|name" -> time of last emission

function pushEvent(kind, r, extra){
  const key = kind + '|' + (r ? r.name : '');
  const cd = EVENT_COOLDOWN[kind] === undefined ? 4 : EVENT_COOLDOWN[kind];
  if(cd > 0 && A.time - (lastEventAt.get(key) || -99) < cd) return;   // same thing again too soon
  lastEventAt.set(key, A.time);
  const e = { t: +A.time.toFixed(1), kind, prio: EVENT_PRIO[kind] || 1,
              name: r ? r.name : '', human: !!(r && r.kind === 'human'), extra: extra || '' };
  A.events.push(e);
  if(A.events.length > 40){
    // evict the OLDEST lowest-priority item, not simply the oldest
    let worst = 0;
    for(let i = 1; i < A.events.length; i++){
      if(A.events[i].prio < A.events[worst].prio) worst = i;
    }
    A.events.splice(worst, 1);
  }
}
A.pushEvent = pushEvent;

// Called once per rendered frame with the live racer list.
A.update = function(racers, S, dt){
  if(!A.enabled || !racers || !racers.length) return;
  if(S.phase !== 'race'){ A.acc = 0; return; }
  A.time += dt;
  A.acc += dt;
  if(A.acc < SAMPLE_DT) return;
  const step = A.acc; A.acc = 0;
  const L = window.LEVELS[S.levelIdx];
  const z0 = L.spawn[2], z1 = L.ring[0][2], span = Math.max(1, z1 - z0);
  const remaining = Math.max(0, S.tLeft);

  let sumProg = 0, sumSpeed = 0, alive = 0;
  for(const r of racers){
    const x = rec(r);
    const prog = Math.min(1.15, Math.max(0, (r.body.pos.z - z0) / span));
    x.prog = prog;
    x.finished = r.finished;
    // speed over the sample window (m/s along the track)
    const v = (r.body.pos.z - x.lastZ) / Math.max(1e-3, step);
    x.lastZ = r.body.pos.z;
    x.speedSamples.push({ v, t: A.time });
    while(x.speedSamples.length && A.time - x.speedSamples[0].t > SPEED_WIN) x.speedSamples.shift();
    let sv = 0; for(const s of x.speedSamples) sv += s.v;
    x.speed = sv / Math.max(1, x.speedSamples.length);
    // falls
    if(r.falls > x.fallsSeen){
      const n = r.falls - x.fallsSeen;
      x.fallsSeen = r.falls;
      x.fallPenalty = Math.min(0.9, x.fallPenalty + n * FALL_DECAY);
      pushEvent('fall', r, n > 1 ? 'x' + n : '');
    }
    x.fallPenalty *= Math.pow(0.955, step / SAMPLE_DT);   // fade out
    // tumbles (knocked over)
    if(!r.body.upright && !x.downed){ x.tumbles++; pushEvent('tumble', r); }
    x.downed = !r.body.upright;
    // boost-pad launch (detect from the boost cooldown being re-armed)
    if(r.body.boostCd !== undefined){
      if(x.lastBoostCd !== undefined && r.body.boostCd > x.lastBoostCd + 0.5) pushEvent('boostJump', r);
      x.lastBoostCd = r.body.boostCd;
    }
    // finishing
    if(r.finished && !x.reported){
      x.reported = true;
      pushEvent('finish', r, '#' + r.finishRank + ' ' + r.finishTime.toFixed(1) + 's');
    }
    if(!r.finished){ sumProg += prog; sumSpeed += x.speed; alive++; }
  }
  // --- win score -------------------------------------------------------
  // "win" = chance of finishing with the BEST final position among the racers
  // still running. Racers who already crossed the line have a fixed place and
  // are excluded from the distribution (their bar shows 100% / "done").
  // Score = lead over the remaining field's mean progress (weighted more as
  // the race goes on, since there is less track left to close a gap)
  //        + pace relative to the field
  //        - a fading penalty for recent falls.
  const meanProg = alive ? sumProg / alive : 0;
  const meanSpeed = alive ? sumSpeed / alive : 0;
  const open = [];                       // { r, x, score }
  for(const r of racers){
    const x = A.racers.get(r);
    if(!x) continue;
    if(r.finished) continue;
    const lead = x.prog - meanProg;
    const pace = (x.speed - meanSpeed) / Math.max(1.5, meanSpeed);
    // remaining track (0..1): a 10m lead with 100m to go matters less than
    // the same lead with 10m to go
    const urgency = 1 + 4.0 * x.prog;
    x.score = LEAD_GAIN * lead * urgency + FOCUS_GAIN * pace - 2.6 * x.fallPenalty;
    open.push({ r, x, score: x.score });
  }
  // softmax over the still-running racers -> percentages summing to 100.
  // The temperature widens with how much track is left: early on nobody is
  // out of it (the leader shows a modest edge, the tail still has a real
  // chance), and it tightens as the finish approaches. A fixed sharp
  // temperature made 5 of 8 racers read "0%" a few seconds after the start.
  const meanProgOpen = open.length ? open.reduce((a, o) => a + o.x.prog, 0) / open.length : 0;
  const temp = 0.5 + 1.6 * (1 - Math.min(1, meanProgOpen));
  let mx = -Infinity; for(const o of open) mx = Math.max(mx, o.score);
  let sum = 0;
  for(const o of open){ o.e = Math.exp((o.score - mx) / temp); sum += o.e; }
  // Once anybody has crossed the line, nobody still running can finish first:
  // the win chance among the open racers only exists while the race is still
  // undecided (no finisher yet). After that the open racers' bars decay to 0.
  const anyFinished = racers.some(r => r.finished);
  for(const r of racers){
    const x = A.racers.get(r); if(!x) continue;
    let target;
    if(r.finished){
      target = (r.finishRank === 1) ? 100 : 0;        // the winner keeps 100%
    } else {
      const o = open.find(k => k.r === r);
      target = o ? 100 * o.e / Math.max(1e-9, sum) : 0;
      if(anyFinished) target = 0;                     // first place is gone
    }
    // smooth so the bar doesn't flicker sample to sample
    x.win += (target - x.win) * (r.finished ? 1 : 0.35);
    x.form = x.speed - meanSpeed;
    if(x.win > x.peakWin) x.peakWin = x.win;
  }
  // leader change event
  let leader = null, best = -1;
  for(const r of racers){ const x = A.racers.get(r); if(x && !r.finished && x.prog > best){ best = x.prog; leader = r; } }
  if(leader && leader !== A.lastLeader){
    if(A.lastLeader) pushEvent('lead', leader, 'takes the lead');
    A.lastLeader = leader;
  }
  // history for the commentator: one compact line per sample
  A.history.push({ t: +A.time.toFixed(1), lead: leader ? leader.name : '', gap: +Math.max(0, best - meanProg).toFixed(3) });
  if(A.history.length > 40) A.history.shift();
};

// Sorted standings with win% (what the HUD and the LLM consume).
A.standings = function(racers){
  return racers.map(r => {
    const x = A.racers.get(r) || {};
    return { r, name: r.name, human: r.kind === 'human', win: x.win || 0, prog: x.prog || 0,
             speed: x.speed || 0, form: x.form || 0, falls: r.falls, finished: r.finished,
             finishRank: r.finishRank, color: r.colorHex };
  }).sort((a, b) => {
    if(a.finished && b.finished) return a.finishRank - b.finishRank;
    if(a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.win - a.win;
  });
};

// Plain-language snapshot for the local LLM commentator.
A.briefing = function(racers){
  const st = A.standings(racers);
  const L = window.LEVELS[window._S ? window._S.levelIdx : 0];
  // most relevant events for a commentator: the newest high-priority ones first
  const recent = A.events.slice()
    .sort((a, b) => (b.prio - a.prio) || (b.t - a.t)).slice(0, 6)
    .sort((a, b) => a.t - b.t)
    .map(e => {
    const who = e.human ? e.name + '(你)' : e.name;
    if(e.kind === 'fall') return who + ' 跌落水' + (e.extra ? ' ' + e.extra + '次' : '');
    if(e.kind === 'tumble') return who + ' 被撞跌';
    if(e.kind === 'finish') return who + ' 衝線 ' + e.extra;
    if(e.kind === 'lead') return who + ' 取得領先';
    if(e.kind === 'boostJump') return who + ' 飛躍斷橋';
    return who + ' ' + e.kind;
  });
  return {
    level: L ? L.name : '',
    timeLeft: window._S ? Math.round(window._S.tLeft) : 0,
    racers: st.map((s, i) => ({
      name: s.name, human: s.human, pos: i + 1, win: Math.round(s.win),
      progress: Math.round(Math.min(1, s.prog) * 100), falls: s.falls,
      finished: s.finished, rank: s.finished ? s.finishRank : null
    })),
    recentEvents: recent
  };
};
})();
