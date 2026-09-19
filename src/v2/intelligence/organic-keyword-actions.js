export const ORGANIC_KEYWORD_ACTION_VERSION = "organic-keyword-action-v0.1";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function result(code, label, priority, reason) {
  return { version: ORGANIC_KEYWORD_ACTION_VERSION, code, label, priority, reason };
}

export function classifyOrganicKeywordAction(row = {}, { mode = "own" } = {}) {
  const movement = row.movement ?? {};
  const position = finite(row.position);

  if (mode === "competitor") {
    if (movement.is_lost) return result("gap_opportunity", "Gap Opportunity", "growth", "Competitor lost visibility for this keyword.");
    if (movement.is_down) return result("competitor_weakness", "Competitor Weakness", "high", "Competitor ranking declined since the previous provider update.");
    if (movement.is_new || movement.is_up) return result("study_gain", "Study Gain", "research", "Competitor gained visibility; inspect the ranking page and SERP.");
    if (position !== null && position <= 10) return result("study_winner", "Study Winner", "research", "Competitor already ranks in the organic Top 10.");
    return result("study", "Study", "research", "Use this keyword as competitor research evidence.");
  }

  if (movement.is_lost) return result("reclaim", "Reclaim", "critical", "The site lost its previously observed ranking.");
  if (movement.is_down) return result("recover", "Recover", "high", "The ranking declined since the previous provider update.");
  if (position !== null && position <= 3) return result("protect", "Protect", "maintain", "The keyword is already a Top 3 winner.");
  if (position !== null && position <= 20) return result("quick_win", "Quick Win", "high", "The keyword already ranks in positions 4–20.");
  if (position !== null && position <= 50) return result("improve", "Improve", "growth", "The keyword has meaningful visibility but is outside the Top 20.");
  return result("monitor", "Monitor", "monitor", "Visibility is currently too weak for a default high-priority action.");
}
