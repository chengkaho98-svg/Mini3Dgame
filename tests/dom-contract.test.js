// DOM contract test (Node, no browser): every element id the scripts look up
// really exists in index.html, and every file index.html loads exists.
// A renamed element once silenced every toast message without any error.
//   node tests/dom-contract.test.js   (or: npm test)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0;
const check = (cond, msg) => { if(!cond){ fails++; console.error('  FAIL: ' + msg); } };

const html = read('index.html');
const scripts = ['main.js', 'bots.js', 'build.js', 'analytics.js', 'commentator.js'].filter(f => fs.existsSync(path.join(ROOT, f)));
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// ids the code asks for by name
const wanted = new Map();                 // id -> [where]
for(const f of scripts){
  const src = read(f);
  for(const m of src.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) wanted.set(m[1], (wanted.get(m[1]) || []).concat(f + ' $("' + m[1] + '")'));
  for(const m of src.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) wanted.set(m[1], (wanted.get(m[1]) || []).concat(f + ' getElementById'));
  // the UI table: [ 'a','b', ... ].forEach(id=>{ UI[id]=$(id); })
  const list = src.match(/const UI = \{\};\s*\[([^\]]*)\]\.forEach\(id=>\{ UI\[id\]=\$\(id\); \}\);/);
  if(list) for(const m of list[1].matchAll(/'([A-Za-z0-9_-]+)'/g)) wanted.set(m[1], (wanted.get(m[1]) || []).concat(f + ' UI table'));
}
check(wanted.size > 10, 'found the element lookups (' + wanted.size + ' ids)');
for(const [id, where] of wanted){
  check(htmlIds.has(id), 'index.html has no id="' + id + '"  (looked up by ' + where[0] + ')');
}

// scripts and stylesheets referenced by index.html exist locally
for(const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)){
  check(fs.existsSync(path.join(ROOT, m[1])), 'index.html loads "' + m[1] + '" but the file is missing');
}
for(const m of html.matchAll(/url\('([^']+)'\)/g)){
  if(/^data:|^https?:/.test(m[1])) continue;
  check(fs.existsSync(path.join(ROOT, m[1])), 'stylesheet refers to "' + m[1] + '" but the file is missing');
}
// ids are unique
const seen = new Map();
for(const m of html.matchAll(/\bid="([^"]+)"/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
for(const [id, n] of seen) check(n === 1, 'id "' + id + '" is used ' + n + ' times in index.html');

console.log(fails ? 'FAILURES: ' + fails : 'DOM CONTRACT ALL GOOD (' + wanted.size + ' ids checked)');
process.exit(fails ? 1 : 0);
