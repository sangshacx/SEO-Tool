export const SERP_OVERLAP_EVIDENCE_VERSION = "serp-overlap-evidence-v0.1";
export const SERP_OVERLAP_MAX_AGE_DAYS = 30;
export const SERP_OVERLAP_MIN_RESULTS = 5;

function roundScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function validTimestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

function ageDays(fetchedAt, analysisTime) {
  const fetched = validTimestamp(fetchedAt);
  const now = validTimestamp(analysisTime);
  if (fetched == null || now == null) return null;
  return Math.max(0, (now - fetched) / 86400000);
}

export function normalizeSerpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let path = url.pathname.replace(/\/+$/, "") || "/";
    return host + path.toLowerCase();
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[?#]/)[0]
      .replace(/\/+$/, "");
  }
}

function normalizedUrls(entity) {
  const values = Array.isArray(entity?.serp?.urls) ? entity.serp.urls : [];
  return [...new Set(values.map(normalizeSerpUrl).filter(Boolean))];
}

function sameMarket(candidate, member) {
  return Number(candidate?.location_code) === Number(member?.location_code)
    && String(candidate?.language_code || "") === String(member?.language_code || "");
}

export function compareSerpOverlap(candidate, member, {
  analysisTime = new Date().toISOString(),
  maxAgeDays = SERP_OVERLAP_MAX_AGE_DAYS,
  minResults = SERP_OVERLAP_MIN_RESULTS,
} = {}) {
  const candidateUrls = normalizedUrls(candidate);
  const memberUrls = normalizedUrls(member);
  const base = {
    version: SERP_OVERLAP_EVIDENCE_VERSION,
    status: "unavailable",
    score: 0,
    strength: "none",
    shared_url_count: 0,
    shared_urls: [],
    candidate_result_count: candidateUrls.length,
    member_result_count: memberUrls.length,
    candidate_fetched_at: candidate?.serp?.fetched_at ?? null,
    member_fetched_at: member?.serp?.fetched_at ?? null,
    same_market: sameMarket(candidate, member),
    reason: "",
  };

  if (!base.same_market) {
    return { ...base, status: "market_mismatch", reason: "SERP 市场或语言不同，不能直接比较 URL 重叠。" };
  }
  if (!candidateUrls.length || !memberUrls.length) {
    return { ...base, reason: "至少一个关键词没有已缓存的 Top 10 SERP 页面数据。" };
  }

  const candidateAge = ageDays(base.candidate_fetched_at, analysisTime);
  const memberAge = ageDays(base.member_fetched_at, analysisTime);
  if (
    candidateAge == null
    || memberAge == null
    || candidateAge > maxAgeDays
    || memberAge > maxAgeDays
  ) {
    return { ...base, status: "stale", reason: "已缓存 SERP 数据超过可用时效，未参与最终评分。" };
  }
  if (candidateUrls.length < minResults || memberUrls.length < minResults) {
    return { ...base, status: "insufficient", reason: "可比较的 organic SERP 页面少于最低要求，证据不足。" };
  }

  const memberSet = new Set(memberUrls);
  const shared = candidateUrls.filter((url) => memberSet.has(url));
  const denominator = Math.min(candidateUrls.length, memberUrls.length);
  const score = denominator ? roundScore((shared.length / denominator) * 100) : 0;
  const strength = shared.length >= 3 && score >= 30
    ? "strong"
    : shared.length >= 2 && score >= 20
      ? "moderate"
      : "weak";

  return {
    ...base,
    status: "available",
    score,
    strength,
    shared_url_count: shared.length,
    shared_urls: shared.slice(0, 5),
    reason: strength === "strong"
      ? "两个关键词的 Top 10 organic SERP 有显著 URL 重叠，搜索意图很可能接近。"
      : strength === "moderate"
        ? "两个关键词存在中等 SERP URL 重叠，建议结合页面目标复核。"
        : "Top 10 organic SERP URL 重叠较低，当前证据更支持分开处理。",
  };
}
