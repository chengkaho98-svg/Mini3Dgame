// ================= SUGAR RUSH ROYALE — levels.js =================
// 5 themed levels, 140–172m long. Casual pacing: a normal player clears a
// level in ~60–75s (AI fastest 30–45s). Obstacle speeds softened, hazard
// density thinned, generous jump gaps (player jump range ≈ 4.1m).
// Each level keeps its headline gimmick:
//   L1 糖果街   — classic gauntlet: windmills / crossing rollers / bumpers + jump gaps
//   L2 泡泡工廠 — belts, boxing gloves, sinking elevator hops, crushers
//   L3 果凍峽谷 — platforming: gaps, ferry platform, spin discs, bounce islands
//   L4 蜂蜜危機 — hazard gauntlet: honey, pendulums, rotators, punch storm
//   L5 糖霜風暴 — finale: falling tiles, updraft fans over wall, boost sprint
//
// Obstacle kinds (build.js contract):
//   mill {x,z,r,speed,a0}            rotating blade wall (hub auto = r+0.15)
//   roller {z,r,speed,phase}         big ball sweeping ACROSS the road
//   elevator {x,z,w,d,lift,period,phase}  sinking pad over void
//   bounce {x,z,r,power}             launch pad (any contact, 0.45s cooldown)
//   belt {x,z,L,w,speed,dir}         conveyor (dir -1 = against you)
//   bumper {x,z,r,kick}
//   honey {x,z,w,d}                  slow glue pool
//   rotator {x,z,r,speed,arms,hubY}  ground sweeping arms
//   pendulum {x,z,arm,speed,phase}   swinging hammer (gantry mounted)
//   crusher {x:[x0,x1],z,hx,spd,phase}
//   puncher {side,z,len,speed,phase} boxing glove from a side wall
//   gap {z:[z0,z1]}                  VOID band (jump!) — subtracts the road
//   plat {x,z,w,d,y}                 static platform island
//   mplat {axis:'z',x,z:[z0,z1],...} moving platform (carries you)
//   disc {x,z,r,speed}               spinning turntable (carries you)
//   tiles {z,rows,cols,cw,cd}        falling-tile bridge
//   fan {x,z,r,force}                updraft column
//   boost {x,z,w,d,push}             forward launch strip
//   narrow {z:[z0,z1],x:[x0,x1]}     road-width override band
//   wall {x,z,w,h,d}                 solid block (jump / fly over it)
window.LEVELS = [
// ================= LEVEL 1 — 糖果街 (Candy Street) =================
{
  name:'糖果街', nameEn:'Candy Street', time:115, theme:'street',
  sky:[0.55,0.80,1.00], fog:[0.72,0.86,1.00],
  road:[[-3.5,0],[3.5,140]],
  spawn:[0,0.05,2],
  beam:[0,1.02,138.2],
  ring:[[0,0.9,138.3],0.62],
  hints:[
    {t:'WASD 移動 · Space 跳 · Shift 撲倒', z:[2,7]},
    {t:'軟糖柱會把你彈開——搵空位穿過去！', z:[8,14]},
    {t:'⚠ 風車葉會把你扇飛，睇準空檔衝過去', z:[16,25]},
    {t:'前方斷橋！踩加速帶＋跳躍飛過去', z:[26,32]},
    {t:'大球橫掃全場——來回穿梭！', z:[34,38]},
    {t:'紅色壓碎機：等佢升起先過！', z:[61,66]},
    {t:'最後衝刺——沿住加速帶飛啦！', z:[108,118]}
  ],
  obstacles:[
    {k:'bumper', x:-1.8, z:9.5, r:0.95, kick:5.8},
    {k:'bumper', x: 1.9, z:11.5, r:0.95, kick:5.8},
    {k:'bumper', x: 0.0, z:13.5, r:0.95, kick:5.8},
    {k:'mill', x:0, z:18, r:2.9, speed:0.8, a0:0},
    {k:'mill', x:0, z:23.5, r:2.9, speed:-0.8, a0:0.8},
    {k:'boost', x:0, z:27.4, w:7, d:2.0, push:5.0},
    {k:'gap', z:[29.2,31.4]},
    {k:'roller', z:36, r:1.15, speed:2.2, phase:0},
    {k:'bounce', x:0, z:42, r:1.3, power:12.5},
    {k:'mill', x:0, z:48, r:3.0, speed:0.95, a0:0.3},
    {k:'bumper', x:-2.2, z:53, r:0.95, kick:6.0},
    {k:'bumper', x: 2.2, z:55.5, r:0.95, kick:6.0},
    {k:'bumper', x:-2.2, z:58, r:0.95, kick:6.0},
    {k:'crusher', x:[-3.5,3.5], z:63.5, hx:3.5, spd:2.8, phase:0},
    {k:'honey', x:0, z:70, w:5.6, d:4.0},
    {k:'roller', z:76, r:1.15, speed:2.4, phase:0.3},
    {k:'mill', x:0, z:81, r:3.2, speed:1.0, a0:0},
    {k:'mill', x:0, z:86, r:3.2, speed:-1.0, a0:2.2},
    {k:'boost', x:0, z:90.4, w:7, d:2.0, push:5.0},
    {k:'gap', z:[92.4,94.6]},
    {k:'pendulum', x:0, z:99, arm:5.2, speed:1.0, phase:0},
    {k:'honey', x:0, z:105, w:5.2, d:3.6},
    {k:'bumper', x:0, z:110, r:0.95, kick:6.0},
    {k:'boost', x:0, z:113.4, w:7, d:2.0, push:5.0},
    {k:'gap', z:[115.4,117.6]}
  ],
  coins:[
    [1.8,0.65,7],[-1.5,0.65,17],[0,2.2,42],[1.6,0.65,50],[-1.8,0.65,56],
    [0,0.65,63],[0,2.4,90.4],[1.5,0.65,97],[-1.5,0.65,103],
    [0,0.65,120],[2,0.65,128],[0,0.65,134]
  ]
},
// ================= LEVEL 2 — 泡泡工廠 (Bubble Factory) =================
{
  name:'泡泡工廠', nameEn:'Bubble Factory', time:125, theme:'factory',
  sky:[0.45,0.75,0.95], fog:[0.62,0.84,0.98],
  road:[[-3.8,0],[3.8,150]],
  spawn:[0,0.05,2],
  beam:[0,1.02,148.2],
  ring:[[0,0.9,148.3],0.62],
  hints:[
    {t:'⚠ 輸送帶逆向往後推——用力向前跑！', z:[6,14]},
    {t:'拳套會從牆邊彈出，睇準伸縮節奏', z:[16,25]},
    {t:'下沉升降板下面係虛空！等塊板浮上嚟先跳', z:[29,42]},
    {t:'順向輸送帶＋風車——衝呀！', z:[45,52]},
    {t:'彈床彈上平台——落啲節奏！', z:[84,99]},
    {t:'最後拳套巷＋加速飛越！', z:[102,135]}
  ],
  obstacles:[
    {k:'belt', x:0, z:11, L:8, w:7.6, speed:2.4, dir:-1},
    {k:'bumper', x:-2.4, z:10, r:0.9, kick:5.8},
    {k:'bumper', x: 2.4, z:12.5, r:0.9, kick:5.8},
    {k:'puncher', side:-1, z:18, len:3.4, speed:1.1, phase:0},
    {k:'puncher', side: 1, z:23, len:3.4, speed:1.1, phase:0.5},
    {k:'gap', z:[30,42]},
    {k:'elevator', x:0, z:32.5, w:3.0, d:2.6, lift:1.4, period:4.2, phase:0},
    {k:'elevator', x:0, z:36.5, w:3.0, d:2.6, lift:1.4, period:4.2, phase:1.05},
    {k:'elevator', x:0, z:40, w:3.0, d:2.6, lift:1.4, period:4.2, phase:2.1},
    {k:'belt', x:0, z:47, L:7, w:7.6, speed:3.0, dir:1},
    {k:'mill', x:0, z:51, r:3.2, speed:1.0, a0:0},
    {k:'honey', x:0, z:57, w:6.4, d:3.4},
    {k:'puncher', side: 1, z:61.5, len:3.4, speed:1.2, phase:0},
    {k:'puncher', side:-1, z:66, len:3.4, speed:1.2, phase:0.55},
    {k:'crusher', x:[-3.8,0.2], z:72, hx:2.0, spd:2.8, phase:0},
    {k:'crusher', x:[0.2,3.8], z:72, hx:1.8, spd:2.8, phase:1.0},
    {k:'belt', x:0, z:80, L:8, w:7.6, speed:2.6, dir:-1},
    {k:'roller', z:78.5, r:1.15, speed:2.6, phase:0},
    {k:'gap', z:[87,99]},
    {k:'bounce', x:0, z:85.6, r:1.25, power:13.0},
    {k:'plat', x:0, z:89.4, w:3.0, d:3.0, y:1.5},
    {k:'plat', x:0, z:94.0, w:3.0, d:3.0, y:0.0},
    {k:'puncher', side:-1, z:104, len:3.4, speed:1.5, phase:0},
    {k:'puncher', side: 1, z:108.5, len:3.4, speed:1.5, phase:0.5},
    {k:'puncher', side:-1, z:113, len:3.4, speed:1.6, phase:0.25},
    {k:'bumper', x:-2.0, z:118, r:0.95, kick:6.2},
    {k:'bumper', x: 2.0, z:120.5, r:0.95, kick:6.2},
    {k:'puncher', side: 1, z:125, len:3.6, speed:1.5, phase:0.3},
    {k:'boost', x:0, z:130.4, w:7.6, d:2.0, push:5.0},
    {k:'gap', z:[132.4,134.6]}
  ],
  coins:[
    [0,0.65,8],[-2,0.65,17],[2,0.65,23],[0,0.8,36.5],[-2,0.65,48],
    [0,2.9,89.4],[-2,0.65,101],[2,0.65,110],[-1.5,0.65,116],
    [0,0.65,124],[0,0.65,131],[0,0.65,144]
  ]
},
// ================= LEVEL 3 — 果凍峽谷 (Jelly Canyon) =================
{
  name:'果凍峽谷', nameEn:'Jelly Canyon', time:130, theme:'canyon',
  sky:[0.55,0.72,0.55], fog:[0.66,0.86,0.72],
  road:[[-3.2,0],[3.2,158]],
  spawn:[0,0.05,2],
  beam:[0,1.02,156.2],
  ring:[[0,0.9,156.3],0.62],
  hints:[
    {t:'峽谷關：跳躍係你嘅朋友！助跑＋Space', z:[2,9]},
    {t:'⚠ 旋轉圓盤——跳上去俾佢轉埋一齊', z:[26,36]},
    {t:'渡輪平台：企上去等佢載你過去！', z:[41,55]},
    {t:'獨木橋：慢慢行，唔好急', z:[59,65]},
    {t:'彈床島鏈：一格格彈過去', z:[68,82]},
    {t:'超級加速帶＋大跳——飛過峽谷！', z:[88,96]}
  ],
  obstacles:[
    {k:'gap', z:[10,12.4]},
    {k:'plat', x:0, z:15, w:3.0, d:3.0, y:0},
    {k:'gap', z:[17,19.4]},
    {k:'plat', x:1.2, z:22, w:3.0, d:3.0, y:0},
    {k:'gap', z:[26,37]},
    {k:'disc', x:0, z:31, r:2.6, speed:0.8},
    {k:'plat', x:0, z:40, w:6.4, d:4.0, y:0},
    {k:'pendulum', x:0, z:40, arm:5.0, speed:1.0, phase:0},
    {k:'gap', z:[42,55.5]},
    {k:'mplat', axis:'z', x:0, z:[43,55], w:3.0, d:3.4, speed:1.0, phase:0},
    {k:'plat', x:0, z:58.5, w:6.4, d:2.0, y:0},
    {k:'narrow', z:[60,64.5], x:[-0.85,0.85]},
    {k:'plat', x:0, z:67, w:6.4, d:2.0, y:0},
    {k:'gap', z:[68,82]},
    {k:'plat', x:0, z:71.8, w:3.0, d:3.0, y:0},
    {k:'bounce', x:0, z:71.8, r:1.2, power:11.5},
    {k:'plat', x:0, z:75.3, w:3.0, d:3.0, y:0},
    {k:'bounce', x:0, z:75.3, r:1.2, power:11.5},
    {k:'plat', x:0, z:78.8, w:3.0, d:3.0, y:0},
    {k:'bounce', x:0, z:78.8, r:1.2, power:11.5},
    {k:'plat', x:0, z:84.5, w:6.4, d:4.0, y:0},
    {k:'roller', z:84, r:1.1, speed:2.6, phase:0},
    {k:'boost', x:0, z:89.6, w:6.4, d:2.2, push:6.0},
    {k:'gap', z:[91.4,95.4]},
    {k:'plat', x:0, z:98.5, w:6.4, d:4.0, y:0},
    {k:'gap', z:[101,103.4]},
    {k:'plat', x:1.2, z:105.8, w:2.8, d:2.6, y:0},
    {k:'gap', z:[107.2,109.6]},
    {k:'plat', x:-1.2, z:112, w:2.8, d:2.6, y:0},
    {k:'plat', x:0, z:115.5, w:6.4, d:4.0, y:0},
    {k:'crusher', x:[-3.2,3.2], z:115.5, hx:3.2, spd:3.0, phase:0},
    {k:'plat', x:0, z:120.5, w:6.4, d:4.0, y:0},
    {k:'honey', x:0, z:120.5, w:5.4, d:3.4},
    {k:'pendulum', x:0, z:120.5, arm:5.0, speed:1.15, phase:0.8},
    {k:'gap', z:[123.5,125.9]},
    {k:'plat', x:0, z:128.5, w:4.0, d:3.0, y:0},
    {k:'narrow', z:[131,134.5], x:[-2.2,0.6]},
    {k:'plat', x:-0.8, z:137, w:4.4, d:2.6, y:0},
    {k:'gap', z:[140,142.4]},
    {k:'plat', x:0, z:145.5, w:6.4, d:3.2, y:0}
  ],
  coins:[
    [0,0.65,8],[0,0.9,15],[1.2,0.9,22],[0,1.6,31],[0,0.65,40],
    [0,0.65,47],[0,0.65,62.5],[0,2.0,73],[0,0.65,84.5],[0,2.2,92],
    [1.2,0.9,105.8],[0,0.65,115.5],[-0.8,0.65,137],[0,0.65,145.5]
  ]
},
// ================= LEVEL 4 — 蜂蜜危機 (Honey Crisis) =================
{
  name:'蜂蜜危機', nameEn:'Honey Crisis', time:130, theme:'honey',
  sky:[0.85,0.66,0.30], fog:[0.92,0.73,0.40],
  road:[[-4,0],[4,165]],
  spawn:[0,0.05,2],
  beam:[0,1.02,163.2],
  ring:[[0,0.9,163.3],0.62],
  hints:[
    {t:'蜂蜜池會黏住你——保持衝刺！', z:[5,10]},
    {t:'⚠ 大錘擺錘：計算擺動節奏再過', z:[11,17]},
    {t:'旋轉掃臂：貼住中心柱或者衝空檔', z:[20,25]},
    {t:'壓碎機牆：一格格慢慢推進', z:[29,38]},
    {t:'最後滾球＋風車——衝線啦！', z:[148,160]}
  ],
  obstacles:[
    {k:'honey', x:0, z:7, w:6.6, d:4.2},
    {k:'pendulum', x:0, z:12, arm:5.2, speed:1.0, phase:0},
    {k:'honey', x:0, z:16, w:6.2, d:3.8},
    {k:'rotator', x:0, z:22, r:3.4, speed:1.2, arms:4, hubY:0.55},
    {k:'crusher', x:[-4,-1.35], z:31, hx:1.3, spd:3.0, phase:0},
    {k:'crusher', x:[-1.35,1.35], z:33.5, hx:1.35, spd:3.0, phase:0.66},
    {k:'crusher', x:[1.35,4], z:36, hx:1.3, spd:3.0, phase:1.33},
    {k:'honey', x:-1.6, z:42, w:4.2, d:3.6},
    {k:'bumper', x: 2.2, z:42, r:0.95, kick:6.2},
    {k:'honey', x: 1.6, z:46.5, w:4.2, d:3.6},
    {k:'bumper', x:-2.2, z:46.5, r:0.95, kick:6.2},
    {k:'honey', x:0, z:51, w:6.6, d:3.8},
    {k:'pendulum', x:0, z:57, arm:5.4, speed:1.15, phase:0},
    {k:'pendulum', x:0, z:61.5, arm:5.4, speed:-1.1, phase:1.9},
    {k:'puncher', side:-1, z:67, len:3.6, speed:1.2, phase:0},
    {k:'puncher', side: 1, z:71, len:3.6, speed:1.3, phase:0.6},
    {k:'honey', x:0, z:77, w:7.4, d:6.0},
    {k:'roller', z:77, r:1.2, speed:2.2, phase:0},
    {k:'rotator', x:0, z:85, r:3.2, speed:1.3, arms:4, hubY:0.55},
    {k:'mill', x:0, z:92, r:3.6, speed:1.05, a0:0},
    {k:'crusher', x:[-4,0], z:99, hx:2.0, spd:3.4, phase:0},
    {k:'crusher', x:[0,4], z:99, hx:2.0, spd:3.4, phase:1.0},
    {k:'honey', x:0, z:104, w:6.8, d:3.6},
    {k:'crusher', x:[-4,0], z:109, hx:2.0, spd:3.6, phase:0.4},
    {k:'crusher', x:[0,4], z:109, hx:2.0, spd:3.6, phase:1.4},
    {k:'pendulum', x:0, z:116, arm:5.4, speed:1.2, phase:0},
    {k:'pendulum', x:0, z:120.5, arm:5.4, speed:-1.15, phase:2.1},
    {k:'pendulum', x:0, z:125, arm:5.4, speed:1.25, phase:0.7},
    {k:'belt', x:0, z:132, L:8, w:8, speed:2.4, dir:-1},
    {k:'puncher', side: 1, z:130.5, len:3.4, speed:1.4, phase:0.3},
    {k:'puncher', side:-1, z:134.5, len:3.4, speed:1.4, phase:0.9},
    {k:'honey', x:-1.8, z:141, w:4.0, d:3.4},
    {k:'bumper', x: 1.8, z:141, r:0.9, kick:6.0},
    {k:'honey', x: 1.8, z:145.5, w:4.0, d:3.4},
    {k:'bumper', x:-1.8, z:145.5, r:0.9, kick:6.0},
    {k:'rotator', x:0, z:152, r:3.6, speed:1.4, arms:4, hubY:0.55},
    {k:'roller', z:154, r:1.25, speed:2.8, phase:0},
    {k:'mill', x:0, z:159, r:3.4, speed:1.2, a0:0}
  ],
  coins:[
    [0,0.65,7],[2.5,0.65,11],[-2.5,0.65,16],[0,0.65,22],[0,0.65,28],
    [0,0.65,33],[3,0.65,42],[-3,0.65,46.5],[0,0.65,57],[2.5,0.65,62],
    [0,0.65,77],[0,0.65,85],[0,0.65,99],[2.5,0.65,117],[-2.5,0.65,125],
    [0,0.65,132],[0,0.65,141],[0,0.65,152],[0,0.65,159]
  ]
},
// ================= LEVEL 5 — 糖霜風暴 (Sugar Storm, finale) =================
{
  name:'糖霜風暴', nameEn:'Sugar Storm', time:135, theme:'storm',
  sky:[0.42,0.60,0.90], fog:[0.55,0.72,0.98],
  road:[[-4,0],[4,172]],
  spawn:[0,0.05,2],
  beam:[0,1.02,170.2],
  ring:[[0,0.9,170.3],0.62],
  hints:[
    {t:'決賽開始！前方雙風車＋滾球', z:[3,10]},
    {t:'⚠ 塌落地板：踩完會跌——快跑唔好停！', z:[32,44]},
    {t:'風扇上升氣流：跳入去飄過峽谷！', z:[72,83]},
    {t:'窄塌落橋＋擺錘——一口氣衝過！', z:[104,116]},
    {t:'風扇會將你吹過高牆——跳入氣流！', z:[152,157]},
    {t:'最終加速衝刺！！', z:[160,170]}
  ],
  obstacles:[
    {k:'mill', x:0, z:9, r:3.4, speed:1.15, a0:0},
    {k:'mill', x:0, z:13.5, r:3.4, speed:-1.15, a0:2.2},
    {k:'roller', z:11.2, r:1.2, speed:2.8, phase:0},
    {k:'crusher', x:[-4,0], z:19, hx:2.0, spd:3.0, phase:0},
    {k:'crusher', x:[0,4], z:19, hx:2.0, spd:3.0, phase:1.0},
    {k:'puncher', side:-1, z:25, len:3.6, speed:1.3, phase:0},
    {k:'puncher', side: 1, z:28.5, len:3.6, speed:1.4, phase:0.5},
    {k:'gap', z:[33,45.5]},
    {k:'tiles', z:39.5, rows:3, cols:3, cw:2.6, cd:3.4},
    {k:'gap', z:[48.5,55]},
    {k:'disc', x:0, z:51.8, r:2.6, speed:0.9},
    {k:'plat', x:0, z:58, w:8, d:4.0, y:0},
    {k:'pendulum', x:0, z:58, arm:5.2, speed:1.15, phase:0},
    {k:'belt', x:0, z:64, L:8, w:8, speed:2.6, dir:-1},
    {k:'bumper', x:-2.6, z:62.5, r:0.9, kick:6.0},
    {k:'bumper', x: 2.6, z:65.5, r:0.9, kick:6.0},
    {k:'honey', x:0, z:70, w:6.6, d:3.4},
    {k:'gap', z:[73.5,84.5]},
    {k:'fan', x:0, z:75.6, r:2.0, force:46},
    {k:'fan', x:0, z:81, r:2.0, force:46},
    {k:'rotator', x:0, z:90, r:3.6, speed:1.4, arms:4, hubY:0.55},
    {k:'roller', z:92, r:1.2, speed:2.8, phase:0},
    {k:'crusher', x:[-4,-1.35], z:98, hx:1.3, spd:3.4, phase:0},
    {k:'crusher', x:[-1.35,1.35], z:98, hx:1.35, spd:3.4, phase:0.66},
    {k:'crusher', x:[1.35,4], z:98, hx:1.3, spd:3.4, phase:1.33},
    {k:'pendulum', x:0, z:104, arm:5.2, speed:1.25, phase:0.2},
    {k:'gap', z:[107,119.5]},
    {k:'tiles', z:113.5, rows:3, cols:2, cw:2.6, cd:3.4},
    {k:'puncher', side: 1, z:124, len:3.6, speed:1.5, phase:0},
    {k:'mill', x:0, z:128.5, r:3.4, speed:1.2, a0:0.4},
    {k:'gap', z:[133,146]},
    {k:'bounce', x:0, z:131.4, r:1.25, power:13.5},
    {k:'plat', x:0, z:134.7, w:3.0, d:3.0, y:1.5},
    {k:'plat', x:0, z:137.7, w:3.0, d:3.0, y:1.5},
    {k:'plat', x:0, z:143.4, w:3.4, d:2.8, y:0},
    {k:'honey', x:0, z:149, w:6.8, d:4.0},
    {k:'fan', x:0, z:154.5, r:1.8, force:46},
    {k:'wall', x:0, z:157.5, w:8, h:2.3, d:0.8},
    {k:'belt', x:0, z:163, L:7, w:8, speed:2.8, dir:-1},
    {k:'puncher', side:-1, z:161.5, len:3.4, speed:1.5, phase:0},
    {k:'puncher', side: 1, z:164.5, len:3.4, speed:1.6, phase:0.5},
    {k:'boost', x:0, z:169, w:8, d:2.4, push:6.0}
  ],
  coins:[
    [2,0.65,7],[-2,0.65,12],[0,0.65,19],[2,0.65,26],[0,0.65,39.5],
    [0,1.5,51.8],[0,0.65,58],[0,2.6,77],[0,0.65,90],[0,0.65,113.5],
    [0,2.9,134.7],[0,2.9,137.7],[0,0.65,149],[0,3.4,154.5],[0,0.65,169]
  ]
}
];
window.DIFF_LABELS = ['☆ 輕鬆','☆☆ 一般','☆☆☆ 有難度','☆☆☆☆ 很難','☆☆☆☆☆ 地獄'];
