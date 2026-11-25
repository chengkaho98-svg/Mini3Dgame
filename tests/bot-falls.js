#!/usr/bin/env node
// Dev tool (not part of `npm test`): where do bots still fall?
// Runs N races per level in a headless browser and prints, per level, the
// fall count per 4m of track, the worst bots and the finish times.
//   node tests/bot-falls.js [levels=1,2,3,4,5] [trials=2] [skill=0.9]
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEVELS = (process.argv[2] || '1,2,3,4,5').split(',').map(Number);
const TRIALS = Number(process.argv[3] || 2);
const SKILL = Number(process.argv[4] || 0.9);

function findBrowser(){
  const cands = [];
  if(process.env.BROWSER) cands.push(process.env.BROWSER);
  const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  if(process.platform === 'win32'){
    cands.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    cands.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    cands.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    cands.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  } else if(process.platform === 'darwin'){
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    cands.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return cands.find(p => p && fs.existsSync(p)) || null;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try{ res(JSON.parse(d)); }catch(e){ rej(e); } }); }).on('error', rej);
});
const freePort = () => new Promise(res => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
function cdp(wsUrl){
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('devtools socket error'))); });
  ws.addEventListener('message', ev => { let m; try{ m = JSON.parse(ev.data); }catch(e){ return; } if(m.id && pending.has(m.id)){ const p = pending.get(m.id); pending.delete(m.id); if(m.error) p.rej(new Error(m.error.message)); else p.res(m.result); } });
  return { ready, call(method, params){ return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }); }, close(){ try{ ws.close(); }catch(e){} } };
}

const PROBE = `(() => {
  const D = window._DBG, LV = window.LEVELS, A = window.ThemeAPI;
  const levels = ${JSON.stringify(LEVELS)}, trials = ${TRIALS};
  window.SRR_AI.setSkill(${SKILL});
  window.__falls = { done: false, out: {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  (async () => {
    try{
      for(const li of levels){
        const bins = {}, perBot = {}, times = [];
        for(let t = 0; t < trials; t++){
          D.lobbyReset(); D.lobby.botCount = -1; D.start(li - 1); D.advance(3.5);
          const bots = D.racers.filter(r => r.kind === 'bot');
          const last = new Map(bots.map(b => [b, { z: b.body.pos.z, f: b.falls }]));
          let guard = 0;
          while(guard < 640 && !bots.every(b => b.finished) && D.S.phase === 'race'){
            D.advance(0.25);
            for(const b of bots){ const s = last.get(b); if(b.falls > s.f){ const k = Math.floor((s.z + 100) / 4) * 4 - 100; bins[k] = (bins[k] || 0) + 1; (perBot[b.name] = perBot[b.name] || []).push(s.z.toFixed(0)); } s.z = b.body.pos.z; s.f = b.falls; }
            guard++;
            if((guard & 15) === 15) await sleep(0);
          }
          bots.forEach(b => times.push(b.finished ? Math.round(b.finishTime) : 'DNF'));
        }
        const sorted = Object.entries(bins).map(([z, n]) => [Number(z), n]).sort((a, b) => b[1] - a[1]);
        const obs = LV[li - 1].obstacles;
        window.__falls.out['L' + li] = {
          total: sorted.reduce((a, b) => a + b[1], 0), finishTimes: times.join(' '),
          bins: sorted.slice(0, 12).map(b => b[0] + '-' + (b[0] + 4) + 'm:' + b[1]),
          worst: Object.entries(perBot).map(([n, z]) => ({ name: n, falls: z.length, z: z.slice(0, 30).join(',') })).sort((a, b) => b.falls - a.falls).slice(0, 3)
        };
      }
    }catch(e){ window.__falls.error = String(e && e.stack || e); }
    window.__falls.done = true;
  })();
  return 'started';
})()`;

async function main(){
  const browserPath = findBrowser();
  if(!browserPath){ console.error('No Chrome or Edge found (set BROWSER=...)'); process.exit(2); }
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'srr-falls-'));
  const browser = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--mute-audio', '--window-size=1280,720', 'http://127.0.0.1:' + port + '/index.html?test=1&manual=1'], { stdio: 'ignore' });
  const cleanup = () => {
    if(process.platform === 'win32') spawnSync('taskkill', ['/pid', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); else { try{ browser.kill('SIGKILL'); }catch(e){} }
    try{ server.kill(); }catch(e){}
    setTimeout(() => { try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){} }, 800).unref();
  };
  try{
    const portFile = path.join(profile, 'DevToolsActivePort');
    let dbgPort = 0;
    for(let i = 0; i < 300 && !dbgPort; i++){ await sleep(100); try{ dbgPort = parseInt(fs.readFileSync(portFile, 'utf8').split('\n')[0], 10) || 0; }catch(e){} }
    if(!dbgPort) throw new Error('browser did not start');
    let wsUrl = null;
    for(let i = 0; i < 200 && !wsUrl; i++){
      const list = await getJson('http://127.0.0.1:' + dbgPort + '/json/list').catch(() => []);
      const page = (Array.isArray(list) ? list : []).find(t => t.type === 'page' && /index\.html/.test(t.url || ''));
      if(page) wsUrl = page.webSocketDebuggerUrl; else await sleep(150);
    }
    if(!wsUrl) throw new Error('page did not open');
    const conn = cdp(wsUrl); await conn.ready;
    const ev = async expr => { const r = await conn.call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; };
    for(let i = 0; i < 100; i++){ if(await ev('!!(window._DBG && window._DBG.S.booted)')) break; await sleep(150); }
    await ev(PROBE);
    let out = null;
    for(let i = 0; i < 1200; i++){
      await sleep(400);
      const raw = await ev('JSON.stringify(window.__falls)');
      out = raw ? JSON.parse(raw) : null;
      if(out && out.done) break;
    }
    if(!out || !out.done) throw new Error('probe timed out');
    if(out.error) throw new Error(out.error);
    for(const k of Object.keys(out.out)){
      const L = out.out[k];
      console.log('\n' + k + '  total falls ' + L.total + '   finish times: ' + L.finishTimes);
      console.log('  by track position (4m bins): ' + L.bins.join('  '));
      for(const w of L.worst) console.log('  worst: ' + w.name + ' ' + w.falls + ' falls at z ' + w.z);
    }
  }catch(e){ console.error('ERROR: ' + e.message); process.exitCode = 1; }
  finally{ cleanup(); }
}
main();
