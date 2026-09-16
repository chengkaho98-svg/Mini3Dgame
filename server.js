// Tiny static file server for the game folder (dev use).
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const mime = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.json':'application/json', '.ico':'image/x-icon'
};
const srv = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p === '/') p = '/index.html';
  const f = path.join(root, p);
  if(!f.startsWith(root)){ res.writeHead(403); res.end('403'); return; }
  fs.readFile(f,(e,d)=>{
    if(e){ res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {'Content-Type': mime[path.extname(f).toLowerCase()] || 'application/octet-stream'});
    res.end(d);
  });
});
srv.listen(8077,'127.0.0.1',()=>console.log('SERVING http://127.0.0.1:8077/'));
