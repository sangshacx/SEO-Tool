from pathlib import Path

html_path = Path("public/v2.html")
html = html_path.read_text()
shell_path = Path("public/v2-shell.js")
shell = shell_path.read_text()
market_test_path = Path("tests/v2-market-request-wiring.test.mjs")
market_tests = market_test_path.read_text()
serp_test_path = Path("tests/serp-competitors.test.mjs")
serp_tests = serp_test_path.read_text()

def replace_html(old, new, label):
    global html
    if old not in html:
        raise SystemExit(f"{label} anchor not found")
    html = html.replace(old, new, 1)

old_tail = '<div class="featurelist" id="serpFeatures"></div><div class="featurelist serplimitation" id="serpLimitation">—</div><div class="featurelist" id="serpMeta"></div></div></div>'
new_tail = '<div class="featurelist" id="serpFeatures"></div><div class="featurelist serplimitation" id="serpLimitation">—</div><div class="featurelist" id="serpMeta"></div><div class="serpcompetitors"><div class="serpcompetitorshead"><div><div class="section-title">Top 10 SERP Competitors</div><div class="sub">真实 Google 自然结果页面。默认只读 D1 7 天快照；无快照时不会自动付费。</div></div><button id="serpCompetitorsBtn" data-v2-market-research="serpCompetitors" disabled type="button">加载 Top 10 页面</button></div><label class="paidtoggle"><input id="serpCompetitorsAllowPaid" type="checkbox">没有新鲜快照时，允许本次付费 DataForSEO SERP 请求</label><div class="note"><b>Cost Guard：</b>未勾选时只读取 D1；如果没有 7 天内快照，会先提示确认。</div><div id="serpCompetitorsStatus" class="status"></div><div id="serpCompetitorsResult" class="hidden"><div class="tablewrap"><table class="ideastable serpcompetitorstable"><thead><tr><th>排名</th><th>Domain</th><th>页面标题</th><th>URL</th><th>SERP 特征</th></tr></thead><tbody id="serpCompetitorsBody"></tbody></table></div><div id="serpCompetitorsMeta" class="ideasmeta"></div></div></div></div></div>'
replace_html(old_tail, new_tail, "SERP competitors block")

css = '.serpcompetitors{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}.serpcompetitorshead{display:flex;align-items:center;justify-content:space-between;gap:12px}.serpcompetitorshead button{background:#1b3658;border:1px solid #31547d}.serpcompetitorstable{min-width:940px}.serpcompetitorstable td:nth-child(3){white-space:normal;min-width:260px}.serpcompetitorurl{max-width:330px;overflow:hidden;text-overflow:ellipsis;display:block;color:#91b9ff;text-decoration:none}.serpcompetitorurl:hover{text-decoration:underline}.serpflag{display:inline-flex;padding:3px 6px;border-radius:999px;background:#173966;color:#a9c8f7;font-size:10px;font-weight:750;margin-right:4px}'
replace_html('</style>', css + '</style>', "style close")

handler_anchor = 'document.getElementById("serpBtn").addEventListener("click",runSerp);'
handler = '''function renderSerpCompetitors(data,meta){const body=document.getElementById("serpCompetitorsBody");body.replaceChildren();(data.items||[]).forEach(item=>{const tr=document.createElement("tr");const position=document.createElement("td");position.textContent=item.position??"—";tr.appendChild(position);const domain=document.createElement("td");domain.className="keywordcell";domain.textContent=item.domain||"—";tr.appendChild(domain);const title=document.createElement("td");title.textContent=item.title||"—";tr.appendChild(title);const urlCell=document.createElement("td"),link=document.createElement("a");link.className="serpcompetitorurl";link.href=item.url;link.target="_blank";link.rel="noopener noreferrer";link.textContent=item.url||"—";urlCell.appendChild(link);tr.appendChild(urlCell);const flags=document.createElement("td");const values=[];if(item.is_featured_snippet)values.push("Featured snippet");if(item.is_web_story)values.push("Web story");if(!values.length)values.push("Organic");values.forEach(value=>{const badge=document.createElement("span");badge.className="serpflag";badge.textContent=value;flags.appendChild(badge)});tr.appendChild(flags);body.appendChild(tr)});if(!body.children.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="emptyrow";td.textContent="当前快照没有返回自然搜索页面";tr.appendChild(td);body.appendChild(tr)}text("serpCompetitorsMeta",(data.search_engine_domain||"Google")+" · "+(data.checked_at||"时间未知")+" · "+(meta.cached?"D1 快照":"DataForSEO 实时")+" · 本次 "+money(meta.actual_cost_usd)+" · "+(data.disclaimer||""));document.getElementById("serpCompetitorsResult").classList.remove("hidden")}
async function loadSerpCompetitors(){const keyword=document.getElementById("keyword").value.trim(),button=document.getElementById("serpCompetitorsBtn"),allow=document.getElementById("serpCompetitorsAllowPaid"),box=document.getElementById("serpCompetitorsStatus");if(!keyword)return;button.disabled=true;button.textContent="读取中…";box.textContent="正在检查 7 天 D1 Top 10 SERP 快照…";box.className="status on info";try{const response=await submitSeoResearchRequest("serpCompetitors",{keyword,allow_live_request:allow.checked}),result=await response.json();if(response.status===409&&result.error?.code==="LIVE_REQUEST_CONFIRMATION_REQUIRED"){box.textContent="没有 7 天内 Top 10 快照。勾选“允许本次付费 DataForSEO SERP 请求”后再次点击，才会执行实时查询。";return}if(!response.ok||!result.ok)throw new Error(result.error?.message||"Top 10 SERP 页面加载失败");renderSerpCompetitors(result.data,result.meta||{});allow.checked=false;box.textContent=result.meta?.cached?"Top 10 页面读取成功：D1 快照命中，本次费用 $0。":"Top 10 页面读取成功：实际 DataForSEO 费用已记录并保存到 D1。";await loadUsage()}catch(error){box.textContent=error.message||"Top 10 SERP 页面加载失败";box.className="status on error"}finally{button.disabled=false;button.textContent="加载 Top 10 页面"}}
document.getElementById("serpBtn").addEventListener("click",runSerp);document.getElementById("serpCompetitorsBtn").addEventListener("click",loadSerpCompetitors);'''
replace_html(handler_anchor, handler, "SERP handler")

html_path.write_text(html)

endpoint_anchor = '  serpWeakness: "/api/v2/keywords/serp-weakness",\n'
if endpoint_anchor not in shell:
    raise SystemExit("shell endpoint anchor not found")
shell = shell.replace(endpoint_anchor, endpoint_anchor + '  serpCompetitors: "/api/v2/keywords/serp-competitors",\n', 1)
shell_path.write_text(shell)

workflow_anchor = '  ["serpWeakness", { keyword: "waterproof membrane" }],\n'
if workflow_anchor not in market_tests:
    raise SystemExit("market workflow anchor not found")
market_tests = market_tests.replace(workflow_anchor, workflow_anchor + '  ["serpCompetitors", { keyword: "waterproof membrane", allow_live_request: false }],\n', 1)
market_tests = market_tests.replace("executes all six submit paths", "executes all seven submit paths", 1)
market_tests = market_tests.replace("assert.equal(spy.calls.length, 6);", "assert.equal(spy.calls.length, 7);", 1)
market_test_path.write_text(market_tests)

if 'Top 10 SERP UI requires an explicit paid confirmation on cache miss' not in serp_tests:
    serp_tests += '''

test("Top 10 SERP UI requires an explicit paid confirmation on cache miss", async () => {
  const html = await readFile(new URL("../public/v2.html", import.meta.url), "utf8");
  const shell = await readFile(new URL("../public/v2-shell.js", import.meta.url), "utf8");
  assert.match(shell, /serpCompetitors: "\/api\/v2\/keywords\/serp-competitors"/);
  assert.match(html, /id="serpCompetitorsBtn"/);
  assert.match(html, /data-v2-market-research="serpCompetitors"/);
  assert.match(html, /id="serpCompetitorsAllowPaid"/);
  assert.match(html, /LIVE_REQUEST_CONFIRMATION_REQUIRED/);
  assert.match(html, /allow_live_request:allow\.checked/);
  assert.match(html, /id="serpCompetitorsBody"/);
  assert.match(html, /真实 Google 自然结果页面/);
});
'''
serp_test_path.write_text(serp_tests)
