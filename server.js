// Static file server for the game folder (dev use) + a tiny proxy that lets the
// browser talk to a LOCAL vLLM instance for the AI commentator.
//
// The proxy exists for two reasons: the browser can't call the inference
// server directly (CORS), and the LAN address/model stay server-side instead
// of being baked into client code.
//
// Configuration (env vars, all optional):
//   PORT          game server port                 (default 8077)
//   SRR_LLM_URL   OpenAI-compatible base URL      (default http://192.168.1.57:8100)
//   SRR_LLM_MODEL model id served by that server  (default deepseek-v4.1-flash)
//   SRR_LLM_TIMEOUT_MS  upstream timeout          (default 20000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const PORT = parseInt(process.env.PORT || '8077', 10);

const LLM_URL = (process.env.SRR_LLM_URL || 'http://192.168.1.57:8100').replace(/\/+$/, '');
const LLM_MODEL = process.env.SRR_LLM_MODEL || 'deepseek-v4.1-flash';
const LLM_TIMEOUT = parseInt(process.env.SRR_LLM_TIMEOUT_MS || '20000', 10);
// "thinking" reasoning models must spend tokens before they answer; for a
// live one-line commentary we want the answer straight away.
const LLM_THINKING = process.env.SRR_LLM_THINKING === '1';

const mime = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.json':'application/json', '.ico':'image/x-icon'
};

function sendJson(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8', 'Content-Length':Buffer.byteLength(body)});
  res.end(body);
}
function readBody(req, limit){
  return new Promise((resolve, reject)=>{
    let size = 0; const chunks = [];
    req.on('data', c=>{
      size += c.length;
      if(size > limit){ reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', ()=>{ try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }catch(e){ reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// POST /api/commentate  { briefing: {...} }  ->  { text, ms, model }
async function commentate(req, res){
  let payload;
  try{ payload = await readBody(req, 16*1024); }
  catch(e){ return sendJson(res, 400, {error: e.message}); }
  const b = payload.briefing || {};
  if(!b.racers || !b.racers.length) return sendJson(res, 400, {error:'missing briefing.racers'});

  const system = [
    '你係一個糖果賽跑遊戲（糖糖大亂鬥）嘅粵語現場評述員，風格似體育直播：緊張、搞笑、有人情味。',
    '你會收到比賽狀況 JSON。只輸出一句粵語評述，15至40字。',
    '唔好有引號、括號、標題或者解釋。',
    '揀最有戲劇性嘅一件事去講：領先變化、跌落水、被撞跌、逆轉、衝線、大熱門失手。',
    '每次要用唔同嘅講法：可以描述、可以打氣、可以講笑、可以分析形勢。'
    + '絕對唔可以重複「講過嘅句子」嘅句式或者用詞。',
    '提到選手一律用名字（P1、P2、糖糖仔…）。"human: true" 嘅係玩家；只有 "solo: true"（得一位玩家）嗰陣先可以叫佢做「你」。',
    '唔好列出排名或者逐個講，集中講一件事。'
  ].join('');
  // Keep the payload focused: the top few and the player, plus the newest
  // events. A wall of ten racers makes the model fall back to reciting ranks.
  const rs = b.racers || [];
  const focus = rs.filter((x, i) => i < 4 || x.human).slice(0, 6);
  const said = (payload.recent || []).slice(-5);
  const user = '比賽狀況：' + JSON.stringify({
    level: b.level, solo: !!b.solo, timeLeft: b.timeLeft,
    racers: focus, recentEvents: (b.recentEvents || []).slice(-5)
  })
  + (said.length ? '\n你之前講過嘅句子（唔可以用相似句式）：' + JSON.stringify(said) : '')
  + '\n請用全新嘅講法評述一句。';

  const body = JSON.stringify({
    model: LLM_MODEL,
    messages: [{role:'system', content:system}, {role:'user', content:user}],
    max_tokens: 120, temperature: 0.9, top_p: 0.92, presence_penalty: 0.6, frequency_penalty: 0.5,
    chat_template_kwargs: { thinking: LLM_THINKING }
  });
  const t0 = Date.now();
  const upstream = http.request(LLM_URL + '/v1/chat/completions', {
    method:'POST', timeout: LLM_TIMEOUT,
    headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
  }, up => {
    const chunks = [];
    up.on('data', c=>chunks.push(c));
    up.on('end', ()=>{
      const ms = Date.now() - t0;
      try{
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const choice = data.choices && data.choices[0];
        let text = choice && choice.message && (choice.message.content || choice.message.reasoning);
        if(typeof text !== 'string' || !text.trim()) return sendJson(res, 502, {error:'empty completion', ms});
        // reasoning models sometimes wrap the answer; take the last line and strip quotes
        text = text.trim().split('\n').filter(Boolean).pop().replace(/^["「『]+|["」』]+$/g, '').trim();
        sendJson(res, 200, { text, ms, model: data.model || LLM_MODEL, tokens: data.usage && data.usage.completion_tokens });
      }catch(e){ sendJson(res, 502, {error:'bad upstream response', ms}); }
    });
  });
  upstream.on('timeout', ()=>{ upstream.destroy(new Error('timeout')); });
  upstream.on('error', e=> sendJson(res, 504, {error:'llm unreachable: ' + e.message, ms: Date.now() - t0 }));
  upstream.end(body);
}

// GET /api/llm/health -> { ok, model, url }
function llmHealth(res){
  const t0 = Date.now();
  const r = http.request(LLM_URL + '/v1/models', { method:'GET', timeout: 4000 }, up=>{
    const chunks = []; up.on('data', c=>chunks.push(c));
    up.on('end', ()=>{
      try{
        const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const ids = (d.data || []).map(m=>m.id);
        sendJson(res, 200, { ok: true, model: ids.includes(LLM_MODEL) ? LLM_MODEL : (ids[0] || LLM_MODEL), models: ids, url: LLM_URL, ms: Date.now()-t0 });
      }catch(e){ sendJson(res, 200, { ok:false, error:'bad response', url: LLM_URL }); }
    });
  });
  r.on('timeout', ()=>{ r.destroy(new Error('timeout')); });
  r.on('error', e=> sendJson(res, 200, { ok:false, error: e.message, url: LLM_URL }));
  r.end();
}

const srv = http.createServer((req,res)=>{
  const url = new URL(req.url, 'http://localhost');
  if(url.pathname === '/api/commentate' && req.method === 'POST') return commentate(req, res);
  if(url.pathname === '/api/llm/health') return llmHealth(res);

  let p = decodeURIComponent(url.pathname);
  if(p === '/') p = '/index.html';
  const f = path.join(root, p);
  if(!f.startsWith(root)){ res.writeHead(403); res.end('403'); return; }
  fs.readFile(f,(e,d)=>{
    if(e){ res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {'Content-Type': mime[path.extname(f).toLowerCase()] || 'application/octet-stream'});
    res.end(d);
  });
});
srv.listen(PORT,'127.0.0.1',()=>console.log('SERVING http://127.0.0.1:'+PORT+'/   LLM -> '+LLM_URL+' ('+LLM_MODEL+')'));
