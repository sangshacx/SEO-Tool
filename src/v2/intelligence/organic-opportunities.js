export const ORGANIC_OPPORTUNITY_VERSION = "organic-opportunity-v0.4";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function volumeBandPoints(volume) {
  const value = finite(volume) ?? 0;
  if (value >= 1000) return 5;
  if (value >= 300) return 4;
  if (value >= 100) return 3;
  if (value >= 30) return 2;
  if (value > 0) return 1;
  return 0;
}

function kdMultiplier(kd) {
  const value = finite(kd);
  if (value === null) return 1;
  if (value <= 30) return 1.15;
  if (value <= 50) return 1;
  if (value <= 70) return 0.85;
  return 0.65;
}

export function keywordQuickWinPoints(row = {}) {
  const position = finite(row.position);
  if (position === null || position < 4 || position > 20) return 0;
  const rankMultiplier = position <= 10 ? 1.2 : 0.8;
  return Math.round(volumeBandPoints(row.search_volume) * rankMultiplier * kdMultiplier(row.keyword_difficulty) * 300) / 100;
}

function trafficPoints(traffic) {
  const value = finite(traffic) ?? 0;
  if (value >= 1000) return 20;
  if (value >= 300) return 16;
  if (value >= 100) return 12;
  if (value >= 30) return 8;
  if (value > 0) return 4;
  return 0;
}

function percentChange(current, previous) {
  const now = finite(current);
  const before = finite(previous);
  if (now === null || before === null || before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 10000) / 100;
}

function gscRealityPoints(row = {}) {
  if (!row) return 0;
  const impressions = finite(row.impressions) ?? 0;
  const position = finite(row.position);
  const clicks = finite(row.clicks) ?? 0;
  const ctr = impressions > 0 ? clicks / impressions : finite(row.ctr) ?? 0;
  const clicksChange = row.change?.clicks_percent ?? percentChange(clicks, row.previous_clicks);

  let points = impressions >= 1000 ? 8 : impressions >= 300 ? 6 : impressions >= 100 ? 4 : impressions >= 30 ? 2 : 0;
  if (position !== null && position >= 4 && position <= 15) points += 6;
  else if (position !== null && position > 15 && position <= 30) points += 3;
  if (position !== null && position <= 10 && impressions >= 100 && ctr < 0.03) points += 4;
  if (clicksChange !== null && clicksChange <= -20 && impressions >= 50) points += 7;
  else if (clicksChange !== null && clicksChange >= 20 && impressions >= 50) points += 2;
  return Math.min(20, Math.round(points * 100) / 100);
}

function buildGscPageEvidence(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const url = canonicalUrl(row?.primary_key ?? row?.page_url ?? row?.url);
    if (!url) continue;
    map.set(url, { ...row, url });
  }
  return map;
}

function isGscQueryOpportunity(row = {}) {
  const impressions = finite(row.impressions) ?? 0;
  const clicks = finite(row.clicks) ?? 0;
  const position = finite(row.position);
  const ctr = impressions > 0 ? clicks / impressions : finite(row.ctr) ?? 0;
  const clicksChange = row.change?.clicks_percent ?? percentChange(clicks, row.previous_clicks);
  return Boolean(
    impressions >= 30 &&
    (
      (position !== null && position >= 4 && position <= 20) ||
      (position !== null && position <= 10 && impressions >= 100 && ctr < 0.03) ||
      (clicksChange !== null && clicksChange <= -20 && impressions >= 50)
    )
  );
}

function buildGscQueryPageEvidence(rows = [], keywordEvidence = new Map()) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const url = canonicalUrl(row?.secondary_key ?? row?.page_url ?? row?.url);
    const query = String(row?.primary_key ?? row?.query ?? "").trim();
    if (!url || !query || !isGscQueryOpportunity(row)) continue;
    const keyword = keywordEvidence.get(url);
    const provider = keyword?.keyword_lookup?.get(query.toLowerCase()) ?? null;
    const impressions = finite(row.impressions) ?? 0;
    const clicks = finite(row.clicks) ?? 0;
    const current = grouped.get(url) ?? [];
    current.push({
      keyword: query,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : finite(row.ctr),
      position: finite(row.position),
      clicks_change_percent: row.change?.clicks_percent ?? percentChange(clicks, row.previous_clicks),
      action: row.action ?? null,
      gsc_points: gscRealityPoints(row),
      search_volume: finite(provider?.search_volume),
      keyword_difficulty: finite(provider?.keyword_difficulty),
      provider_position: finite(provider?.position),
      intent: provider?.intent?.primary ?? provider?.intent ?? null,
      cpc_usd: finite(provider?.cpc_usd),
      provider_match: Boolean(provider),
    });
    grouped.set(url, current);
  }

  for (const [url, rowsForPage] of grouped) {
    rowsForPage.sort((a, b) =>
      (b.gsc_points ?? 0) - (a.gsc_points ?? 0) ||
      (b.impressions ?? 0) - (a.impressions ?? 0) ||
      (a.position ?? 999) - (b.position ?? 999)
    );
    grouped.set(url, rowsForPage.slice(0, 8));
  }
  return grouped;
}

function businessIntent(row) {
  return ["commercial", "transactional"].includes(String(row?.intent?.primary ?? "").toLowerCase());
}

function buildKeywordEvidence(keywordRows = []) {
  const grouped = new Map();
  for (const row of keywordRows) {
    const url = canonicalUrl(row?.ranking_url);
    if (!url) continue;
    const current = grouped.get(url) ?? {
      url,
      sampled_keywords: 0,
      sampled_traffic: 0,
      quick_win_points_raw: 0,
      quick_win_keywords: [],
      commercial_quick_wins: 0,
      keyword_lookup: new Map(),
    };
    current.sampled_keywords += 1;
    current.sampled_traffic += finite(row.estimated_traffic) ?? 0;
    const normalizedKeyword = String(row.keyword ?? "").trim().toLowerCase();
    if (normalizedKeyword) current.keyword_lookup.set(normalizedKeyword, row);
    const quickWin = keywordQuickWinPoints(row);
    if (quickWin > 0) {
      current.quick_win_points_raw += quickWin;
      current.quick_win_keywords.push({
        keyword: row.keyword ?? null,
        position: finite(row.position),
        search_volume: finite(row.search_volume),
        keyword_difficulty: finite(row.keyword_difficulty),
        estimated_traffic: finite(row.estimated_traffic),
        intent: row.intent?.primary ?? null,
        points: quickWin,
      });
      if (businessIntent(row)) current.commercial_quick_wins += 1;
    }
    grouped.set(url, current);
  }
  for (const value of grouped.values()) {
    value.quick_win_keywords.sort((a, b) =>
      (b.points ?? 0) - (a.points ?? 0) ||
      (b.search_volume ?? 0) - (a.search_volume ?? 0)
    );
    value.quick_win_keywords = value.quick_win_keywords.slice(0, 8);
  }
  return grouped;
}

function actionFor({ lost, down, up, quickWinCount, top10, keywords, traffic, gsc, gscQueryOpportunityCount, gscQueryRecoveryCount, gscQueryCtrOpportunityCount }) {
  if (lost > 0) return { code: "reclaim", label: "Reclaim", reason: "The page lost ranked keywords in the latest provider comparison." };
  if (down >= Math.max(3, Math.ceil(keywords * 0.2))) return { code: "recover", label: "Recover", reason: "Declining rankings are material relative to the page's keyword footprint." };

  const gscImpressions = finite(gsc?.impressions) ?? 0;
  const gscClicks = finite(gsc?.clicks) ?? 0;
  const gscPosition = finite(gsc?.position);
  const gscCtr = gscImpressions > 0 ? gscClicks / gscImpressions : finite(gsc?.ctr) ?? 0;
  const gscClicksChange = gsc?.change?.clicks_percent ?? percentChange(gscClicks, gsc?.previous_clicks);
  if (gscClicksChange !== null && gscClicksChange <= -20 && gscImpressions >= 50) {
    return { code: "recover", label: "Recover", reason: "Stored GSC clicks are down at least 20% while the page still has meaningful impressions." };
  }
  if (gscQueryRecoveryCount > 0) {
    return { code: "recover", label: "Recover", reason: "At least one high-impression Query+Page combination has a meaningful stored GSC click decline." };
  }
  if (
    (gscPosition !== null && gscPosition <= 10 && gscImpressions >= 100 && gscCtr < 0.03) ||
    gscQueryCtrOpportunityCount > 0
  ) {
    return { code: "ctr_opportunity", label: "Improve CTR", reason: gscQueryCtrOpportunityCount > 0 ? "At least one high-impression Top-10 Query+Page combination has stored GSC CTR below 3%." : "Stored GSC data shows Top-10 visibility and meaningful impressions but CTR below 3%." };
  }
  if (quickWinCount > 0 || gscQueryOpportunityCount > 0 || (gscPosition !== null && gscPosition >= 4 && gscPosition <= 15 && gscImpressions >= 50)) {
    return { code: "optimize", label: "Optimize", reason: quickWinCount > 0 ? "The page has cached keywords already ranking in positions 4–20." : "Real GSC impressions show the page is already within striking distance at positions 4–15." };
  }
  if (up >= Math.max(3, down + 2) || (gscClicksChange !== null && gscClicksChange >= 20 && gscImpressions >= 50)) {
    return { code: "scale", label: "Scale", reason: "The page is gaining provider rankings or real GSC clicks and can be reviewed for adjacent expansion." };
  }
  if ((keywords > 0 && top10 / keywords >= 0.5 && traffic > 0) || (gscPosition !== null && gscPosition <= 3 && gscClicks > 0)) {
    return { code: "protect", label: "Protect", reason: "The page already has strong first-page evidence and real organic value." };
  }
  return { code: "monitor", label: "Monitor", reason: "No strong cached risk or upside signal is present." };
}

function nextBestActionFor({ url, action, gscQueries = [], quickWinKeywords = [], score }) {
  const recoveryQuery = gscQueries.find((row) =>
    (finite(row?.clicks_change_percent) ?? 0) <= -20 &&
    (finite(row?.impressions) ?? 0) >= 50
  );
  const gscQuery = recoveryQuery ?? gscQueries[0] ?? null;
  const providerQuery = quickWinKeywords[0] ?? null;
  const selected = gscQuery ?? providerQuery ?? null;
  const source = gscQuery ? "gsc_query_page" : providerQuery ? "dataforseo_cache" : null;

  const evidence = selected ? {
    position: finite(selected.position),
    impressions: finite(selected.impressions),
    clicks: finite(selected.clicks),
    clicks_change_percent: finite(selected.clicks_change_percent),
    search_volume: finite(selected.search_volume),
    keyword_difficulty: finite(selected.keyword_difficulty),
    intent: selected.intent ?? null,
    provider_match: selected.provider_match ?? null,
  } : null;

  const evidenceParts = [];
  if (evidence?.impressions !== null && evidence?.impressions !== undefined) evidenceParts.push("GSC impressions " + evidence.impressions);
  if (evidence?.position !== null && evidence?.position !== undefined) evidenceParts.push("position " + evidence.position);
  if (evidence?.clicks_change_percent !== null && evidence?.clicks_change_percent !== undefined) evidenceParts.push("clicks change " + evidence.clicks_change_percent + "%");
  if (evidence?.search_volume !== null && evidence?.search_volume !== undefined) evidenceParts.push("volume " + evidence.search_volume);
  if (evidence?.keyword_difficulty !== null && evidence?.keyword_difficulty !== undefined) evidenceParts.push("KD " + evidence.keyword_difficulty);

  return {
    page: url,
    action: action?.code ?? "monitor",
    action_label: action?.label ?? "Monitor",
    priority_score: finite(score),
    query: selected?.keyword ?? null,
    query_source: source,
    why_now: [action?.reason, evidenceParts.length ? evidenceParts.join(" · ") : null].filter(Boolean).join(" · "),
    evidence,
  };
}

function workstreamFor(actionCode) {
  if (["reclaim", "recover"].includes(actionCode)) return "recovery";
  if (actionCode === "ctr_opportunity") return "ctr";
  if (actionCode === "optimize") return "growth";
  if (actionCode === "scale") return "expansion";
  if (actionCode === "protect") return "defense";
  return "monitor";
}

function buildActionQueue(opportunities = [], limit = 5) {
  return opportunities
    .filter((item) => item?.action?.code && item.action.code !== "monitor")
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((item, index) => ({
      rank: index + 1,
      workstream: workstreamFor(item.action.code),
      page: item.url,
      action: item.action.code,
      action_label: item.action.label,
      priority_score: item.priority_score,
      confidence: item.confidence,
      query: item.next_best_action?.query ?? null,
      query_source: item.next_best_action?.query_source ?? null,
      why_now: item.next_best_action?.why_now ?? item.action.reason ?? "",
      evidence: item.next_best_action?.evidence ?? null,
    }));
}

export function buildOrganicOpportunities({
  keywordRows = [],
  pageRows = [],
  gscPageRows = [],
  gscQueryPageRows = [],
  target,
  sources = {},
} = {}) {
  const keywordEvidence = buildKeywordEvidence(keywordRows);
  const gscPageEvidence = buildGscPageEvidence(gscPageRows);
  const gscQueryPageEvidence = buildGscQueryPageEvidence(gscQueryPageRows, keywordEvidence);
  const pageMap = new Map();

  for (const page of Array.isArray(pageRows) ? pageRows : []) {
    const url = canonicalUrl(page?.url);
    if (!url) continue;
    pageMap.set(url, { ...page, url });
  }
  for (const [url] of keywordEvidence) {
    if (!pageMap.has(url)) pageMap.set(url, { url, relative_url: null });
  }
  for (const [url] of gscPageEvidence) {
    if (!pageMap.has(url)) pageMap.set(url, { url, relative_url: null });
  }
  for (const [url] of gscQueryPageEvidence) {
    if (!pageMap.has(url)) pageMap.set(url, { url, relative_url: null });
  }

  const opportunities = [];
  for (const [url, page] of pageMap) {
    const keyword = keywordEvidence.get(url) ?? {
      sampled_keywords: 0,
      sampled_traffic: 0,
      quick_win_points_raw: 0,
      quick_win_keywords: [],
      commercial_quick_wins: 0,
      keyword_lookup: new Map(),
    };
    const changes = page.changes ?? {};
    const positions = page.positions ?? {};
    const lost = finite(changes.lost) ?? 0;
    const down = finite(changes.down) ?? 0;
    const up = finite(changes.up) ?? 0;
    const pageKeywords = finite(page.organic_keywords);
    const keywords = pageKeywords ?? keyword.sampled_keywords;
    const traffic = finite(page.organic_traffic) ?? keyword.sampled_traffic;
    const gsc = gscPageEvidence.get(url) ?? null;
    const gscQueries = gscQueryPageEvidence.get(url) ?? [];
    const risk = Math.min(35, Math.round((lost * 10 + down * 2) * 100) / 100);
    const quickWin = Math.min(35, Math.round(keyword.quick_win_points_raw * 100) / 100);
    const trafficScore = trafficPoints(traffic);
    const business = Math.min(10, keyword.commercial_quick_wins * 2.5);
    const baseScore = Math.min(100, Math.round((risk + quickWin + trafficScore + business) * 100) / 100);
    const gscPageReality = gscRealityPoints(gsc);
    const gscQueryReality = gscQueries.reduce((max, row) => Math.max(max, finite(row.gsc_points) ?? 0), 0);
    const gscReality = Math.max(gscPageReality, gscQueryReality);
    const score = Math.min(100, Math.round((baseScore + gscReality) * 100) / 100);
    const gscQueryRecoveryCount = gscQueries.filter((row) => (finite(row.clicks_change_percent) ?? 0) <= -20 && (finite(row.impressions) ?? 0) >= 50).length;
    const gscQueryCtrOpportunityCount = gscQueries.filter((row) => {
      const impressions = finite(row.impressions) ?? 0;
      const position = finite(row.position);
      const ctr = finite(row.ctr);
      return position !== null && position <= 10 && impressions >= 100 && ctr !== null && ctr < 0.03;
    }).length;
    const action = actionFor({
      lost,
      down,
      up,
      quickWinCount: keyword.quick_win_keywords.length,
      top10: finite(positions.top_10) ?? 0,
      keywords,
      traffic,
      gsc,
      gscQueryOpportunityCount: gscQueries.length,
      gscQueryRecoveryCount,
      gscQueryCtrOpportunityCount,
    });
    const evidenceCount =
      Number(Boolean(sources.organic_keywords)) +
      Number(Boolean(sources.top_pages)) +
      Number(Boolean(sources.gsc_pages && (gsc || gscQueries.length)));
    const confidence = evidenceCount >= 2
      ? "high"
      : evidenceCount === 1 && (gsc || keyword.sampled_keywords >= 3 || pageKeywords !== null)
        ? "medium"
        : "low";

    const nextBestAction = nextBestActionFor({
      url,
      action,
      gscQueries,
      quickWinKeywords: keyword.quick_win_keywords,
      score,
    });

    opportunities.push({
      url,
      relative_url: page.relative_url ?? null,
      action,
      priority_score: score,
      confidence,
      next_best_action: nextBestAction,
      components: {
        risk_points: risk,
        quick_win_points: quickWin,
        traffic_points: trafficScore,
        business_intent_points: business,
        gsc_reality_points: gscReality,
        base_score: baseScore,
      },
      metrics: {
        organic_traffic: finite(page.organic_traffic) ?? Math.round(keyword.sampled_traffic * 100) / 100,
        organic_keywords: pageKeywords,
        sampled_keywords: keyword.sampled_keywords,
        top_10: finite(positions.top_10),
        declining_keywords: down,
        lost_keywords: lost,
        gaining_keywords: up,
        quick_win_keywords: keyword.quick_win_keywords.length,
        commercial_quick_wins: keyword.commercial_quick_wins,
        gsc_clicks: finite(gsc?.clicks),
        gsc_impressions: finite(gsc?.impressions),
        gsc_ctr: gsc ? ((finite(gsc.impressions) ?? 0) > 0 ? (finite(gsc.clicks) ?? 0) / finite(gsc.impressions) : finite(gsc.ctr)) : null,
        gsc_position: finite(gsc?.position),
        gsc_clicks_change_percent: gsc?.change?.clicks_percent ?? (gsc ? percentChange(gsc.clicks, gsc.previous_clicks) : null),
        gsc_query_opportunities: gscQueries.length,
        gsc_query_recoveries: gscQueryRecoveryCount,
        gsc_query_ctr_opportunities: gscQueryCtrOpportunityCount,
      },
      quick_win_keywords: keyword.quick_win_keywords,
      gsc_query_opportunities: gscQueries,
      evidence: {
        top_pages: Boolean(sources.top_pages && page.url),
        organic_keywords: Boolean(sources.organic_keywords && keyword.sampled_keywords),
        gsc_pages: Boolean(sources.gsc_pages && (gsc || gscQueries.length)),
      },
    });
  }

  opportunities.sort((a, b) =>
    (b.priority_score ?? 0) - (a.priority_score ?? 0) ||
    (b.metrics.organic_traffic ?? 0) - (a.metrics.organic_traffic ?? 0) ||
    a.url.localeCompare(b.url)
  );

  const counts = {};
  for (const item of opportunities) counts[item.action.code] = (counts[item.action.code] ?? 0) + 1;
  const actionQueue = buildActionQueue(opportunities, 5);
  const fallbackNextBestAction = opportunities[0]?.next_best_action ?? null;

  return {
    target,
    ready: Boolean(sources.organic_keywords || sources.top_pages || sources.gsc_pages),
    sources,
    formula: {
      version: ORGANIC_OPPORTUNITY_VERSION,
      priority_score: "base_score + gsc_reality_points, capped at 100; without GSC, score remains the v0.1 base score",
      risk_points: "min(35, lost_keywords*10 + declining_keywords*2)",
      quick_win_points: "sum(position 4-20 keyword demand points × rank weight × KD modifier), capped at 35",
      traffic_points: "0-20 from current estimated page traffic bands",
      business_intent_points: "2.5 per commercial/transactional quick win, capped at 10",
      gsc_reality_points: "0-20 from the strongest stored page or Query+Page GSC signal: impressions, striking-distance position, low CTR, and click change",
    },
    summary: {
      total_pages: opportunities.length,
      action_counts: counts,
      top_priority_score: opportunities[0]?.priority_score ?? null,
    },
    next_best_action: actionQueue[0] ?? fallbackNextBestAction,
    action_queue: actionQueue,
    opportunities,
    generated_at: new Date().toISOString(),
    disclaimer: "Opportunity priority is a transparent rule-based workflow score from cached DataForSEO evidence plus stored GSC evidence when available. It is not a ranking probability or revenue forecast.",
  };
}
