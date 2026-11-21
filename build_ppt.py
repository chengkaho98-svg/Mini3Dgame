# -*- coding: utf-8 -*-
# 糖糖大亂鬥 — AI 遊戲開發 Playbook (ppt-master pipeline)
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.oxml.ns import qn

INK    = RGBColor(0x2B, 0x1B, 0x4E)   # deep plum
PINK   = RGBColor(0xFF, 0x5C, 0x9D)   # candy pink accent
YELLOW = RGBColor(0xF5, 0xB8, 0x00)   # candy yellow (darkened for text)
GRAY   = RGBColor(0x55, 0x55, 0x66)
LIGHT  = RGBColor(0xF6, 0xF2, 0xFC)   # light lavender bg
WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
GREEN  = RGBColor(0x2E, 0x7D, 0x32)

A = 'ppt-assets/'
FONT = '微軟正黑體'

def set_font(run, size=24, bold=False, color=INK, name=FONT, italic=False):
    f = run.font
    f.size = Pt(size); f.bold = bold; f.italic = italic
    f.color.rgb = color; f.name = name
    # East-Asian typeface so CJK renders in JhengHei, not fallback
    rPr = run._r.get_or_add_rPr()
    for tag in ('a:ea', 'a:cs'):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {})
            rPr.append(el)
        el.set('typeface', name)

def box(slide, x, y, w, h):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True
    return tb, tf

def put(tf, lines, size=22, color=INK, bold=False, space=8, first_clear=True):
    first = True
    for txt in lines:
        p = tf.paragraphs[0] if (first and first_clear) else tf.add_paragraph()
        first = False
        r = p.add_run(); r.text = txt
        set_font(r, size, bold, color)
        p.space_after = Pt(space)
    return tf

def title_bar(slide, text, sub=None):
    # candy top strip
    strip = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(0.16))
    strip.fill.solid(); strip.fill.fore_color.rgb = PINK; strip.line.fill.background()
    tb, tf = box(slide, 0.55, 0.32, 12.2, 1.0)
    tf.text = text
    set_font(tf.paragraphs[0].runs[0], 34, True, INK)
    if sub:
        tb2, tf2 = box(slide, 0.58, 1.12, 12.2, 0.5)
        r = tf2.paragraphs[0].add_run(); r.text = sub
        set_font(r, 16, False, GRAY)

def footer(slide, n):
    tb, tf = box(slide, 12.35, 7.05, 0.8, 0.4)
    r = tf.paragraphs[0].add_run(); r.text = str(n)
    set_font(r, 12, False, GRAY)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.RIGHT

def step_slide(prs, n, step_no, step_title, prompt, img, img_w, outcomes):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    title_bar(s, f'Step {step_no} · {step_title}')
    # prompt box (left)
    card = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.55), Inches(1.75), Inches(4.9), Inches(2.6))
    card.fill.solid(); card.fill.fore_color.rgb = LIGHT
    card.line.color.rgb = PINK; card.line.width = Pt(1.5)
    tf = card.text_frame; tf.word_wrap = True
    tf.margin_left = Inches(0.22); tf.margin_right = Inches(0.22); tf.margin_top = Inches(0.15)
    r = tf.paragraphs[0].add_run(); r.text = '💬 PROMPT'
    set_font(r, 15, True, PINK)
    p2 = tf.add_paragraph(); r2 = p2.add_run(); r2.text = prompt
    set_font(r2, 15.5, False, INK)
    p2.space_before = Pt(6)
    # outcome bullets under prompt
    tb, tfb = box(s, 0.55, 4.55, 4.9, 2.3)
    first = True
    for o in outcomes:
        para = tfb.paragraphs[0] if first else tfb.add_paragraph()
        first = False
        r = para.add_run(); r.text = '✓ ' + o
        set_font(r, 16, False, INK)
        para.space_after = Pt(7)
    # screenshot (right)
    pic = s.shapes.add_picture(A + img, Inches(5.75), Inches(1.75), width=Inches(img_w))
    footer(s, n)
    return s

prs = Presentation()
prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)

# ---------- 1. Cover ----------
s = prs.slides.add_slide(prs.slide_layouts[6])
bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
bg.fill.solid(); bg.fill.fore_color.rgb = INK; bg.line.fill.background()
pic = s.shapes.add_picture(A + '00-cover.png', Inches(6.0), Inches(0.9), width=Inches(6.9))
tb, tf = box(s, 0.7, 1.5, 5.1, 1.6)
r = tf.paragraphs[0].add_run(); r.text = 'AI 遊戲開發 Playbook'
set_font(r, 40, True, WHITE)
tb2, tf2 = box(s, 0.7, 2.9, 5.1, 1.2)
r = tf2.paragraphs[0].add_run(); r.text = '糖糖大亂鬥 SUGAR RUSH ROYALE'
set_font(r, 24, True, RGBColor(0xFF, 0xD2, 0x3E))
tb3, tf3 = box(s, 0.7, 4.1, 5.1, 2.4)
put(tf3, ['一個提示 → 一個完整 3D 網頁遊戲', '全程本地 AI 推理開發', '2026 年 11 月'], 18, RGBColor(0xDD, 0xD0, 0xF5), space=10)

# ---------- 2. 遊戲簡介 ----------
s = prs.slides.add_slide(prs.slide_layouts[6])
title_bar(s, '呢個遊戲係乜？', 'Fall Guys 式 3D 糖果賽跑 · 純網頁技術，開 browser 即玩')
tb, tf = box(s, 0.6, 1.9, 5.3, 5.0)
put(tf, [
    '• 5 大主題關卡：糖果街 / 泡泡工廠 / 果凍峽谷 / 蜂蜜危機 / 糖霜風暴',
    '• 20+ 種動態機關：風車、滾球、塌落地板、拳套、風扇、圓盤…',
    '• 本地 4 人鍵盤對戰＋AI 機械人補位至 10 人混戰',
    '• 直切分屏：每位玩家獨立追蹤鏡頭',
    '• 一條賽道約 60–75 秒完成，限時 115–135 秒',
], 20, INK, space=14)
s.shapes.add_picture(A + '01-menu.png', Inches(6.15), Inches(1.9), width=Inches(6.75))
footer(s, 2)

# ---------- 3. 開發流程 ----------
s = prs.slides.add_slide(prs.slide_layouts[6])
title_bar(s, '點樣做到？人機協作開發流程', '每一個環節都係「提示 → 生成 → 實測 → 修正」嘅循環')
steps = ['撰寫提示詞', 'AI 生成代碼', '瀏覽器實測', 'AI 除錯修正', '版本發佈']
x = 0.55; w = 2.42; gap = 0.12
for i, st in enumerate(steps):
    ch = s.shapes.add_shape(MSO_SHAPE.CHEVRON, Inches(x), Inches(2.6), Inches(w), Inches(1.15))
    ch.fill.solid(); ch.fill.fore_color.rgb = PINK if i % 2 == 0 else INK
    ch.line.fill.background()
    tf = ch.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = st
    set_font(r, 18, True, WHITE)
    x += w + gap
tb, tf = box(s, 0.7, 4.3, 11.9, 2.2)
put(tf, [
    '• 開發者角色：寫清楚需求（關卡設計、手感、難度）、玩過之後俾反饋',
    '• AI 角色：出代碼、出關卡數據、自己寫測試模擬器自我驗證',
    '• 循環極快：一個改動由提示到可玩，通常幾分鐘內完成',
], 20, INK, space=12)
footer(s, 3)

# ---------- 4. 本地 AI 引擎 ----------
s = prs.slides.add_slide(prs.slide_layouts[6])
title_bar(s, '開發引擎：全程本地 AI 推理')
card = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.2), Inches(1.9), Inches(10.9), Inches(1.7))
card.fill.solid(); card.fill.fore_color.rgb = INK; card.line.fill.background()
tf = card.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
r = p.add_run(); r.text = 'ZGX NANO（GB10 AI 超級電腦）× GLM-5.3-Flash-FP8'
set_font(r, 28, True, WHITE)
p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
r2 = p2.add_run(); r2.text = 'vLLM 本地推理服務 · 對話式開發 · 數據不出機房'
set_font(r2, 17, False, RGBColor(0xDD, 0xD0, 0xF5))
tb, tf = box(s, 1.0, 4.0, 11.3, 2.8)
put(tf, [
    '• ZGX NANO：桌面級 AI 超級電腦，FP8 量化大模型即開即用',
    '• GLM-5.3-Flash-FP8：全個遊戲嘅代碼、關卡數據、AI 對手、測試腳本都係由佢生成',
    '• 唔使雲端 API：零數據外洩、無 token 費用、內網延遲低，迭代速度快',
], 20, INK, space=13)
footer(s, 4)

# ---------- 5. 技術棧 ----------
s = prs.slides.add_slide(prs.slide_layouts[6])
title_bar(s, '遊戲技術棧', '純網頁標準技術，無需安裝任何插件')
cards = [
    ('3D 渲染', 'three.js 0.160\nACES 色調映射\nUnrealBloom 泛光'),
    ('物理引擎', '自研 120Hz 固定步長\n膠囊 vs AABB 碰撞\n40m/s 極速零穿牆'),
    ('關卡系統', '程序化生成\n20+ 種機關 builder\n數據驅動（JSON 式）'),
    ('AI 對手', '反應式威脅場評分\n彈道跳距計算\n與玩家同一套物理'),
    ('多人分屏', '4 鍵盤即插即玩\n直切分屏渲染\n獨立追蹤鏡頭'),
    ('品質保障', 'Node 冒煙測試\nAI 全場模擬驗證\n自適應解析度保 60fps'),
]
x0, y0, cw, chh, gx, gy = 0.55, 1.85, 4.05, 1.62, 0.12, 0.16
for i, (t, d) in enumerate(cards):
    cx = x0 + (i % 3) * (cw + gx); cy = y0 + (i // 3) * (chh + gy)
    card = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(cx), Inches(cy), Inches(cw), Inches(chh))
    card.fill.solid(); card.fill.fore_color.rgb = LIGHT
    card.line.color.rgb = PINK; card.line.width = Pt(1.2)
    tf = card.text_frame; tf.word_wrap = True
    tf.margin_left = Inches(0.18); tf.margin_top = Inches(0.08)
    r = tf.paragraphs[0].add_run(); r.text = t
    set_font(r, 18, True, PINK)
    for ln in d.split('\n'):
        p = tf.add_paragraph(); r2 = p.add_run(); r2.text = ln
        set_font(r2, 13.5, False, INK)
footer(s, 5)

# ---------- Steps 6-13 ----------
step_slide(prs, 6, 1, '玩法與關卡研究',
    '「上網查閱《糖豆人 Fall Guys》嘅玩法同經典關卡機關，整理出可以喺 3D 賽跑遊戲實現嘅機關清單同設計準則。」',
    '02-l1-gameplay.png', 7.0,
    ['整理出風車、滾球、擺錘等 10+ 種經典機關原型', '訂立賽道節奏準則：每 6–10 秒一個新挑戰', '第一條賽道即時生成，開波已經可以玩'])
step_slide(prs, 7, 2, '五大關卡藍圖',
    '「重寫 levels.js：5 大主題關卡（糖果街／泡泡工廠／果凍峽谷／蜂蜜危機／糖霜風暴），每關 140–172 米，難度遞增，一般玩家 60–75 秒完成。」',
    '03-l2-factory.png', 7.0,
    ['5 條賽道全部數據驅動，改難度只改一個檔案', '每關有獨立主題色、天空、水面同裝飾', '自動校驗：所有缺口跳距 ≤ 玩家跳躍射程'])
step_slide(prs, 8, 3, '機關工廠',
    '「build.js 實現 20+ 種機關 builder：風車、橫掃滾球、塌落地板、旋轉圓盤、拳套、風扇上升氣流、加速帶…，每關加主題裝飾。」',
    '04-l3-canyon.png', 7.0,
    ['每種機關 = 外觀模型 + 碰撞體 + 每幀動畫', '機關全部喺地板上方掃過，絕不穿板（已逐一驗證）', '主題裝飾：棒棒糖森林／蜂蜜六角巢／風暴晶柱'])
step_slide(prs, 9, 4, '物理與操作手感',
    '「固定 120Hz 步長膠囊物理：逐步碰撞解算杜絕穿牆；4 組鍵盤操作（WASD／方向鍵／IJKL／TFGH），最高速度 6.2m/s、跳躍射程 4.1m。」',
    '05-l4-honey.png', 7.0,
    ['40–60 m/s 極速撞牆測試：零穿透、零彈跳異常', '糖豆人跌倒→爬起→撲倒全套動作', '操作手感反覆調校：由 7.2m/s 減到 6.2m/s'])
step_slide(prs, 10, 5, 'AI 機械人對手',
    '「bots.js 反應式 AI：方向採樣評分避開機關、彈道跳距計算過斷橋、掃臂位破局計時器；同玩家共用同一套物理。」',
    '06-l5-storm.png', 7.0,
    ['10 隻機械人各有性格（速度 0.72–1.05 倍）', '識跳缺口、搭渡輪平台、企風扇氣流升空過牆', '永遠唔會卡死：多層破局安全網'])
step_slide(prs, 11, 6, '本地 4 人對戰＋分屏',
    '「4 人鍵盤本地對戰：直切分屏（vertical split），每位玩家一個全高欄位＋獨立追蹤鏡頭，機械人補位至 10 人混戰。」',
    '07-split4.png', 7.0,
    ['撳所屬鍵即刻加入（P2 方向鍵／P3 IJKL／P4 TFGH）', '1P 全屏 → 2P/3P/4P 自動直切分屏', 'P1 可用滑鼠轉視角，其他人固定向前'])
step_slide(prs, 12, 7, 'AI 生成遊戲封面',
    '「用 AI 圖像模型生成遊戲封面：糖果豆人賽跑場景、遠景棒棒糖與風車、大標題『糖糖大亂鬥 SUGAR RUSH ROYALE』，派對遊戲風格。」',
    '00-cover.png', 4.6,
    ['以遊戲實際畫面截圖做參考圖餵給模型', '生成商業級封面：標題、角色、場景一次到位', '封面同時用作用戶選單背景'])
step_slide(prs, 13, 8, '自動化測試與除錯',
    '「AI 全場快進模擬（每關 9 隻機械人自動跑完全程）＋穿牆極限測試（40–60 m/s 撞牆），反覆修正直至 9/9 完成、零錯誤。」',
    '08-results.png', 7.0,
    ['內置同步模擬器：一條指令跑完成場比賽', '機關穿板、AI 卡死、平台縫隙等 30+ 個 bug 自動捉出', '最終狀態：5 關全部 9/9 完成、零運行時錯誤'])

# ---------- 14. 成果指標 ----------
s = prs.slides.add_slide(prs.slide_layouts[6])
title_bar(s, '開發成果', '全部指標為真實遊戲內自動化測試數據')
# metric cards
mets = [('5', '主題關卡'), ('20+', '動態機關'), ('10', '人混戰'), ('0', '穿牆事故'), ('9/9', 'AI 完成率')]
x = 0.55
for v, t in mets:
    card = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(1.8), Inches(2.32), Inches(1.35))
    card.fill.solid(); card.fill.fore_color.rgb = LIGHT; card.line.color.rgb = PINK; card.line.width = Pt(1.2)
    tf = card.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = v
    set_font(r, 30, True, PINK)
    p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run(); r2.text = t
    set_font(r2, 14, False, INK)
    x += 2.44
# native column chart: AI fastest clear time per level
cd = CategoryChartData()
cd.categories = ['L1 糖果街', 'L2 泡泡工廠', 'L3 果凍峽谷', 'L4 蜂蜜危機', 'L5 糖霜風暴']
cd.add_series('AI 最快完成時間（秒）', (20.9, 29.8, 37.7, 35.7, 33.8))
gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.8), Inches(3.45), Inches(8.4), Inches(3.6), cd)
chart = gf.chart
chart.has_legend = False
plot = chart.plots[0]
plot.has_data_labels = True
dl = plot.data_labels
dl.font.size = Pt(13); dl.font.bold = True
ser = plot.series[0]
ser.format.fill.solid(); ser.format.fill.fore_color.rgb = PINK
tb, tf = box(s, 9.5, 3.7, 3.4, 3.0)
put(tf, ['每關 AI 最快', '21–38 秒', '（人類約 40–70 秒完成，', '符合約 75 秒目標）'], 16, INK, space=6)
footer(s, 14)

prs.save('糖糖大亂鬥_AI開發Playbook.pptx')
print('PPTX saved:', '糖糖大亂鬥_AI開發Playbook.pptx', '| slides:', len(prs.slides._sldIdLst))
