function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentChange(current, previous) {
  const a = finite(current);
  const b = finite(previous);
  if (a === null || b === null || b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 10000) / 100;
}

export function summarizeOrganicHistory(points = []) {
  const rows = (Array.isArray(points) ? points : []).filter(Boolean);
  const first = rows[0] ?? null;
  const last = rows.at(-1) ?? null;
  return {
    points: rows.length,
    first_at: first?.captured_at ?? first?.period ?? null,
    last_at: last?.captured_at ?? last?.period ?? null,
    latest: last ? {
      organic_keywords: finite(last.organic_keywords),
      organic_traffic: finite(last.organic_traffic),
      traffic_value: finite(last.traffic_value ?? last.traffic_value_usd),
      top_10: finite(last.positions?.top_10),
    } : null,
    change: first && last ? {
      organic_keywords_percent: percentChange(last.organic_keywords, first.organic_keywords),
      organic_traffic_percent: percentChange(last.organic_traffic, first.organic_traffic),
      traffic_value_percent: percentChange(last.traffic_value ?? last.traffic_value_usd, first.traffic_value ?? first.traffic_value_usd),
      top_10_percent: percentChange(last.positions?.top_10, first.positions?.top_10),
    } : null,
  };
}
