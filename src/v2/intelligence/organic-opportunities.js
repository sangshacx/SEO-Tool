export const ORGANIC_OPPORTUNITY_VERSION = "organic-opportunity-v0.1";

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
    };
    current.sampled_keywords += 1;
    current.sampled_traffic += finite(row.estimated_traffic) ?? 0;
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

function actionFor({ lost, down, up, quickWinCount, top10, keywords, traffic }) {
  if (lost > 0) return { code: "reclaim", label: "Reclaim", reason: "The page lost ranked keywords in the latest provider comparison." };
  if (down >= Math.max(3, Math.ceil(keywords * 0.2))) return { code: "recover", label: "Recover", reason: "Declining rankings are material relative to the page's keyword footprint." };
  if (quickWinCount > 0) return { code: "optimize", label: "Optimize", reason: "The page has cached keywords already ranking in positions 4–20." };
  if (up >= Math.max(3, down + 2)) return { code: "scale", label: "Scale", reason: "The page is gaining rankings and can be reviewed for adjacent expansion." };
  if (keywords > 0 && top10 / keywords >= 0.5 && traffic > 0) return { code: "protect", label: "Protect", reason: "The page already has strong Top 10 coverage and existing organic traffic." };
  return { code: "monitor", label: "Monitor", reason: "No strong cached risk or upside signal is present." };
}

export function buildOrganicOpportunities({
  keywordRows = [],
  pageRows = [],
  target,
  sources = {},
} = {}) {
  const keywordEvidence = buildKeywordEvidence(keywordRows);
  const pageMap = new Map();

  for (const page of Array.isArray(pageRows) ? pageRows : []) {
    const url = canonicalUrl(page?.url);
    if (!url) continue;
    pageMap.set(url, { ...page, url });
  }
  for (const [url] of keywordEvidence) {
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
    };
    const changes = page.changes ?? {};
    const positions = page.positions ?? {};
    const lost = finite(changes.lost) ?? 0;
    const down = finite(changes.down) ?? 0;
    const up = finite(changes.up) ?? 0;
    const pageKeywords = finite(page.organic_keywords);
    const keywords = pageKeywords ?? keyword.sampled_keywords;
    const traffic = finite(page.organic_traffic) ?? keyword.sampled_traffic;
    const risk = Math.min(35, Math.round((lost * 10 + down * 2) * 100) / 100);
    const quickWin = Math.min(35, Math.round(keyword.quick_win_points_raw * 100) / 100);
    const trafficScore = trafficPoints(traffic);
    const business = Math.min(10, keyword.commercial_quick_wins * 2.5);
    const score = Math.min(100, Math.round((risk + quickWin + trafficScore + business) * 100) / 100);
    const action = actionFor({
      lost,
      down,
      up,
      quickWinCount: keyword.quick_win_keywords.length,
      top10: finite(positions.top_10) ?? 0,
      keywords,
      traffic,
    });
    const evidenceCount = Number(Boolean(sources.organic_keywords)) + Number(Boolean(sources.top_pages));
    const confidence = evidenceCount === 2 ? "high" : keyword.sampled_keywords >= 3 || pageKeywords !== null ? "medium" : "low";

    opportunities.push({
      url,
      relative_url: page.relative_url ?? null,
      action,
      priority_score: score,
      confidence,
      components: {
        risk_points: risk,
        quick_win_points: quickWin,
        traffic_points: trafficScore,
        business_intent_points: business,
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
      },
      quick_win_keywords: keyword.quick_win_keywords,
      evidence: {
        top_pages: Boolean(sources.top_pages && page.url),
        organic_keywords: Boolean(sources.organic_keywords && keyword.sampled_keywords),
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

  return {
    target,
    ready: Boolean(sources.organic_keywords || sources.top_pages),
    sources,
    formula: {
      version: ORGANIC_OPPORTUNITY_VERSION,
      priority_score: "risk_points + quick_win_points + traffic_points + business_intent_points, capped at 100",
      risk_points: "min(35, lost_keywords*10 + declining_keywords*2)",
      quick_win_points: "sum(position 4-20 keyword demand points × rank weight × KD modifier), capped at 35",
      traffic_points: "0-20 from current estimated page traffic bands",
      business_intent_points: "2.5 per commercial/transactional quick win, capped at 10",
    },
    summary: {
      total_pages: opportunities.length,
      action_counts: counts,
      top_priority_score: opportunities[0]?.priority_score ?? null,
    },
    opportunities,
    generated_at: new Date().toISOString(),
    disclaimer: "Opportunity priority is a transparent rule-based workflow score from cached SEO evidence. It is not a ranking probability or revenue forecast.",
  };
}
