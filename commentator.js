// ================= SUGAR RUSH ROYALE — commentator.js =================
// AI race commentator. Every ~12s it asks the LOCAL LLM (through the dev
// server's /api/commentate proxy) for one line of Cantonese commentary based
// on the live briefing from analytics.js. Purely cosmetic: if the LLM is
// unreachable the game simply shows no commentary.
//
// Toggle: the "🎙 AI 評述" checkbox in the menu, or window.SRR_COMMENTATOR.on.
(function(){
'use strict';

const C = {
  on: false,                 // opt-in (needs the local model to be running)
  interval: 12,              // seconds between lines
  cooldownAfterFinish: 6,
  lastT: -99,
  lastLines: [],             // recent lines echoed back so the model avoids repeats
  inflight: false,
  endpoint: '/api/commentate',
  health: 'unknown',         // 'unknown' | 'ok' | 'down'
  onError: null
};
window.SRR_COMMENTATOR = C;

// speak the line with the browser's own TTS (optional, off by default)
C.voice = false;
function speak(text){
  if(!C.voice || !('speechSynthesis' in window)) return;
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-HK'; u.rate = 1.08; u.pitch = 1.15;
    speechSynthesis.speak(u);
  }catch(e){}
}

C.checkHealth = async function(){
  try{
    const r = await fetch('/api/llm/health', { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
    const j = await r.json();
    C.health = j.ok ? 'ok' : 'down';
    C.model = j.model;
  }catch(e){ C.health = 'down'; }
  return C.health;
};

// Called every frame from the main loop.
C.update = function(racers, S, dt){
  if(!C.on || !racers || !racers.length) return;
  if(S.phase !== 'race'){ C.lastT = -99; return; }
  // schedule on the world clock (always advances), gate on race time
  if(S.worldT - C.lastT < C.interval) return;
  if(C.inflight) return;
  const A = window.SRR_ANALYTICS;
  if(!A || !A.briefing) return;
  // don't ask in the first 2 seconds (nothing has happened yet)
  if(S.raceClock < 2) return;
  C.lastT = S.worldT;
  C.inflight = true;
  const briefing = A.briefing(racers);
  fetch(C.endpoint, {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ briefing, recent: C.lastLines.slice(-4) })
  }).then(r => r.json()).then(j => {
    C.inflight = false;
    if(j && j.text){
      C.lastLines.push(j.text);
      if(C.lastLines.length > 6) C.lastLines.shift();
      C.lastMs = j.ms;
      show(j.text);
      speak(j.text);
    }
  }).catch(()=>{ C.inflight = false; C.health = 'down'; });
};

// ---- on-screen ticker -------------------------------------------------
let box = null, hideTimer = null;
function show(text){
  if(!box){
    box = document.createElement('div');
    box.id = 'commentary';
    document.body.appendChild(box);
  }
  box.textContent = '🎙 ' + text;
  box.classList.remove('pop');
  void box.offsetWidth;              // restart the entrance animation
  box.classList.add('pop', 'show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(()=>box.classList.remove('show'), 8000);
}
})();
