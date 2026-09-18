from pathlib import Path

html_path = Path("public/v2.html")
html = html_path.read_text()

def replace_once(old, new, label):
    global html
    if old not in html:
        raise SystemExit(f"{label} anchor not found")
    html = html.replace(old, new, 1)

old_block = '<div class="panel serpbox"><div class="serphead"><div><div class="section-title">SERP Weakness v0.1</div><div class="sub">按需深度分析，不会自动调用付费 API。</div></div><button id="serpBtn" data-v2-market-research="serpWeakness seoOpportunity" disabled type="button" class="hidden">分析 SERP 弱度</button></div><div id="serpStatus" class="status"></div><div id="serpResult" class="hidden"><div class="serpgrid"><div class="serpmetric"><span class="label">排名弱度</span><b id="rankingWeakness">—</b></div><div class="serpmetric"><span class="label">自然点击机会</span><b id="clickOpportunity">—</b></div><div class="serpmetric"><span class="label">置信度</span><b id="serpConfidence">—</b></div></div><div class="featurelist" id="serpFeatures"></div><div class="featurelist" id="serpMeta"></div></div></div>'
new_block = '<div class="panel serpbox"><div class="serphead"><div><div class="section-title">SERP Reality</div><div class="sub">查看 Top 10 平均竞争强度、SERP 特征和排名突破空间；当前请求不包含逐页 Top 10 URL。</div></div><button id="serpBtn" data-v2-market-research="serpWeakness seoOpportunity" disabled type="button" class="hidden">分析 SERP Reality</button></div><div id="serpStatus" class="status"></div><div id="serpResult" class="hidden"><div class="serprealitysummary"><div><span class="label">竞争现实</span><b id="serpCompetitionLabel">—</b></div><div><span class="label">判断</span><b id="serpDecisionLabel">—</b></div></div><div class="keywordnext" id="serpNextAction">—</div><div class="serpgrid"><div class="serpmetric"><span class="label">排名弱度</span><b id="rankingWeakness">—</b></div><div class="serpmetric"><span class="label">自然点击机会</span><b id="clickOpportunity">—</b></div><div class="serpmetric"><span class="label">置信度</span><b id="serpConfidence">—</b></div><div class="serpmetric"><span class="label">Top 10 平均主域 Rank</span><b id="serpAvgDomainRank">—</b></div><div class="serpmetric"><span class="label">Top 10 平均页面 Rank</span><b id="serpAvgPageRank">—</b></div><div class="serpmetric"><span class="label">Top 10 平均引用域</span><b id="serpAvgRefDomains">—</b></div><div class="serpmetric"><span class="label">SERP 结果数量</span><b id="serpResultCount">—</b></div></div><div class="featurelist" id="serpFeatures"></div><div class="featurelist serplimitation" id="serpLimitation">—</div><div class="featurelist" id="serpMeta"></div></div></div>'
replace_once(old_block, new_block, "SERP block")

css = '.serprealitysummary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.serprealitysummary>div{background:#0b1728;border:1px solid var(--line);border-radius:9px;padding:13px}.serprealitysummary b{display:block;font-size:18px;margin-top:4px}.serplimitation{padding:9px 11px;border-left:3px solid var(--amber);background:#1f1b12;color:#d9c79e}'
replace_once('</style>', css + '</style>', "style close")

replace_once(
    '<script src="./v2-keyword-decision.js"></script>\n<script>',
    '<script src="./v2-keyword-decision.js"></script>\n<script src="./v2-serp-reality.js"></script>\n<script>',
    "SERP Reality script",
)

old_run = 'async function runSerp(){const button=document.getElementById("serpBtn");const keyword=document.getElementById("keyword").value.trim();if(!keyword)return;button.disabled=true;button.textContent="分析中…";const box=document.getElementById("serpStatus");box.textContent="正在读取 SERP 缓存或执行深度分析…";box.className="status on info";try{const r=await submitSeoResearchRequest("serpWeakness",{keyword});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error?.message||"SERP 分析失败");if(!j.data)throw new Error("没有可用的 SERP 数据");const d=j.data,m=j.meta||{};text("rankingWeakness",d.ranking_weakness??"—");text("clickOpportunity",d.organic_click_opportunity??"—");text("serpConfidence",(d.confidence_score??"—")+"/100");text("serpFeatures","检测到的 SERP 特征："+(d.serp_features?.detected?.join("、")||"无"));text("serpMeta",(d.decision?.label||"—")+" · "+(m.cached?"缓存命中":"实时数据")+" · 本次 "+money(m.actual_cost_usd));document.getElementById("serpResult").classList.remove("hidden");await loadOpportunity(keyword);box.textContent=m.cached?"SERP 分析成功：缓存命中，费用 $0。":"SERP 分析成功：实际费用已记录。";await loadUsage()}catch(err){box.textContent=err.message||"SERP 分析失败";box.className="status on error"}finally{button.disabled=false;button.textContent="分析 SERP 弱度"}}'
new_run = 'async function runSerp(){const button=document.getElementById("serpBtn");const keyword=document.getElementById("keyword").value.trim();if(!keyword)return;button.disabled=true;button.textContent="分析中…";const box=document.getElementById("serpStatus");box.textContent="正在读取 SERP 缓存或执行深度分析…";box.className="status on info";try{const r=await submitSeoResearchRequest("serpWeakness",{keyword});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error?.message||"SERP 分析失败");if(!j.data)throw new Error("没有可用的 SERP 数据");const d=j.data,m=j.meta||{},reality=window.SerpRealityView?.serpRealitySummary?.(d);text("rankingWeakness",reality?.ranking_weakness??d.ranking_weakness??"—");text("clickOpportunity",reality?.organic_click_opportunity??d.organic_click_opportunity??"—");text("serpConfidence",(reality?.confidence_score??d.confidence_score??"—")+"/100");text("serpCompetitionLabel",reality?.competition_label||"—");text("serpDecisionLabel",reality?.decision_label||d.decision?.label||"—");text("serpNextAction",reality?.next_action||"下一步：检查具体排名页面。");text("serpAvgDomainRank",reality?.average_main_domain_rank??"—");text("serpAvgPageRank",reality?.average_page_rank??"—");text("serpAvgRefDomains",reality?.average_referring_domains??"—");text("serpResultCount",num(reality?.serp_results_count));text("serpFeatures","检测到的 SERP 特征："+(reality?.detected_features?.join("、")||"无"));text("serpLimitation",reality?.limitation||"当前没有逐页 Top 10 明细。");text("serpMeta",(m.cached?"缓存命中":"实时数据")+" · 本次 "+money(m.actual_cost_usd)+" · SERP Reality "+(reality?.version||"v0.1"));document.getElementById("serpResult").classList.remove("hidden");await loadOpportunity(keyword);box.textContent=m.cached?"SERP Reality 分析成功：缓存命中，费用 $0。":"SERP Reality 分析成功：实际费用已记录。";await loadUsage()}catch(err){box.textContent=err.message||"SERP 分析失败";box.className="status on error"}finally{button.disabled=false;button.textContent="分析 SERP Reality"}}'
replace_once(old_run, new_run, "runSerp")

html_path.write_text(html)

test_path = Path("tests/serp-reality-ui.test.mjs")
tests = test_path.read_text()
if 'SERP Reality UI is wired to existing SERP analysis without another request' not in tests:
    tests += '''

test("SERP Reality UI is wired to existing SERP analysis without another request", async () => {
  const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
  assert.match(html, /src="\.\/v2-serp-reality\.js"/);
  assert.match(html, />SERP Reality</);
  assert.match(html, /id="serpAvgDomainRank"/);
  assert.match(html, /id="serpAvgPageRank"/);
  assert.match(html, /id="serpAvgRefDomains"/);
  assert.match(html, /id="serpResultCount"/);
  assert.match(html, /id="serpLimitation"/);
  assert.match(html, /SerpRealityView\?\.serpRealitySummary/);
  const calls = [...html.matchAll(/submitSeoResearchRequest\("serpWeakness"/g)];
  assert.equal(calls.length, 1);
  assert.match(html, /当前请求不包含逐页 Top 10 URL/);
});
'''
test_path.write_text(tests)
