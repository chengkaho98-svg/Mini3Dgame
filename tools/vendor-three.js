#!/usr/bin/env node
// Downloads the three.js build and the add-on files the game imports into
// vendor/three/, so the game runs from this repository alone (no CDN at
// runtime — a blocked or slow CDN used to leave visitors on a dead menu).
//
//   node tools/vendor-three.js            (downloads 0.160.0 again)
//   THREE_VERSION=0.161.0 node tools/vendor-three.js
//
// Starting points must match the imports at the top of main.js.
'use strict';
const fs = require('fs');
const path = require('path');

const VERSION = process.env.THREE_VERSION || '0.160.0';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'vendor', 'three');
const CDN = 'https://unpkg.com/three@' + VERSION + '/';
const CORE = 'build/three.module.min.js';
// import-map prefixes: 'three' -> vendor/three/<CORE>, 'three/addons/' -> vendor/three/examples/jsm/
const START = [
  'examples/jsm/postprocessing/EffectComposer.js',
  'examples/jsm/postprocessing/RenderPass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js',
  'examples/jsm/postprocessing/OutputPass.js',
  'examples/jsm/postprocessing/SSAOPass.js',
  'examples/jsm/environments/RoomEnvironment.js'
];

function get(url){
  return fetch(url).then(r => { if(!r.ok) throw new Error(r.status + ' ' + url); return r.text(); });
}
function save(rel, text){
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
async function main(){
  const queue = [CORE, 'LICENSE', ...START];
  const seen = new Set();
  while(queue.length){
    const rel = queue.shift();
    if(seen.has(rel)) continue;
    seen.add(rel);
    const text = await get(CDN + rel);
    save(rel, text);
    if(rel.endsWith('.js')){
      // follow relative imports ("./Pass.js", "../shaders/CopyShader.js")
      for(const m of text.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)){
        const dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
        if(!seen.has(dep)) queue.push(dep);
      }
    }
    console.log('  ' + rel);
  }
  fs.writeFileSync(path.join(OUT, 'VERSION'), VERSION + '\n');
  console.log('three.js ' + VERSION + ': ' + seen.size + ' files in vendor/three/');
}
main().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
