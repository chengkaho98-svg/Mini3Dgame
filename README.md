# 🍬 糖糖大亂鬥 SUGAR RUSH ROYALE

致敬《Fall Guys》嘅 3D 糖果物理闖關賽跑網頁遊戲。5 大主題關卡、20 種機關、
本地 **4 人鍵盤對戰（直切分屏）**＋AI 機械人補位至 10 人混戰，附即時勝率分析
同粵語 AI 評述。

![cover](cover.jpg)

## 🎮 線上玩

**https://chengkaho98-svg.github.io/Mini3Dgame/** — 開個網址即玩，唔使安裝。
（AI 評述要本地模型，線上版冇；其餘功能一樣。）

本機執行：

```bash
npm start            # = node server.js，開 http://127.0.0.1:8077/
```

遊戲本身係純靜態網頁，唔一定要 `server.js`：任何靜態 server 都得（例如
`python -m http.server 8077`）。`server.js` 額外提供 `/api/commentate` 代理，
等瀏覽器可以呼叫你局域網入面嘅 vLLM 做 AI 評述。three.js 已隨 repo 附上
（`vendor/three/`），執行時唔倚賴任何 CDN。

## ⌨️ 控制

| 玩家 | 移動 | 跳躍 | 撲倒 |
|------|------|------|------|
| P1 | W A S D | Space | 左 Shift |
| P2 | ↑ ↓ ← → | 右 Ctrl / Enter / Num0 | 右 Shift / `/` |
| P3 | I J K L | U | O |
| P4 | T F G H | Y | R |

- 喺主選單撳所屬嘅移動鍵即時加入（或撳「＋ 鍵盤玩家」）；人類上限 4 位
- 撳色圓圈換顏色（所有冇人用嘅色都轉到）；✕ 移除
- 2–4 人：每人一欄全高畫面，各自有名牌、名次、勝率、提示同鍵盤燈
- P1 滑鼠拖曳轉視角、滾輪縮放；Esc 暫停（暫停畫面有完整排名）

## 🎯 玩法

- **🍬 硬幣＝糖分加速**：每執一粒，之後成場跑快 1.5%（最多 10 粒，+15%）；
  跌落水會跌甩 3 粒。機械人唔會執，全部留返俾玩家。硬幣多數放喺要跳先掂到
  或者較偏嘅路線，執唔執由你。
- **星數**：用時 ≤ 限時 45% 三星、≤ 70% 兩星，否則一星。每位玩家每關都有
  自己嘅個人最佳時間同星數。
- **🏁 AI 勝率**：右邊排名面板（分屏時係自己嗰欄）顯示每位選手此刻嘅奪冠機率。
- **🎙 AI 評述**（可選）：接駁本地 LLM，每 12 秒講一句粵語現場評述。

## 🏁 五大關卡

| # | 關卡 | 長度（限時） | 主打機關 |
|---|------|------|----------|
| 1 | 糖果街 Candy Street | 140m（115s） | 風車陣、軟糖柱、加速帶斷橋、大球 |
| 2 | 泡泡工廠 Bubble Factory | 150m（125s） | 逆向往後推嘅輸送帶、拳套巷、下沉升降板、壓碎機 |
| 3 | 果凍峽谷 Jelly Canyon | 158m（130s） | 旋轉圓盤、渡輪平台、獨木橋、彈床島鏈 |
| 4 | 蜂蜜危機 Honey Crisis | 165m（130s） | 蜂蜜黏液、擺錘、旋轉掃臂、壓碎機牆 |
| 5 | 糖霜風暴 Sugar Storm | 172m（135s） | 塌落地板橋、風扇氣流過峽谷同高牆 |

一般玩家約 60–80 秒完成一關。

## 🧠 技術

- **three.js 0.160**（隨 repo 附上）＋ ACES 色調映射＋ UnrealBloom 泛光＋ SSAO
  ＋ 基於影像嘅環境光（RoomEnvironment / PMREM）＋ 糖果清漆材質
- **固定 120Hz 步長物理**：膠囊 vs AABB、圓形軟糖柱碰撞、逐步解算
- 跳躍有輸入緩衝（0.15s）同土狼時間（0.12s）；撲倒、加速帶空中觸發
- 畫面與碰撞一致：風車葉、擺錘、壓碎機掃過地板上方；掃臂碰撞體等於畫面高度
- 分屏：每位玩家獨立鏡頭＋獨立後處理鏈；自適應解像度
- **AI 機械人**：方向採樣＋威脅場評分；缺口用專用嘅「著陸點控制」——量度到
  著陸面近端嘅距離、按拋物線計可行性、空中每一步微調水平速度
- **即時分析**（`analytics.js`）：按領先幅度、配速、失誤率計 softmax 勝率

## 🔊 音訊

所有音效（跳、落地、彈床、撞擊、落水、硬幣、倒數、勝利／失敗）都係
WebAudio 即時合成，冇取樣檔。音樂係可選：將 `bgm_menu.mp3`、`bgm_race.mp3`、
`jingle_win.mp3`、`jingle_lose.mp3` 放入 `assets/audio/` 就會自動載入
（詳見 `assets/audio/README.md`）。

## 🎙 AI 評述（本地 LLM）

```bash
SRR_LLM_URL=http://<vLLM 主機>:<埠>/v1   SRR_LLM_MODEL=<模型名>  npm start
```

`server.js` 將瀏覽器嘅請求轉發去 OpenAI 兼容嘅 `/v1/chat/completions`
（`chat_template_kwargs: {thinking:false}`）。開遊戲後剔「🎙 AI 評述」即可。
偵測唔到 server（例如線上版）嗰陣，該選項會自動收起。

## 🧪 測試

```bash
npm test              # 全部：Node 測試＋瀏覽器回歸套件（約 20 秒）
npm run test:node     # 關卡幾何、關卡數據、DOM id 契約
npm run test:browser  # 真實遊戲入面跑：機關、bot、軟糖柱、手感、勝率、UI、硬幣
```

瀏覽器套件以 `index.html?test=1` 喺 headless Chrome／Edge 入面載入**真實遊戲**
（唔開 WebGL）並用 `window._DBG` 快轉模擬，唔需要安裝任何 npm 套件。

| 套件 | 重點 |
|---|---|
| geometry | 5 關可興建、無 NaN 碰撞體、最大斷橋 ≤ 可跳距離、每塊塌落方塊有獨立材質、資源可釋放 |
| levels | 關卡數據完整、機關唔超出路面、非島嶼機關唔會位於坑洞上 |
| dom-contract | 程式查找嘅每個元素 id 都喺 index.html 存在 |
| obstacles | 風車葉永不插入路面、掃臂碰撞體＝畫面高度、塌落方塊係咁郁 |
| bots | 每關 9 隻 bot 全部完成，跌落次數喺預算內（L3 圓盤／渡輪另設上限） |
| bumpers | 217 個角度撞向所有軟糖柱：零卡死、零彈落水 |
| human mechanics | 跑速、跳距、跳躍緩衝、土狼時間、加速帶、重生安全 |
| analytics | 勝率加起上嚟係 100%、分出勝負後歸零 |
| ui | toast 真係出現、換色轉齊 10 隻、選單喺 720p 唔使捲（1／2／4 位玩家）、四人分屏每欄有自己嘅 HUD |
| coins & results | 執硬幣加速、bot 唔執、跌落甩硬幣、每位玩家有結算卡同個人最佳 |

## 📁 檔案

| 檔案 | 內容 |
|------|------|
| `index.html` | 頁面、UI、樣式、import map |
| `levels.js` | 5 關數據（幾何＋機關＋提示） |
| `build.js` | 場景工廠＋20 種機關 builder＋空間查詢 |
| `main.js` | 物理核心、競速流程、輸入、鏡頭、HUD、音訊 |
| `bots.js` | AI 機械人腦 |
| `analytics.js` | 即時勝率同事件 |
| `commentator.js` | AI 評述（HUD 走馬燈） |
| `server.js` | 開發用靜態 server＋LLM 代理 |
| `vendor/three/` | three.js 0.160（`tools/vendor-three.js` 下載） |
| `tests/` | 回歸測試 |
| `cover.png` / `cover.jpg` | AI 生成封面（原圖／網頁用壓縮版） |
| `build_ppt.py`、`ppt-assets/` | 生成客戶簡報 |

## 📖 AI 開發 Playbook

雙語 20 頁客戶演示簡報，由 `build_ppt.py` 生成：

- `糖糖大亂鬥_AI開發Playbook.pptx` — 中文書面語版
- `AI_Game_Development_Playbook_EN.pptx` — English edition

內容：遊戲簡介、開發流程、本地 AI 引擎（ZGX NANO × GLM-5.3-Flash-FP8）、技術棧、
13 個開發步驟（Prompt＋實際截圖）、成果指標。`render_ppt.ps1` 可渲染預覽圖。

## 📄 授權

MIT（見 `LICENSE`）。遊戲係致敬作品，同《Fall Guys》嘅版權持有人無關。
