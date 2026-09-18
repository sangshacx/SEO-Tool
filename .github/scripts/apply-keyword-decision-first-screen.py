from pathlib import Path

html_path = Path("public/v2.html")
html = html_path.read_text()

def replace_once(old, new, label):
    global html
    if old not in html:
        raise SystemExit(f"{label} anchor not found")
    html = html.replace(old, new, 1)

replace_once(
    '<p class="lead">输入关键词，查看标准化搜索指标、趋势、搜索意图与真实 API 成本。</p>',
    '<p class="lead">输入关键词，先判断是否值得做，再按需深入 SERP、关键词机会与内容规划。</p>',
    "keyword lead",
)

old_blocks = """<div id="result" class="hidden">
<div class="metrics">
<div class="metric"><div class="label">月搜索量</div><div class="value" id="volume">—</div><div class="sub">Monthly search volume</div></div>
<div class="metric"><div class="label">关键词难度</div><div class="value" id="difficulty">—</div><div class="sub" id="difficultyText">Keyword difficulty</div></div>
<div class="metric"><div class="label">CPC</div><div class="value" id="cpc">—</div><div class="sub">USD estimate</div></div>
<div class="metric"><div class="label">搜索意图</div><div class="value" id="intent">—</div><div class="sub" id="competition">Competition</div></div>
</div>
<div class="panel scorebox"><div class="scorecircle"><strong id="potentialScore">—</strong><span>Potential Score</span></div><div><div class="section-title">Keyword Potential v0.1</div><div class="decision" id="potentialDecision">—</div><div class="scoreparts"><div class="scorepart"><span class="label">需求</span><b id="scoreDemand">—</b></div><div class="scorepart"><span class="label">可行性</span><b id="scoreFeasibility">—</b></div><div class="scorepart"><span class="label">商业价值</span><b id="scoreCommercial">—</b></div><div class="scorepart"><span class="label">趋势</span><b id="scoreTrend">—</b></div></div><p class="sub" id="potentialConfidence"></p></div></div>"""

new_blocks = """<div id="result" class="hidden">
<div class="panel scorebox keyworddecision"><div class="scorecircle"><strong id="potentialScore">—</strong><span>Keyword Potential</span></div><div><div class="decisionhead"><div><div class="section-title">Keyword Decision</div><div class="sub" id="keywordDecisionStage">初步判断</div></div><span class="decisionbadge">What should I do next?</span></div><div class="decision" id="potentialDecision">—</div><div class="keywordnext" id="keywordNextAction">—</div><p class="sub" id="keywordDecisionReason">—</p><div class="scoreparts"><div class="scorepart"><span class="label">需求</span><b id="scoreDemand">—</b></div><div class="scorepart"><span class="label">可行性</span><b id="scoreFeasibility">—</b></div><div class="scorepart"><span class="label">商业价值</span><b id="scoreCommercial">—</b></div><div class="scorepart"><span class="label">趋势</span><b id="scoreTrend">—</b></div></div><p class="sub" id="potentialConfidence"></p></div></div>
<div class="metrics">
<div class="metric"><div class="label">月搜索量</div><div class="value" id="volume">—</div><div class="sub">Monthly search volume</div></div>
<div class="metric"><div class="label">关键词难度</div><div class="value" id="difficulty">—</div><div class="sub" id="difficultyText">Keyword difficulty</div></div>
<div class="metric"><div class="label">CPC</div><div class="value" id="cpc">—</div><div class="sub">USD estimate</div></div>
<div class="metric"><div class="label">搜索意图</div><div class="value" id="intent">—</div><div class="sub" id="competition">Competition</div></div>
</div>"""
replace_once(old_blocks, new_blocks, "keyword result block")

css = """
.keyworddecision{border-color:#3769b4;background:linear-gradient(145deg,rgba(25,57,105,.9),rgba(12,28,50,.96));margin-top:18px}.decisionhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.decisionbadge{display:inline-flex;padding:5px 9px;border-radius:999px;background:#173966;color:#a9c8f7;font-size:11px;font-weight:800;white-space:nowrap}.keyworddecision .decision{font-size:20px;margin-top:7px}.keywordnext{font-size:15px;font-weight:800;color:#dce9ff;margin-top:4px}.keyworddecision .scoreparts{margin-top:12px}
"""
replace_once("</style>", css + "</style>", "style close")

replace_once(
    '<script type="module" src="./v2-backlink-gap.js"></script>\n<script>',
    '<script type="module" src="./v2-backlink-gap.js"></script>\n<script src="./v2-keyword-decision.js"></script>\n<script>',
    "keyword decision script",
)

old_render = 'function renderPotential(p){if(!p){text("potentialScore","—");text("potentialDecision","评分数据不足");return}text("potentialScore",p.score==null?"—":p.score);text("potentialDecision",p.decision?.label||"—");text("potentialConfidence","置信度 "+p.confidence_score+"/100 · 初步估算，不是收入预测");text("scoreDemand",p.components?.demand?.score??"—");text("scoreFeasibility",p.components?.feasibility?.score??"—");text("scoreCommercial",p.components?.commercial_value?.score??"—");text("scoreTrend",p.components?.trend?.score??"—")}'

new_render = 'function renderPotential(p){const decision=window.KeywordDecisionView?.keywordDecisionSummary?.(p);if(!p){text("potentialScore","—");text("potentialDecision","数据不足");text("keywordNextAction","补全关键词指标后再判断。");text("keywordDecisionReason","当前缺少形成可靠初步判断所需的核心指标。");text("keywordDecisionStage","初步判断 · keyword-decision-ui-v0.1");return}text("potentialScore",p.score==null?"—":p.score);text("potentialDecision",decision?.label||p.decision?.label||"—");text("keywordNextAction",decision?.next_action||"下一步：按需验证 SERP。");text("keywordDecisionReason",decision?.reason||"当前结论仍需结合 SERP 验证。");text("keywordDecisionStage",(decision?.stage||"初步判断")+" · "+(decision?.version||"keyword-potential-v0.1"));text("potentialConfidence","置信度 "+p.confidence_score+"/100 · 初步估算，不是收入预测");text("scoreDemand",p.components?.demand?.score??"—");text("scoreFeasibility",p.components?.feasibility?.score??"—");text("scoreCommercial",p.components?.commercial_value?.score??"—");text("scoreTrend",p.components?.trend?.score??"—")}'
replace_once(old_render, new_render, "renderPotential")

html_path.write_text(html)

test_path = Path("tests/keyword-decision-ui.test.mjs")
tests = test_path.read_text()
marker = 'test("Keyword Explorer first screen leads with a decision before raw metrics"'
if marker not in tests:
    tests += """

test("Keyword Explorer first screen leads with a decision before raw metrics", async () => {
  const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
  assert.match(html, /src="\.\/v2-keyword-decision\.js"/);
  assert.match(html, /id="keywordDecisionStage"/);
  assert.match(html, /id="keywordNextAction"/);
  assert.match(html, /id="keywordDecisionReason"/);
  assert.match(html, /What should I do next\?/);
  assert.match(html, /KeywordDecisionView\?\.keywordDecisionSummary/);
  assert.ok(html.indexOf('class="panel scorebox keyworddecision"') < html.indexOf('class="metrics"'), "decision card must precede raw metrics");
});
"""
test_path.write_text(tests)
