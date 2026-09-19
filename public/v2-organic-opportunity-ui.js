const OPPORTUNITY_ENDPOINT = "/api/v2/organic/opportunities";
const WORKFLOW_ENDPOINT = "/api/v2/organic/action-workflow";

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

      <div class="v2-next-best-action" data-v2-next-best-action hidden>
        <div class="v2-next-best-action-copy">
          <span>#1 NEXT BEST ACTION</span>
          <b data-v2-next-best-action-label>—</b>
          <p data-v2-next-best-action-why>—</p>
        </div>
        <div class="v2-next-best-action-facts">
          <article><span>Priority</span><b data-v2-next-best-action-score>—</b></article>
          <article><span>Page</span><b data-v2-next-best-action-page>—</b></article>
          <article><span>Recommended Query</span><b data-v2-next-best-action-query>—</b></article>
          <article><span>Query Source</span><b data-v2-next-best-action-source>—</b></article>
        </div>
        <div class="v2-next-best-action-buttons">
          <button type="button" data-v2-next-best-open-page>Open Page Keywords</button>
          <button type="button" data-v2-next-best-research>Research Recommended Query</button>
        </div>
      </div>

      <section class="v2-action-queue" data-v2-action-queue>
        <div class="v2-action-queue-head">
          <div><span>TOP ACTION QUEUE</span><b>接下来优先处理的页面</b></div>
          <small><strong data-v2-action-queue-count>0</strong> shown / <strong data-v2-action-queue-candidates>0</strong> active candidates · <strong data-v2-action-queue-hidden>0</strong> hidden · Monitor 已排除</small>
        </div>
        <div class="v2-organic-table-shell">
          <table class="v2-organic-table v2-action-queue-table">
            <thead><tr><th>#</th><th>Workstream</th><th>Action</th><th>Page</th><th>Recommended Query</th><th>Priority</th><th>Confidence</th><th>Workflow</th><th>Why Now</th><th>Next</th></tr></thead>
            <tbody data-v2-action-queue-body><tr><td colspan="10" class="v2-organic-empty">Recalculate 后生成 Top 5 可执行任务。</td></tr></tbody>
          </table>
        </div>
      </section>

      <div class="v2-organic-table-shell">
        <table class="v2-organic-table v2-organic-opportunity-table">
          <thead><tr><th>Priority</th><th>Page</th><th>Action</th><th>Traffic</th><th>Quick Wins</th><th>Down / Lost</th><th>Commercial QW</th><th>GSC Reality</th><th>Score Breakdown</th><th>Confidence</th><th>Workflow</th><th>Next</th></tr></thead>
          <tbody data-v2-organic-opportunities-body><tr><td colspan="12" class="v2-organic-empty">点击 Recalculate，从现有缓存和 D1 证据生成机会。</td></tr></tbody>
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
  const nextBestCard = section.querySelector("[data-v2-next-best-action]");
  const nextBestActionLabel = section.querySelector("[data-v2-next-best-action-label]");
  const nextBestWhy = section.querySelector("[data-v2-next-best-action-why]");
  const nextBestScore = section.querySelector("[data-v2-next-best-action-score]");
  const nextBestPage = section.querySelector("[data-v2-next-best-action-page]");
  const nextBestQuery = section.querySelector("[data-v2-next-best-action-query]");
  const nextBestSource = section.querySelector("[data-v2-next-best-action-source]");
  const nextBestOpenPage = section.querySelector("[data-v2-next-best-open-page]");
  const nextBestResearch = section.querySelector("[data-v2-next-best-research]");
  const actionQueueBody = section.querySelector("[data-v2-action-queue-body]");
  const actionQueueCount = section.querySelector("[data-v2-action-queue-count]");
  const actionQueueCandidates = section.querySelector("[data-v2-action-queue-candidates]");
  const actionQueueHidden = section.querySelector("[data-v2-action-queue-hidden]");
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

  const renderNextBestAction = (data) => {
    const next = data?.next_best_action;
    if (!next?.page) {
      nextBestCard.hidden = true;
      nextBestOpenPage.dataset.v2OpportunityPage = "";
      nextBestResearch.dataset.v2OpportunityKeyword = "";
      return;
    }
    nextBestCard.hidden = false;
    nextBestActionLabel.textContent = next.action_label || next.action || "Review";
    nextBestActionLabel.dataset.action = next.action || "monitor";
    nextBestWhy.textContent = next.why_now || "Top-ranked transparent opportunity from current local evidence.";
    nextBestScore.textContent = num(next.priority_score);
    nextBestPage.textContent = next.page;
    nextBestPage.title = next.page;
    nextBestQuery.textContent = next.query || "No single query selected";
    nextBestQuery.title = next.query || "";
    nextBestSource.textContent = next.query_source === "gsc_query_page"
      ? "GSC Query+Page"
      : next.query_source === "dataforseo_cache"
        ? "DataForSEO cache"
        : "Page-level evidence";
    nextBestOpenPage.dataset.v2OpportunityPage = next.page;
    nextBestResearch.dataset.v2OpportunityKeyword = next.query || "";
    nextBestResearch.disabled = !next.query;
  };

  const workflowBadge = (item) => {
    const badge=document.createElement("span");
    const status=item?.workflow?.status||"new";
    badge.className="v2-workflow-status";
    badge.dataset.status=status;
    badge.textContent=status==="in_progress"?"In Progress":status==="done"?"Done":status==="snoozed"?"Snoozed":"New";
    if(item?.workflow?.snooze_until)badge.title="Snoozed until "+item.workflow.snooze_until;
    return badge;
  };

  const workflowControls = (item) => {
    const wrap=document.createElement("div");
    wrap.className="v2-workflow-controls";
    const status=item?.workflow?.status||"new";
    const add=(label,nextStatus)=>{
      const button=document.createElement("button");
      button.type="button";
      button.textContent=label;
      button.dataset.v2WorkflowStatus=nextStatus;
      button.dataset.v2WorkflowPage=item.page||item.url||"";
      button.dataset.v2WorkflowAction=typeof item.action==="string"?item.action:(item.action?.code||item.next_best_action?.action||"");
      button.dataset.v2WorkflowQuery=item.query||item.next_best_action?.query||"";
      button.dataset.v2WorkflowScore=String(item.priority_score??item.next_best_action?.priority_score??"");
      wrap.append(button);
    };
    if(status==="new"){
      add("Start","in_progress");
      add("Done","done");
      add("Snooze 7d","snoozed");
    }else if(status==="in_progress"){
      add("Done","done");
      add("Snooze 7d","snoozed");
      add("Reset","new");
    }else{
      add("Reopen","new");
    }
    return wrap;
  };

  const renderActionQueue = (data) => {
    const queue = Array.isArray(data?.action_queue) ? data.action_queue : [];
    actionQueueCount.textContent = String(queue.length);
    actionQueueCandidates.textContent = String(data?.workflow_summary?.active_candidates ?? queue.length);
    actionQueueHidden.textContent = String(data?.workflow_summary?.suppressed ?? 0);
    actionQueueBody.replaceChildren();
    if (!queue.length) {
      const row=document.createElement("tr"),cell=document.createElement("td");
      cell.colSpan=10;cell.className="v2-organic-empty";
      cell.textContent=data?.ready
        ? "当前没有需要立即执行的页面；Monitor-only 页面不会进入 Action Queue。"
        : "证据不足，先加载 Organic Keywords / Top Pages 或同步 GSC。";
      row.append(cell);actionQueueBody.append(row);return;
    }

    queue.forEach((item)=>{
      const row=document.createElement("tr");
      const rank=document.createElement("td");rank.textContent=String(item.rank??"—");
      const workstream=document.createElement("td");workstream.className="v2-action-queue-workstream";workstream.dataset.workstream=item.workstream||"monitor";workstream.textContent=item.workstream||"monitor";
      const actionCell=document.createElement("td"),action=document.createElement("span");
      action.className="v2-organic-action";action.dataset.action=item.action||"monitor";action.textContent=item.action_label||item.action||"Review";actionCell.append(action);
      const page=document.createElement("td"),link=document.createElement("a");
      link.href=item.page;link.target="_blank";link.rel="noopener noreferrer";link.className="v2-organic-url v2-opportunity-page";link.textContent=item.page;page.append(link);
      const query=document.createElement("td");query.className="v2-action-queue-query";query.textContent=item.query||"—";
      if(item.query_source)query.title=item.query_source==="gsc_query_page"?"GSC Query+Page":"DataForSEO cache";
      const score=document.createElement("td");score.textContent=num(item.priority_score);
      const confidence=document.createElement("td");confidence.textContent=item.confidence||"—";
      const workflow=document.createElement("td");workflow.className="v2-workflow-cell";workflow.append(workflowBadge(item),workflowControls(item));
      const why=document.createElement("td");why.className="v2-action-queue-why";why.textContent=item.why_now||"—";why.title=item.why_now||"";
      const next=document.createElement("td"),actions=document.createElement("div");actions.className="v2-organic-competitor-actions";
      const pageButton=document.createElement("button");pageButton.type="button";pageButton.dataset.v2OpportunityPage=item.page;pageButton.textContent="Page";
      actions.append(pageButton);
      if(item.query){
        const research=document.createElement("button");research.type="button";research.dataset.v2OpportunityKeyword=item.query;research.textContent="Research";actions.append(research);
      }
      next.append(actions);
      row.append(rank,workstream,actionCell,page,query,score,confidence,workflow,why,next);
      actionQueueBody.append(row);
    });
  };

  const renderRows = (data) => {
    const rows = Array.isArray(data?.opportunities) ? data.opportunities : [];
    body.replaceChildren();
    if (!rows.length) {
      const row=document.createElement("tr"),cell=document.createElement("td");
      cell.colSpan=12;cell.className="v2-organic-empty";
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
      const quickWins=document.createElement("td");
      const dfsQuickWins=item.metrics?.quick_win_keywords??0;
      const gscQuickWins=item.metrics?.gsc_query_opportunities??0;
      quickWins.textContent="DFS "+num(dfsQuickWins)+" · GSC "+num(gscQuickWins);
      const quickWinDetails=[];
      if(item.quick_win_keywords?.length){
        quickWinDetails.push(...item.quick_win_keywords.slice(0,4).map((kw)=>"DFS · "+kw.keyword+" (#"+kw.position+", vol "+(kw.search_volume??"—")+")"));
      }
      if(item.gsc_query_opportunities?.length){
        quickWinDetails.push(...item.gsc_query_opportunities.slice(0,4).map((kw)=>"GSC · "+kw.keyword+" (#"+(kw.position??"—")+", imp "+(kw.impressions??"—")+", vol "+(kw.search_volume??"—")+")"));
      }
      if(quickWinDetails.length)quickWins.title=quickWinDetails.join("\n");
      const risk=document.createElement("td");risk.textContent=num(item.metrics?.declining_keywords)+" / "+num(item.metrics?.lost_keywords);
      const commercial=document.createElement("td");commercial.textContent=num(item.metrics?.commercial_quick_wins);
      const gsc=document.createElement("td");gsc.className="v2-opportunity-gsc";
      if(item.evidence?.gsc_pages){
        const hasPageMetrics=finite(item.metrics?.gsc_impressions)!==null;
        gsc.textContent=hasPageMetrics
          ? "Clicks "+num(item.metrics?.gsc_clicks)+" · Imp "+num(item.metrics?.gsc_impressions)+" · Pos "+num(item.metrics?.gsc_position)
          : "Query signals "+num(item.metrics?.gsc_query_opportunities);
        const details=[];
        if(hasPageMetrics)details.push("Page CTR "+(finite(item.metrics?.gsc_ctr)===null?"—":(item.metrics.gsc_ctr*100).toFixed(2)+"%")+" · Clicks change "+num(item.metrics?.gsc_clicks_change_percent)+"%");
        if(item.gsc_query_opportunities?.length)details.push(...item.gsc_query_opportunities.slice(0,5).map((kw)=>kw.keyword+" · imp "+(kw.impressions??"—")+" · pos "+(kw.position??"—")+" · DFS match "+(kw.provider_match?"yes":"no")));
        gsc.title=details.join("\n");
      }else{
        gsc.textContent="—";
      }
      const breakdown=document.createElement("td");breakdown.className="v2-opportunity-breakdown";
      breakdown.textContent="Base "+num(item.components?.base_score)+" · Risk "+num(item.components?.risk_points)+" · QW "+num(item.components?.quick_win_points)+" · Traffic "+num(item.components?.traffic_points)+" · Intent "+num(item.components?.business_intent_points)+" · GSC +"+num(item.components?.gsc_reality_points);
      const confidence=document.createElement("td");confidence.textContent=item.confidence||"—";
      const workflow=document.createElement("td");workflow.className="v2-workflow-cell";workflow.append(workflowBadge(item));
      if((item.action?.code||"monitor")!=="monitor")workflow.append(workflowControls(item));

      const next=document.createElement("td"),actions=document.createElement("div");actions.className="v2-organic-competitor-actions";
      const pageKeywords=document.createElement("button");pageKeywords.type="button";pageKeywords.dataset.v2OpportunityPage=item.url;pageKeywords.textContent="Page Keywords";
      actions.append(pageKeywords);
      const researchKeyword=item.next_best_action?.query||item.gsc_query_opportunities?.[0]?.keyword||item.quick_win_keywords?.[0]?.keyword;
      if(researchKeyword){
        const research=document.createElement("button");research.type="button";research.dataset.v2OpportunityKeyword=researchKeyword;research.textContent="Research QW";actions.append(research);
      }
      next.append(actions);
      row.append(priority,page,actionCell,traffic,quickWins,risk,commercial,gsc,breakdown,confidence,workflow,next);body.append(row);
    });
  };

  const render = (data) => {
    renderSources(data);
    renderCounts(data);
    renderNextBestAction(data);
    renderActionQueue(data);
    renderRows(data);
    const missing=data?.missing_sources??[];
    meta.textContent=[
      "Opportunity Engine "+(data?.formula?.version??"v0.1"),
      "Cache only · $0",
      missing.length ? "Missing primary: "+missing.join(", ") : "DataForSEO evidence ready",
      data?.sources?.gsc_pages ? "GSC reality ready" : "GSC optional · no stored page data",
      data?.workflow_summary ? "Workflow active "+(data.workflow_summary.active??0)+" · hidden "+(data.workflow_summary.suppressed??0) : null,
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
  const saveWorkflow = async (button) => {
    const siteDomain=hostname(target.value);
    const status=button.dataset.v2WorkflowStatus;
    if(!siteDomain||!status)return;
    const payload={
      site_domain:siteDomain,
      page_url:button.dataset.v2WorkflowPage,
      action_code:button.dataset.v2WorkflowAction,
      query:button.dataset.v2WorkflowQuery||"",
      status,
      priority_score:button.dataset.v2WorkflowScore===""?null:Number(button.dataset.v2WorkflowScore),
    };
    if(status==="snoozed")payload.snooze_until=new Date(Date.now()+7*86400000).toISOString();
    button.disabled=true;
    setStatus?.("正在更新 SEO Action Workflow；只写 D1，本次费用 $0…","info");
    try{
      const response=await fetchImpl(WORKFLOW_ENDPOINT,{
        method:"POST",
        headers:{"content-type":"application/json",accept:"application/json"},
        body:JSON.stringify(payload),
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)throw new Error(result?.error?.message||"Workflow 更新失败");
      loadedForKey=null;
      await load();
      setStatus?.("Workflow 已更新并重新计算 Action Queue，本次费用 $0。","success");
    }catch(error){
      setStatus?.(error?.message||"Workflow 更新失败","error");
    }finally{
      button.disabled=false;
    }
  };

  const openPageKeywords = (pageUrl) => {
    const value=String(pageUrl||"").trim();
    if(!value)return;
    target.value=value;
    target.dispatchEvent(new Event("input",{bubbles:true}));
    activateTab?.(section,"keywords");
  };
  const researchKeyword = (keyword) => {
    const value=String(keyword||"").trim();
    if(!value)return;
    const input=section.closest(".v2-app-shell")?.querySelector("#keyword")||document.querySelector("#keyword");
    if(input){input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));}
    if(globalThis.location)globalThis.location.hash="keywords";
  };

  const handleOpportunityActionClick = (event) => {
    const workflowButton=event.target.closest("[data-v2-workflow-status]");
    if(workflowButton){saveWorkflow(workflowButton);return;}
    const pageButton=event.target.closest("[data-v2-opportunity-page]");
    if(pageButton){openPageKeywords(pageButton.dataset.v2OpportunityPage);return;}
    const keywordButton=event.target.closest("[data-v2-opportunity-keyword]");
    if(keywordButton)researchKeyword(keywordButton.dataset.v2OpportunityKeyword);
  };
  body.addEventListener("click",handleOpportunityActionClick,{signal});
  actionQueueBody.addEventListener("click",handleOpportunityActionClick,{signal});
  nextBestOpenPage.addEventListener("click",()=>openPageKeywords(nextBestOpenPage.dataset.v2OpportunityPage),{signal});
  nextBestResearch.addEventListener("click",()=>researchKeyword(nextBestResearch.dataset.v2OpportunityKeyword),{signal});

  const reset=()=>{loadedForKey=null;};
  target.addEventListener("input",reset,{signal});
  const unsubscribe=context?.subscribe?.(reset)??(()=>{});
  return ()=>unsubscribe();
}
