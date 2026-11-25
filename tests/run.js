#!/usr/bin/env node
// Regression runner for 糖糖大亂鬥 SUGAR RUSH ROYALE.
// Serves the game, opens index.html?test=1 in a headless Chrome/Edge, lets
// tests/suites.js drive the real simulation, prints every check and exits
// non-zero if anything fails. No npm dependencies: it talks to the browser
// over the DevTools protocol with Node's built-in WebSocket.
//
//   npm test                 everything (Node tests + browser suites)
//   node tests/run.js        browser suites only
//   node tests/run.js --suite=bots      one suite (name substring)
//   set BROWSER=C:\path\to\chrome.exe   override the browser
'use strict';
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ONLY = (process.argv.find(a => a.startsWith('--suite=')) || '').slice(8);
const TIMEOUT_MS = 8 * 60 * 1000;
const BOOT_MS = 60 * 1000;

function findBrowser(){
  const cands = [];
  if(process.env.BROWSER) cands.push(process.env.BROWSER);
  const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  if(process.platform === 'win32'){
    cands.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    cands.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    cands.push(path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'));
    cands.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    cands.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  } else if(process.platform === 'darwin'){
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    cands.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    cands.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    cands.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
      '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return cands.find(p => p && fs.existsSync(p)) || null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => {
  http.get(url, r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => { try{ res(JSON.parse(d)); }catch(e){ rej(e); } });
  }).on('error', rej);
});
const freePort = () => new Promise(res => {
  const s = http.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

function cdp(wsUrl){
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('could not talk to the browser (DevTools socket)')));
  });
  ws.addEventListener('message', ev => {
    let m;
    try{ m = JSON.parse(ev.data); }catch(e){ return; }
    if(m.id && pending.has(m.id)){
      const p = pending.get(m.id); pending.delete(m.id);
      if(m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
    }
  });
  return {
    ready,
    call(method, params){
      return new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params: params || {} }));
      });
    },
    close(){ try{ ws.close(); }catch(e){} }
  };
}

async function main(){
  const browserPath = findBrowser();
  if(!browserPath){
    console.error('No Chrome or Edge found. Set BROWSER=<path to chrome.exe / msedge.exe> and retry.');
    process.exit(2);
  }
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', d => process.stderr.write(d));

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'srr-test-'));
  const url = 'http://127.0.0.1:' + port + '/index.html?test=1' + (ONLY ? '&suite=' + encodeURIComponent(ONLY) : '');
  const browser = spawn(browserPath, [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--mute-audio', '--window-size=1280,720', '--force-device-scale-factor=1', url
  ], { stdio: 'ignore' });

  let conn = null, failed = 0, passed = 0;
  const cleanup = () => {
    if(conn) conn.close();
    if(process.platform === 'win32') spawnSync('taskkill', ['/pid', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try{ browser.kill('SIGKILL'); }catch(e){} }
    try{ server.kill(); }catch(e){}
    setTimeout(() => { try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){} }, 800).unref();
  };

  try{
    // the browser prints nothing; it writes the DevTools port into the profile
    const portFile = path.join(profile, 'DevToolsActivePort');
    let dbgPort = 0;
    for(let i = 0; i < 300 && !dbgPort; i++){
      await sleep(100);
      try{ dbgPort = parseInt(fs.readFileSync(portFile, 'utf8').split('\n')[0], 10) || 0; }catch(e){}
    }
    if(!dbgPort) throw new Error('the browser did not start (no DevTools port)');

    let wsUrl = null;
    for(let i = 0; i < 200 && !wsUrl; i++){
      const list = await getJson('http://127.0.0.1:' + dbgPort + '/json/list').catch(() => []);
      const page = (Array.isArray(list) ? list : []).find(t => t.type === 'page' && /index\.html/.test(t.url || ''));
      if(page) wsUrl = page.webSocketDebuggerUrl; else await sleep(150);
    }
    if(!wsUrl) throw new Error('the game page did not open in the headless browser');
    conn = cdp(wsUrl);
    await conn.ready;

    const evaluate = async expr => {
      const r = await conn.call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if(r && r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.text || 'unknown'));
      return r && r.result ? r.result.value : undefined;
    };
    const pollExpr = 'JSON.stringify(window.SRR_TEST ? window.SRR_TEST.report() : null)';

    const t0 = Date.now();
    let printed = 0, lastSuite = '', sawStart = Date.now();
    for(;;){
      if(Date.now() - t0 > TIMEOUT_MS) throw new Error('timed out after ' + Math.round(TIMEOUT_MS / 60000) + ' min');
      const raw = await evaluate(pollExpr).catch(() => null);
      const rep = raw ? JSON.parse(raw) : null;
      if(!rep){
        if(Date.now() - t0 > BOOT_MS){
          const boot = await evaluate('JSON.stringify({dbg: !!window._DBG, api: !!window.ThemeAPI, three: !!(window.THREE && window.THREE.REVISION), booted: !!(window._DBG && window._DBG.S.booted)})').catch(() => null);
          throw new Error('the game did not boot in test mode ' + (boot || ''));
        }
        await sleep(300);
        continue;
      }
      for(; printed < rep.results.length; printed++){
        const r = rep.results[printed];
        if(r.suite !== lastSuite){ console.log('\n# ' + r.suite); lastSuite = r.suite; }
        if(r.status === 'pass'){ passed++; console.log('  ok   ' + r.msg); }
        else { failed++; console.log('  FAIL ' + r.msg + (r.detail ? '\n       ' + r.detail.split('\n').join('\n       ') : '')); }
      }
      if(rep.error) throw new Error(rep.error);
      if(rep.done) break;
      await sleep(250);
    }
    console.log('\n' + (failed ? 'FAILED' : 'PASSED') + ': ' + passed + ' passed, ' + failed + ' failed  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    process.exitCode = failed ? 1 : 0;
  }catch(e){
    console.error('\nRUNNER ERROR: ' + e.message);
    process.exitCode = 1;
  }finally{
    cleanup();
  }
}
main();
