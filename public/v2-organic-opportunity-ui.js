const OPPORTUNITY_ENDPOINT = "/api/v2/organic/opportunities";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function num(value) {
  const number = finite(value);
  return number === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number);
}

function hostname(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function organicOpportunityPanelMarkup() {
  return `
    <div class="v2-organic-panel" data-v2-organic-panel="opportunities" hidden>
      <div class="v2-organic-opportunity-head">
        <div>
          <b>Opportunity Center</b>
          <span>把 DataForSEO 缓存与已同步的 GSC D1 证据转换成下一步页面行动。这个决策层固定 $0，不会发起 DataForSEO 或 Google 请求。</span>
        </div>
        <button type="button" data-v2-organic-opportunities-run>Recalculate · $0</button>
      </div>

      <div class="v2-organic-opportunity-sources">
        <article data-v2-opportunity-source="organic_keywords"><span>Organic Keywords</span><b>Not loaded</b><small>用于 4–20 位 Quick Wins、KD、Volume、Intent</small><button type="button" data-v2-opportunity-go="keywords">Open Organic Keywords</button></article>
        <article data-v2-opportunity-source="top_pages"><span>Top Pages</span><b>Not loaded</b><small>用于页面 Traffic、Top 10、Up/Down/Lost 风险</small><button type="button" data-v2-opportunity-go="pages">Open Top Pages</button></article>
        <article data-v2-opportunity-source="gsc_pages"><span>GSC Performance</span><b>Optional</b><small>用于真实 Impressions、CTR、Position 与 Clicks 变化</small><button type="button" data-v2-opportunity-go="gsc">Open GSC Performance</button></article>
      </div>

      <div class="v2-organic-opportunity-metrics">
        <article><span>Pages Reviewed</span><b data-v2-opportunity-count="total">—</b></article>
        <article><span>Optimize</span><b data-v2-opportunity-count="optimize">—</b></article>
        <article><span>Recover / Reclaim</span><b data-v2-opportunity-count="recover">—</b></article>
        <article><span>Scale / Protect</span><b data-v2-opportunity-count="growth">—</b></article>
      </div>

      <div class="v2-organic-opportunity-note">
        Priority Score = DataForSEO Base Score + GSC Reality Adjustment，最高 100。没有 GSC 时保持原基础分；有 GSC 时才追加最多 +20。
      </div>

      <div class="v2-organic-table-shell">
        <table class="v2-organic-table v2-organic-opportunity-table">
          <thead><tr><th>Priority</th><th>Page</th><th>Action</th><th>Traffic</th><th>Quick Wins</th><th>Down / Lost</th><th>Commercial QW</th><th>GSC Reality</th><th>Score Breakdown</th><th>Confidence</th><th>Next</th></tr></thead>
          <tbody data-v2-organic-opportunities-body><tr><td colspan="11" class="v2-organic-empty">点击 Recalculate，从现有缓存和 D1 证据生成机会。</td></tr></tbody>
        </table>
      </div>
      <div class="v2-organic-summary" data-v2-organic-opportunities-meta>Cache-only decision layer · $0</div>
    </div>
  `;
}

export function summarizeOpportunityCounts(data = {}) {
  const counts = data?.summary?.action_counts ?? {};
  return {
    total: data?.summary?.total_pages ?? 0,
    optimize: (counts.optimize ?? 0) + (counts.ctr_opportunity ?? 0),
    recover: (counts.recover ?? 0) + (counts.reclaim ?? 0),
    growth: (counts.scale ?? 0) + (counts.protect ?? 0),
  };
}

export function mountOrganicOpportunityTab({
  section,
  target,
  context,
  fetchImpl,
  signal,
  activateTab,
  setStatus,
} = {}) {
  if (!section) return () => {};
  const run = section.querySelector("[data-v2-organic-opportunities-run]");
  const body = section.querySelector("[data-v2-organic-opportunities-body]");
  const meta = section.querySelector("[data-v2-organic-opportunities-meta]");
  const opportunityTab = section.querySelector('[data-v2-organic-tab="opportunities"]');
  const sourceCards = {
    organic_keywords: section.querySelector('[data-v2-opportunity-source="organic_keywords"]'),
    top_pages: section.querySelector('[data-v2-opportunity-source="top_pages"]'),
    gsc_pages: section.querySelector('[data-v2-opportunity-source="gsc_pages"]'),
  };
  let loadedForKey = null;

  const scopeKey = () => {
    const market = context?.get?.();
    return [hostname(target.value), market?.location_code, market?.language_code].join(":");
  };

  const renderSources = (data) => {
    for (const source of ["organic_keywords","top_pages","gsc_pages"]) {
      const card = sourceCards[source];
      const status = card?.querySelector("b");
      const evidence = data?.sources?.[source];
      if (!card || !status) continue;
      card.dataset.available = evidence?.available ? "true" : "false";
      if (source === "gsc_pages") {
        status.textContent = evidence?.available
          ? "Ready · " + (evidence.latest_date ?? "stored") + " · " + (evidence.coverage?.current_days ?? 0) + "/" + (evidence.coverage?.requested_days ?? 28) + " days"
          : "Optional · no D1 data";
      } else {
        status.textContent = evidence?.available
          ? "Ready · depth " + (evidence.depth ?? "—")
          : "Missing cache";
      }
    }
  };

  const renderCounts = (data) => {
    const counts = summarizeOpportunityCounts(data);
    Object.entries(counts).forEach(([key,value]) => {
      const node = section.querySelector('[data-v2-opportunity-count="' + key + '"]');
      if (node) node.textContent = num(value);
    });
  };

  const renderRows = (data) => {
    const rows = Array.isArray(data?.opportunities) ? data.opportunities : [];
    body.replaceChildren();
    if (!rows.length) {
      const row=document.createElement("tr"),cell=document.createElement("td");
      cell.colSpan=11;cell.className="v2-organic-empty";
      cell.textContent=(data?.missing_sources?.length ?? 0)
        ? "证据不足：先加载上方标记为 Missing cache 的模块；Opportunity Center 本身不会产生 API 费用。"
        : "当前缓存没有生成可展示的页面机会。";
      row.append(cell);body.append(row);return;
    }
    rows.slice(0,100).forEach((item)=>{
      const row=document.createElement("tr");
      const priority=document.createElement("td"), score=document.createElement("b");
      score.className="v2-opportunity-score";score.textContent=num(item.priority_score);priority.append(score);

      const page=document.createElement("td"),link=document.createElement("a");
      link.href=item.url;link.target="_blank";link.rel="noopener noreferrer";link.className="v2-organic-url v2-opportunity-page";link.textContent=item.relative_url||item.url;page.append(link);

      const actionCell=document.createElement("td"),action=document.createElement("span");
      action.className="v2-organic-action";action.dataset.action=item.action?.code||"monitor";action.textContent=item.action?.label||"Monitor";action.title=item.action?.reason||"";actionCell.append(action);

      const traffic=document.createElement("td");traffic.textContent=num(item.metrics?.organic_traffic);
      const quickWins=document.createElement("td");quickWins.textContent=num(item.metrics?.quick_win_keywords);
      if(item.quick_win_keywords?.length){
        quickWins.title=item.quick_win_keywords.slice(0,5).map((kw)=>kw.keyword+" (#"+kw.position+", vol "+(kw.search_volume??"—")+")").join("\n");
      }
      const risk=document.createElement("td");risk.textContent=num(item.metrics?.declining_keywords)+" / "+num(item.metrics?.lost_keywords);
      const commercial=document.createElement("td");commercial.textContent=num(item.metrics?.commercial_quick_wins);
      const gsc=document.createElement("td");gsc.className="v2-opportunity-gsc";
      gsc.textContent=item.evidence?.gsc_pages
        ? "Clicks "+num(item.metrics?.gsc_clicks)+" · Imp "+num(item.metrics?.gsc_impressions)+" · Pos "+num(item.metrics?.gsc_position)
        : "—";
      if(item.evidence?.gsc_pages)gsc.title="CTR "+(finite(item.metrics?.gsc_ctr)===null?"—":(item.metrics.gsc_ctr*100).toFixed(2)+"%")+" · Clicks change "+num(item.metrics?.gsc_clicks_change_percent)+"%";
      const breakdown=document.createElement("td");breakdown.className="v2-opportunity-breakdown";
      breakdown.textContent="Base "+num(item.components?.base_score)+" · Risk "+num(item.components?.risk_points)+" · QW "+num(item.components?.quick_win_points)+" · Traffic "+num(item.components?.traffic_points)+" · Intent "+num(item.components?.business_intent_points)+" · GSC +"+num(item.components?.gsc_reality_points);
      const confidence=document.createElement("td");confidence.textContent=item.confidence||"—";

      const next=document.createElement("td"),actions=document.createElement("div");actions.className="v2-organic-competitor-actions";
      const pageKeywords=document.createElement("button");pageKeywords.type="button";pageKeywords.dataset.v2OpportunityPage=item.url;pageKeywords.textContent="Page Keywords";
      actions.append(pageKeywords);
      if(item.quick_win_keywords?.[0]?.keyword){
        const research=document.createElement("button");research.type="button";research.dataset.v2OpportunityKeyword=item.quick_win_keywords[0].keyword;research.textContent="Research QW";actions.append(research);
      }
      next.append(actions);
      row.append(priority,page,actionCell,traffic,quickWins,risk,commercial,gsc,breakdown,confidence,next);body.append(row);
    });
  };

  const render = (data) => {
    renderSources(data);
    renderCounts(data);
    renderRows(data);
    const missing=data?.missing_sources??[];
    meta.textContent=[
      "Opportunity Engine "+(data?.formula?.version??"v0.1"),
      "Cache only · $0",
      missing.length ? "Missing primary: "+missing.join(", ") : "DataForSEO evidence ready",
      data?.sources?.gsc_pages ? "GSC reality ready" : "GSC optional · no stored page data",
      data?.disclaimer,
    ].filter(Boolean).join(" · ");
  };

  const load = async () => {
    const market=context?.get?.();
    const domain=hostname(target.value);
    if(!domain||!market?.location_code||!market?.language_code)return;
    run.disabled=true;setStatus?.("正在从现有 Organic 缓存计算 Opportunity Center，本次费用 $0…","info");
    try{
      const response=await fetchImpl(OPPORTUNITY_ENDPOINT,{
        method:"POST",
        headers:{"content-type":"application/json",accept:"application/json"},
        body:JSON.stringify({target:domain,location_code:market.location_code,language_code:market.language_code}),
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.ok)throw new Error(payload?.error?.message||"Opportunity Center 计算失败");
      loadedForKey=scopeKey();render(payload.data);activateTab?.(section,"opportunities");
      setStatus?.(
        payload.data?.ready
          ? "Opportunity Center 已重算：只读取缓存，本次费用 $0。"
          : "Opportunity Center 暂缺证据：先加载 Organic Keywords / Top Pages，本次费用仍为 $0。",
        payload.data?.ready?"success":"warning"
      );
    }catch(error){setStatus?.(error?.message||"Opportunity Center 计算失败","error");}
    finally{run.disabled=false;}
  };

  run.addEventListener("click",load,{signal});
  opportunityTab?.addEventListener("click",()=>{
    activateTab?.(section,"opportunities");
    if(loadedForKey!==scopeKey())load();
  },{signal});
  section.querySelectorAll("[data-v2-opportunity-go]").forEach((button)=>button.addEventListener("click",()=>activateTab?.(section,button.dataset.v2OpportunityGo),{signal}));
  body.addEventListener("click",(event)=>{
    const pageButton=event.target.closest("[data-v2-opportunity-page]");
    if(pageButton){target.value=pageButton.dataset.v2OpportunityPage;target.dispatchEvent(new Event("input",{bubbles:true}));activateTab?.(section,"keywords");return;}
    const keywordButton=event.target.closest("[data-v2-opportunity-keyword]");
    if(keywordButton){
      const input=section.closest(".v2-app-shell")?.querySelector("#keyword")||document.querySelector("#keyword");
      if(input){input.value=keywordButton.dataset.v2OpportunityKeyword;input.dispatchEvent(new Event("input",{bubbles:true}));}
      if(globalThis.location)globalThis.location.hash="keywords";
    }
  },{signal});

  const reset=()=>{loadedForKey=null;};
  target.addEventListener("input",reset,{signal});
  const unsubscribe=context?.subscribe?.(reset)??(()=>{});
  return ()=>unsubscribe();
}
