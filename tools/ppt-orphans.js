// Reads ppt-orphans.txt (written by tools/ppt_orphans.ps1) and lists every
// paragraph whose last line is an orphan — a lone character or a lone word.
//   powershell -File tools/ppt_orphans.ps1   then   node tools/ppt-orphans.js
// Exit code 1 when there are orphans, so it can gate a deck release.
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'ppt-orphans.txt');
if(!fs.existsSync(file)){ console.error('ppt-orphans.txt not found — run tools/ppt_orphans.ps1 first'); process.exit(2); }
const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => l.split('\t'));
let orphans = 0, multi = 0;
const cur = [];
for(const [deck, slide, para, lines, len, last] of rows){
  const nl = Number(lines);
  cur[0] = deck; cur[1] = slide;
  if(nl < 2) continue;
  multi++;
  const t = (last || '').trim();
  const cjk = /[\u3400-\u9fff]/.test(t);
  // closing punctuation and quotes do not count as content
  const core = t.replace(/[。」』）)\]"'.,;:…]+$/, '');
  // Chinese: a last line of three or fewer characters; English: a single word
  const bad = cjk ? [...core].length <= 3 : (core.split(/\s+/).length === 1 && core.length <= 14);
  if(bad){
    orphans++;
    console.log(`${deck.startsWith('AI_Game') ? 'EN' : 'ZH'} slide ${slide} para ${para}: last line ${JSON.stringify(t)}  (paragraph ${len} chars, ${nl} lines)`);
  }
}
console.log(`paragraphs wrapping: ${multi}, orphans: ${orphans}`);
process.exit(orphans ? 1 : 0);
