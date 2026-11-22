# -*- coding: utf-8 -*-
# 糖糖大亂鬥 — AI 遊戲開發 Playbook（中文書面語版 + 英文版）
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.oxml.ns import qn

INK    = RGBColor(0x2B, 0x1B, 0x4E)
PINK   = RGBColor(0xFF, 0x5C, 0x9D)
YELLOW = RGBColor(0xFF, 0xD2, 0x3E)
GRAY   = RGBColor(0x55, 0x55, 0x66)
LIGHT  = RGBColor(0xF6, 0xF2, 0xFC)
WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
SOFT   = RGBColor(0xDD, 0xD0, 0xF5)
A = 'ppt-assets/'
CJK = '微軟正黑體'

def set_font(run, size=24, bold=False, color=INK, latin=CJK, italic=False):
    f = run.font
    f.size = Pt(size); f.bold = bold; f.italic = italic
    f.color.rgb = color; f.name = latin
    rPr = run._r.get_or_add_rPr()
    for tag in ('a:ea', 'a:cs'):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {})
            rPr.append(el)
        el.set('typeface', CJK)   # CJK fallback stays JhengHei even in EN deck

def box(slide, x, y, w, h):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True
    return tb, tf

def put(tf, lines, size=22, color=INK, bold=False, space=8):
    first = True
    for txt in lines:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        r = p.add_run(); r.text = txt
        set_font(r, size, bold, color)
        p.space_after = Pt(space)
    return tf

def title_bar(slide, text, sub=None, latin=CJK):
    strip = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(0.16))
    strip.fill.solid(); strip.fill.fore_color.rgb = PINK; strip.line.fill.background()
    tb, tf = box(slide, 0.55, 0.32, 12.2, 1.0)
    tf.text = text
    set_font(tf.paragraphs[0].runs[0], 34, True, INK, latin=latin)
    if sub:
        tb2, tf2 = box(slide, 0.58, 1.12, 12.2, 0.5)
        r = tf2.paragraphs[0].add_run(); r.text = sub
        set_font(r, 16, False, GRAY, latin=latin)

def footer(slide, n, latin=CJK):
    tb, tf = box(slide, 12.35, 7.05, 0.8, 0.4)
    r = tf.paragraphs[0].add_run(); r.text = str(n)
    set_font(r, 12, False, GRAY, latin=latin)
    tf.paragraphs[0].alignment = PP_ALIGN.RIGHT

def step_slide(prs, n, step_no, step_title, prompt, img, img_w, outcomes, latin=CJK):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    title_bar(s, f'{step_no} · {step_title}', latin=latin)
    card = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.55), Inches(1.75), Inches(4.9), Inches(2.6))
    card.fill.solid(); card.fill.fore_color.rgb = LIGHT
    card.line.color.rgb = PINK; card.line.width = Pt(1.5)
    tf = card.text_frame; tf.word_wrap = True
    tf.margin_left = Inches(0.22); tf.margin_right = Inches(0.22); tf.margin_top = Inches(0.15)
    r = tf.paragraphs[0].add_run(); r.text = '💬 PROMPT'
    set_font(r, 15, True, PINK, latin=latin)
    p2 = tf.add_paragraph(); p2.space_before = Pt(6)
    r2 = p2.add_run(); r2.text = prompt
    set_font(r2, 15.5, False, INK, latin=latin)
    tb, tfb = box(s, 0.55, 4.55, 4.9, 2.3)
    put(tfb, ['✓ ' + o for o in outcomes], 16, INK, space=7)
    s.shapes.add_picture(A + img, Inches(5.75), Inches(1.75), width=Inches(img_w))
    footer(s, n, latin=latin)
    return s

def build_deck(L, fname):
    prs = Presentation()
    prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
    latin = L['_latin']

    # 1 cover — title lines sized to never orphan-wrap
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
    bg.fill.solid(); bg.fill.fore_color.rgb = INK; bg.line.fill.background()
    s.shapes.add_picture(A + '00-cover.png', Inches(6.0), Inches(0.9), width=Inches(6.9))
    tb, tf = box(s, 0.7, L['cover_y'], 5.15, L['cover_th'])
    first = True
    for ln in L['cover_title_lines']:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        r = p.add_run(); r.text = ln
        set_font(r, L['cover_ts'], True, WHITE, latin=latin)
    tb2, tf2 = box(s, 0.7, L['cover_sy'], 5.15, 0.9)
    r = tf2.paragraphs[0].add_run(); r.text = L['cover_sub']
    set_font(r, 24, True, YELLOW, latin=latin)
    tb3, tf3 = box(s, 0.7, L['cover_by'], 5.15, 2.4)
    put(tf3, L['cover_lines'], 18, SOFT, space=10)

    # 2 intro
    s = prs.slides.add_slide(prs.slide_layouts[6])
    title_bar(s, L['intro_t'], L['intro_s'], latin=latin)
    tb, tf = box(s, 0.6, 1.9, 5.3, 5.0)
    put(tf, L['intro_b'], 20, INK, space=14)
    s.shapes.add_picture(A + '01-menu.png', Inches(6.15), Inches(1.9), width=Inches(6.75))
    footer(s, 2, latin)

    # 3 dev loop
    s = prs.slides.add_slide(prs.slide_layouts[6])
    title_bar(s, L['loop_t'], L['loop_s'], latin=latin)
    x = 0.55
    for i, st in enumerate(L['loop_steps']):
        ch = s.shapes.add_shape(MSO_SHAPE.CHEVRON, Inches(x), Inches(2.6), Inches(2.42), Inches(1.15))
        ch.fill.solid(); ch.fill.fore_color.rgb = PINK if i % 2 == 0 else INK
        ch.line.fill.background()
        tf = ch.text_frame; tf.word_wrap = False
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
        r = p.add_run(); r.text = st
        set_font(r, 16, True, WHITE, latin=latin)
        x += 2.54
    tb, tf = box(s, 0.7, 4.3, 11.9, 2.2)
    put(tf, L['loop_b'], 20, INK, space=12)
    footer(s, 3, latin)

    # 4 local AI engine
    s = prs.slides.add_slide(prs.slide_layouts[6])
    title_bar(s, L['engine_t'], latin=latin)
    card = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.2), Inches(1.9), Inches(10.9), Inches(1.7))
    card.fill.solid(); card.fill.fore_color.rgb = INK; card.line.fill.background()
    tf = card.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = L['engine_card']
    set_font(r, 28, True, WHITE, latin=latin)
    p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run(); r2.text = L['engine_card_sub']
    set_font(r2, 17, False, SOFT, latin=latin)
    tb, tf = box(s, 1.0, 4.0, 11.3, 2.8)
    put(tf, L['engine_b'], 20, INK, space=13)
    footer(s, 4, latin)

    # 5 tech stack
    s = prs.slides.add_slide(prs.slide_layouts[6])
    title_bar(s, L['tech_t'], L['tech_s'], latin=latin)
    x0, y0, cw, chh, gx, gy = 0.55, 1.85, 4.05, 1.62, 0.12, 0.16
    for i, (t, d) in enumerate(L['tech_cards']):
        cx = x0 + (i % 3) * (cw + gx); cy = y0 + (i // 3) * (chh + gy)
        card = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(cx), Inches(cy), Inches(cw), Inches(chh))
        card.fill.solid(); card.fill.fore_color.rgb = LIGHT
        card.line.color.rgb = PINK; card.line.width = Pt(1.2)
        tf = card.text_frame; tf.word_wrap = True
        tf.margin_left = Inches(0.18); tf.margin_top = Inches(0.08)
        r = tf.paragraphs[0].add_run(); r.text = t
        set_font(r, 18, True, PINK, latin=latin)
        for ln in d.split('\n'):
            p = tf.add_paragraph(); r2 = p.add_run(); r2.text = ln
            set_font(r2, 13.5, False, INK, latin=latin)
    footer(s, 5, latin)

    # 6-13 steps
    for i, (no, tt, pr, img, iw, outs) in enumerate(L['steps']):
        step_slide(prs, 6 + i, no, tt, pr, img, iw, outs, latin=latin)

    # 14 results
    s = prs.slides.add_slide(prs.slide_layouts[6])
    title_bar(s, L['res_t'], L['res_s'], latin=latin)
    x = 0.55
    for v, t in L['res_cards']:
        card = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(1.8), Inches(2.32), Inches(1.35))
        card.fill.solid(); card.fill.fore_color.rgb = LIGHT; card.line.color.rgb = PINK; card.line.width = Pt(1.2)
        tf = card.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
        r = p.add_run(); r.text = v
        set_font(r, 30, True, PINK, latin=latin)
        p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
        r2 = p2.add_run(); r2.text = t
        set_font(r2, 14, False, INK, latin=latin)
        x += 2.44
    cd = CategoryChartData()
    cd.categories = L['res_chart_cats']
    cd.add_series(L['res_chart_series'], L['res_chart_vals'])
    gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.8), Inches(3.45), Inches(8.4), Inches(3.6), cd)
    chart = gf.chart
    chart.has_legend = False
    plot = chart.plots[0]
    plot.has_data_labels = True
    plot.data_labels.font.size = Pt(13)
    plot.data_labels.font.bold = True
    ser = plot.series[0]
    ser.format.fill.solid(); ser.format.fill.fore_color.rgb = PINK
    tb, tf = box(s, 9.5, 3.7, 3.4, 3.0)
    put(tf, L['res_note'], 16, INK, space=6)
    footer(s, 14, latin)

    prs.save(fname)
    print('saved:', fname, '| slides:', len(prs.slides._sldIdLst))

# ==================== 中文書面語版 ====================
ZH = {
 '_latin': CJK,
 'cover_title_lines': ['AI 遊戲開發實戰手冊'],
 'cover_y': 1.5, 'cover_th': 1.0, 'cover_ts': 34, 'cover_sy': 2.55, 'cover_by': 3.8,
 'cover_sub': '糖糖大亂鬥 SUGAR RUSH ROYALE',
 'cover_lines': ['一個提示 → 一款完整 3D 網頁遊戲', '全程本地 AI 推理開發', '2026 年 11 月'],
 'intro_t': '這是一款怎樣的遊戲？',
 'intro_s': 'Fall Guys 式 3D 糖果賽跑 · 純網頁技術，開啟瀏覽器即玩',
 'intro_b': [
   '• 5 大主題關卡：糖果街 / 泡泡工廠 / 果凍峽谷 / 蜂蜜危機 / 糖霜風暴',
   '• 20+ 種動態機關：風車、滾球、塌落地板、拳套、風扇、旋轉圓盤……',
   '• 本地 4 人鍵盤對戰，AI 機器人補位至 10 人混戰',
   '• 直式分屏：每位玩家擁有獨立跟蹤鏡頭',
   '• 一條賽道約 60–75 秒完成，限時 115–135 秒'],
 'loop_t': '如何做到？人機協作開發流程',
 'loop_s': '每個環節都是「提示 → 生成 → 實測 → 修正」的循環',
 'loop_steps': ['提示詞', 'AI 生成', '瀏覽器實測', 'AI 除錯', '發佈'],
 'loop_b': [
   '• 開發者角色：明確表達需求（關卡設計、手感、難度），試玩後給予反饋',
   '• AI 角色：生成代碼與關卡數據，並自行編寫測試模擬器進行驗證',
   '• 循環極快：一項改動從提示到可玩，通常在數分鐘內完成'],
 'engine_t': '開發引擎：全程本地 AI 推理',
 'engine_card': 'ZGX NANO（GB10 AI 超級電腦）× GLM-5.3-Flash-FP8',
 'engine_card_sub': 'vLLM 本地推理服務 · 對話式開發 · 數據不出機房',
 'engine_b': [
   '• ZGX NANO：桌面級 AI 超級電腦，FP8 量化大模型即開即用',
   '• GLM-5.3-Flash-FP8：整個遊戲的代碼、關卡數據、AI 對手與測試腳本均由其生成',
   '• 無需雲端 API：零數據外洩、無 Token 費用、內網延遲低，迭代速度快'],
 'tech_t': '遊戲技術棧',
 'tech_s': '純網頁標準技術，無需安裝任何插件',
 'tech_cards': [
   ('3D 渲染', 'three.js 0.160\nACES 色調映射\nUnrealBloom 泛光'),
   ('物理引擎', '自研 120Hz 固定步長\n膠囊 vs AABB 碰撞\n40m/s 極速零穿牆'),
   ('關卡系統', '程序化生成\n20+ 種機關 builder\n數據驅動（JSON 式）'),
   ('AI 對手', '反應式威脅場評分\n彈道跳距計算\n與玩家同一套物理'),
   ('多人分屏', '4 鍵盤即插即玩\n直式分屏渲染\n獨立跟蹤鏡頭'),
   ('品質保障', 'Node 冒煙測試\nAI 全場模擬驗證\n自適應解析度保 60fps')],
 'steps': [
   ('Step 1', '玩法與關卡研究',
    '「查閱《糖豆人 Fall Guys》的玩法與經典關卡機關，整理出可在 3D 賽跑遊戲中實現的機關清單與設計準則。」',
    '02-l1-gameplay.png', 7.0,
    ['整理出風車、滾球、擺錘等 10+ 種經典機關原型', '訂立賽道節奏準則：每 6–10 秒一個新挑戰', '第一條賽道即時生成，開局即可遊玩']),
   ('Step 2', '五大關卡藍圖',
    '「重寫 levels.js：5 大主題關卡（糖果街／泡泡工廠／果凍峽谷／蜂蜜危機／糖霜風暴），每關 140–172 米，難度遞增，一般玩家 60–75 秒完成。」',
    '03-l2-factory.png', 7.0,
    ['5 條賽道全部數據驅動，調整難度只需修改一個檔案', '每關擁有獨立主題色、天空、水面與裝飾', '自動校驗：所有缺口跳距 ≤ 玩家跳躍射程']),
   ('Step 3', '機關工廠',
    '「build.js 實現 20+ 種機關 builder：風車、橫掃滾球、塌落地板、旋轉圓盤、拳套、風扇上升氣流、加速帶……，每關加入主題裝飾。」',
    '04-l3-canyon.png', 7.0,
    ['每種機關 = 外觀模型 + 碰撞體 + 每幀動畫', '機關全部在地板上方掃過，絕不穿板（已逐一驗證）', '主題裝飾：棒棒糖森林／蜂蜜六角巢／風暴晶柱']),
   ('Step 4', '物理與操作手感',
    '「固定 120Hz 步長膠囊物理：逐步碰撞解算杜絕穿牆；4 組鍵盤操作（WASD／方向鍵／IJKL／TFGH），最高速度 6.2m/s、跳躍射程 4.1m。」',
    '05-l4-honey.png', 7.0,
    ['40–60 m/s 極速撞牆測試：零穿透、零異常彈跳', '糖豆人跌倒→爬起→撲倒全套動作', '操作手感反覆調校：最高速度由 7.2 降至 6.2 m/s']),
   ('Step 5', 'AI 機器人對手',
    '「bots.js 反應式 AI：方向採樣評分避開機關、彈道跳距計算跨越斷橋、掃臂位破局計時器；與玩家共用同一套物理。」',
    '06-l5-storm.png', 7.0,
    ['10 隻機器人各有性格（速度 0.72–1.05 倍）', '懂得跳缺口、搭渡輪平台、藉風扇氣流升空過牆', '永遠不會卡死：多層破局安全網']),
   ('Step 6', '本地 4 人對戰＋分屏',
    '「4 人鍵盤本地對戰：直式分屏（vertical split），每位玩家一個全高欄位＋獨立跟蹤鏡頭，機器人補位至 10 人混戰。」',
    '07-split4.png', 7.0,
    ['按所屬鍵即時加入（P2 方向鍵／P3 IJKL／P4 TFGH）', '1P 全屏 → 2P/3P/4P 自動直式分屏', 'P1 可用滑鼠轉視角，其他人固定向前']),
   ('Step 7', 'AI 生成遊戲封面',
    '「用 AI 圖像模型生成遊戲封面：糖果豆人賽跑場景、遠景棒棒糖與風車、大標題『糖糖大亂鬥 SUGAR RUSH ROYALE』，派對遊戲風格。」',
    '00-cover.png', 4.6,
    ['以遊戲實際畫面截圖作為參考圖', '生成商業級封面：標題、角色、場景一次到位', '封面同時用作主選單背景']),
   ('Step 8', '自動化測試與除錯',
    '「AI 全場快進模擬（每關 9 隻機器人自動跑完全程）＋穿牆極限測試（40–60 m/s 撞牆），反覆修正直至 9/9 完成、零錯誤。」',
    '08-results.png', 7.0,
    ['內置同步模擬器：一條指令跑完整場比賽', '機關穿板、AI 卡死、平台縫隙等 30+ 個 bug 自動捕捉', '最終狀態：5 關全部 9/9 完成、零運行時錯誤'])],
 'res_t': '開發成果',
 'res_s': '全部指標為真實遊戲內自動化測試數據',
 'res_cards': [('5','主題關卡'),('20+','動態機關'),('10','人混戰'),('0','穿牆事故'),('9/9','AI 完成率')],
 'res_chart_cats': ['L1 糖果街','L2 泡泡工廠','L3 果凍峽谷','L4 蜂蜜危機','L5 糖霜風暴'],
 'res_chart_series': 'AI 最快完成時間（秒）',
 'res_chart_vals': (20.9, 29.8, 37.7, 35.7, 33.8),
 'res_note': ['每關 AI 最快 21–38 秒', '（人類約 40–70 秒完成，', '符合約 75 秒目標）'],
}

# ==================== English version ====================
EN = {
 '_latin': 'Segoe UI',
 'cover_title_lines': ['AI Game Development', 'Playbook'],
 'cover_y': 1.35, 'cover_th': 2.0, 'cover_ts': 30, 'cover_sy': 3.5, 'cover_by': 4.6,
 'cover_sub': 'SUGAR RUSH ROYALE',
 'cover_lines': ['One prompt → a complete 3D web game', 'Built with fully local AI inference', 'November 2026'],
 'intro_t': 'What is this game?',
 'intro_s': 'Fall Guys-style 3D candy racing · Pure web tech, runs in any browser',
 'intro_b': [
   '• 5 themed levels: Candy Street / Bubble Factory / Jelly Canyon / Honey Crisis / Sugar Storm',
   '• 20+ dynamic obstacles: windmills, rollers, collapsing tiles, gloves, fans, discs…',
   '• Local 4-player keyboard versus, AI bots fill up to 10 racers',
   '• Vertical split-screen: an independent follow camera per player',
   '• Each track clears in ~60–75s, time limit 115–135s'],
 'loop_t': 'How was it built? The human-AI development loop',
 'loop_s': 'Every step is a "Prompt → Generate → Test → Fix" cycle',
 'loop_steps': ['Prompt', 'AI builds', 'Playtest', 'AI fixes', 'Ship'],
 'loop_b': [
   '• Developer role: express requirements clearly (levels, game feel, difficulty) and give feedback after playtesting',
   '• AI role: generates code and level data, then writes its own test simulators for verification',
   '• Extremely fast loop: from prompt to playable usually within minutes'],
 'engine_t': 'The development engine: fully local AI inference',
 'engine_card': 'ZGX NANO (GB10 AI Supercomputer) × GLM-5.3-Flash-FP8',
 'engine_card_sub': 'vLLM local inference · Conversational development · Data never leaves the machine room',
 'engine_b': [
   '• ZGX NANO: desktop-class AI supercomputer, FP8-quantized LLMs ready out of the box',
   '• GLM-5.3-Flash-FP8: generated all of the game\'s code, level data, AI opponents and test scripts',
   '• No cloud APIs: zero data leakage, no token costs, low-latency LAN, faster iteration'],
 'tech_t': 'Technology Stack',
 'tech_s': 'Pure web-standard technologies — nothing to install',
 'tech_cards': [
   ('3D rendering', 'three.js 0.160\nACES tone mapping\nUnrealBloom glow'),
   ('Physics engine', 'Custom 120Hz fixed-step\nCapsule vs AABB collisions\nZero tunneling at 40m/s'),
   ('Level system', 'Procedural generation\n20+ obstacle builders\nData-driven (JSON-style)'),
   ('AI opponents', 'Reactive threat-field scoring\nBallistic jump-range math\nSame physics as players'),
   ('Split-screen', '4 keyboards plug-and-play\nVertical split rendering\nIndependent follow cams'),
   ('Quality assurance', 'Node smoke tests\nAI full-race simulation\nAdaptive resolution keeps 60fps')],
 'steps': [
   ('Step 1', 'Gameplay & level research',
    '"Research Fall Guys gameplay and classic course obstacles; compile a list of mechanics implementable in a 3D racing game, with design guidelines."',
    '02-l1-gameplay.png', 7.0,
    ['Compiled 10+ classic obstacle archetypes: windmills, rollers, pendulums…', 'Established a pacing rule: a new challenge every 6–10 seconds', 'The first track was generated immediately — playable from the start']),
   ('Step 2', 'Five level blueprints',
    '"Rewrite levels.js: 5 themed levels (Candy Street / Bubble Factory / Jelly Canyon / Honey Crisis / Sugar Storm), 140–172m each, rising difficulty, casual players clear in 60–75s."',
    '03-l2-factory.png', 7.0,
    ['All 5 tracks are data-driven — difficulty tuning touches one file', 'Each level has its own palette, sky, water and decorations', 'Automated validation: every gap ≤ the player jump range']),
   ('Step 3', 'The obstacle factory',
    '"Implement 20+ obstacle builders in build.js: windmills, sweeping rollers, collapsing tiles, spin discs, boxing gloves, updraft fans, boost pads… plus per-theme decorations."',
    '04-l3-canyon.png', 7.0,
    ['Every obstacle = visual mesh + collider + per-frame animation', 'All hazards sweep above the floor — never clip through (verified one by one)', 'Themed decor: lollipop forests / honeycomb clusters / storm crystals']),
   ('Step 4', 'Physics & game feel',
    '"Fixed 120Hz step capsule physics with stepped collision resolution to eliminate tunneling; 4 keyboard layouts (WASD / arrows / IJKL / TFGH), top speed 6.2m/s, jump range 4.1m."',
    '05-l4-honey.png', 7.0,
    ['40–60 m/s wall-slam tests: zero tunneling, zero abnormal bounces', 'Full bean animation set: trip → get up → dive', 'Game feel iterated repeatedly: top speed tuned from 7.2 down to 6.2 m/s']),
   ('Step 5', 'AI bot opponents',
    '"bots.js reactive AI: direction-sampling scores to dodge obstacles, ballistic jump-range math for gaps, escape timers at sweeper zones; sharing the exact same physics as players."',
    '06-l5-storm.png', 7.0,
    ['10 bots with individual personalities (0.72–1.05× speed)', 'They jump gaps, ride ferries and hover in fan columns to clear walls', 'Never permanently stuck: layered escape safety nets']),
   ('Step 6', 'Local 4-player + split-screen',
    '"4-player local keyboard versus: vertical split-screen, one full-height column per player with an independent follow camera; AI bots fill up to 10 racers."',
    '07-split4.png', 7.0,
    ['Press your keys to join instantly (P2 arrows / P3 IJKL / P4 TFGH)', '1P fullscreen → 2P/3P/4P automatic vertical splits', 'P1 can orbit the camera with the mouse; others face forward']),
   ('Step 7', 'AI-generated cover art',
    '"Generate the game cover with an AI image model: candy bean racers on a track, lollipops and windmills in the background, big title \'SUGAR RUSH ROYALE\', party-game style."',
    '00-cover.png', 4.6,
    ['In-game screenshots were fed to the model as reference images', 'Commercial-grade cover: title, characters and scene in one pass', 'The cover doubles as the main-menu background']),
   ('Step 8', 'Automated testing & debugging',
    '"AI full-race fast-forward simulation (9 bots completing each level automatically) + tunneling stress tests (40–60 m/s wall slams), iterating until 9/9 finish with zero errors."',
    '08-results.png', 7.0,
    ['Built-in synchronous simulator: run a whole race with one command', 'Auto-caught 30+ bugs: obstacle clipping, stuck AI, platform seams…', 'Final state: all 5 levels finished 9/9, zero runtime errors'])],
 'res_t': 'Results',
 'res_s': 'All metrics come from real in-game automated tests',
 'res_cards': [('5','Themed levels'),('20+','Dynamic obstacles'),('10','Racers per race'),('0','Tunneling incidents'),('9/9','AI finish rate')],
 'res_chart_cats': ['L1 Candy St.', 'L2 Bubble Fac.', 'L3 Jelly Cyn.', 'L4 Honey Cr.', 'L5 Sugar St.'],
 'res_chart_series': 'AI fastest clear time (s)',
 'res_chart_vals': (20.9, 29.8, 37.7, 35.7, 33.8),
 'res_note': ['AI fastest per level: 21–38s', '(humans finish in ~40–70s,', 'meeting the ~75s target)'],
}

build_deck(ZH, '糖糖大亂鬥_AI開發Playbook.pptx')
build_deck(EN, 'AI_Game_Development_Playbook_EN.pptx')
