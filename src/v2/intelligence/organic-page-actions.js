export const ORGANIC_PAGE_ACTION_VERSION = "organic-page-action-v0.1";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function result(code, label, priority, reason) {
  return { version: ORGANIC_PAGE_ACTION_VERSION, code, label, priority, reason };
}

function threshold(count, ratio, minimum = 3) {
  const total = finite(count) ?? 0;
  return Math.max(minimum, Math.ceil(total * ratio));
}

export function classifyOrganicPageAction(row = {}, { mode = "own" } = {}) {
  const keywords = finite(row.organic_keywords) ?? 0;
  const positions = row.positions ?? {};
  const changes = row.changes ?? {};
  const top10 = finite(positions.top_10) ?? 0;
  const top20 = finite(positions.top_20) ?? top10;
  const up = finite(changes.up) ?? 0;
  const down = finite(changes.down) ?? 0;
  const lost = finite(changes.lost) ?? 0;

  if (mode === "competitor") {
    if (lost >= threshold(keywords, 0.15)) return result("competitor_weakness", "Competitor Weakness", "growth", "The competitor page lost a meaningful share of ranked keywords.");
    if (down > up && down >= threshold(keywords, 0.20)) return result("competitor_weakness", "Competitor Weakness", "growth", "Declining keywords materially exceed gains.");
    if (up > down && up >= threshold(keywords, 0.15)) return result("study_gain", "Study Gain", "research", "This competitor page is gaining rankings.");
    if (keywords > 0 && top10 / keywords >= 0.4) return result("study_winner", "Study Winner", "research", "A large share of this page's keywords rank in the Top 10.");
    return result("study", "Study", "research", "Use this page as competitor content evidence.");
  }

  if (lost >= threshold(keywords, 0.15)) return result("reclaim", "Reclaim", "critical", "The page lost a meaningful share of ranked keywords.");
  if (down > up && down >= threshold(keywords, 0.20)) return result("at_risk", "At Risk", "high", "Declining keywords materially exceed gains.");
  if (up > down && up >= threshold(keywords, 0.15)) return result("growing", "Growing", "growth", "The page is gaining a meaningful number of rankings.");
  if (keywords > 0 && top10 / keywords >= 0.5) return result("protect", "Protect", "maintain", "At least half of the page's ranked keywords are already in the Top 10.");
  if (keywords > 0 && (top20 - top10) >= threshold(keywords, 0.20)) return result("improve", "Improve", "high", "A meaningful share of keywords sit in positions 11–20.");
  return result("monitor", "Monitor", "monitor", "No strong page-level risk or opportunity signal is present.");
}
