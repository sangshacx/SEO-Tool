export const CONTENT_CLUSTER_VERSION = "content-clusters-v0.1";

const GENERIC_WORDS = new Set([
  "a", "an", "and", "are", "best", "buy", "cost", "for", "from", "guide", "how", "in", "is", "material", "materials", "of", "on", "or", "price", "product", "products", "supplier", "suppliers", "system", "systems", "the", "to", "vs", "what", "with", "waterproof", "waterproofing",
]);

const TOKEN_ALIASES = new Map([
  ["coatings", "coating"], ["floors", "floor"], ["flooring", "floor"],
  ["membranes", "membrane"], ["paints", "paint"], ["roofs", "roof"],
  ["roofing", "roof"], ["solutions", "solution"], ["grouts", "grout"],
]);

function titleCase(value) {
  return value.split(/\s+/).map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : "").join(" ");
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
}

function tokens(keyword) {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => TOKEN_ALIASES.get(token) ?? (token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token))
    .filter((token) => token.length > 2 && !GENERIC_WORDS.has(token));
}

function similarity(first, second) {
  if (!first.length || !second.length) return 0;
  const a = new Set(first), b = new Set(second);
  let shared = 0;
  a.forEach((token) => { if (b.has(token)) shared += 1; });
  const overlap = shared / Math.min(a.size, b.size);
  const leading = first[0] === second[0] ? 0.25 : 0;
  return Math.min(1, overlap + leading);
}

function finitePriority(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

function averagePriority(rows) {
  const values = rows.map((row) => finitePriority(row.priority)).filter((value) => value !== null);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function choosePillar(rows) {
  return rows.slice().sort((a, b) => {
    const priority = (finitePriority(b.priority) ?? -1) - (finitePriority(a.priority) ?? -1);
    if (priority) return priority;
    return a.keyword.split(/\s+/).length - b.keyword.split(/\s+/).length;
  })[0];
}

function clusterName(rows, pillar) {
  const frequency = new Map();
  rows.forEach((row) => [...new Set(row.tokens)].forEach((token) => frequency.set(token, (frequency.get(token) ?? 0) + 1)));
  const pillarOrder = new Map(pillar.tokens.map((token, index) => [token, index]));
  const label = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || (pillarOrder.get(a[0]) ?? 999) - (pillarOrder.get(b[0]) ?? 999) || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([token]) => token)
    .join(" ");
  return `${titleCase(label || rows[0].keyword)} Cluster`;
}

function buildCluster(rows, index) {
  const pillar = choosePillar(rows);
  const name = clusterName(rows, pillar);
  const id = `${slugify(name.replace(/\s+cluster$/i, "")) || "topic"}-${index + 1}`;
  const pages = rows
    .slice()
    .sort((a, b) => a.keyword === pillar.keyword ? -1 : b.keyword === pillar.keyword ? 1 : (finitePriority(b.priority) ?? -1) - (finitePriority(a.priority) ?? -1))
    .map((row) => ({
      keyword: row.keyword,
      role: row.keyword === pillar.keyword ? "pillar" : "supporting",
      page_type: row.page_type || (row.keyword === pillar.keyword ? "Pillar Guide" : "Supporting Page"),
      search_intent: row.intent || "informational",
      priority_score: finitePriority(row.priority),
      suggested_slug: row.brief?.slug || slugify(row.keyword),
      brief_ready: Boolean(row.brief),
    }));
  const intentCounts = {};
  pages.forEach((page) => { intentCounts[page.search_intent] = (intentCounts[page.search_intent] ?? 0) + 1; });

  return {
    id,
    name,
    pillar_keyword: pillar.keyword,
    average_priority: averagePriority(rows),
    page_count: pages.length,
    supporting_page_count: Math.max(0, pages.length - 1),
    intent_mix: intentCounts,
    pages,
    internal_links: pages
      .filter((page) => page.role === "supporting")
      .map((page) => ({ from_keyword: page.keyword, to_keyword: pillar.keyword, suggested_anchor: pillar.keyword })),
  };
}

export function generateContentClusters(inputRows) {
  const rows = inputRows.map((row) => ({ ...row, tokens: tokens(row.keyword) }));
  const groups = [];

  rows
    .slice()
    .sort((a, b) => (finitePriority(b.priority) ?? -1) - (finitePriority(a.priority) ?? -1))
    .forEach((row) => {
      let best = null;
      groups.forEach((group) => {
        const score = Math.max(...group.map((member) => similarity(row.tokens, member.tokens)));
        if (!best || score > best.score) best = { group, score };
      });
      if (best && best.score >= 0.5) best.group.push(row);
      else groups.push([row]);
    });

  const clusters = groups
    .map(buildCluster)
    .sort((a, b) => (b.average_priority ?? -1) - (a.average_priority ?? -1) || b.page_count - a.page_count);
  const priorities = rows.map((row) => finitePriority(row.priority)).filter((value) => value !== null);

  return {
    version: CONTENT_CLUSTER_VERSION,
    cluster_count: clusters.length,
    pillar_page_count: clusters.length,
    supporting_page_count: Math.max(0, rows.length - clusters.length),
    total_page_count: rows.length,
    average_priority: priorities.length ? Math.round(priorities.reduce((sum, value) => sum + value, 0) / priorities.length) : null,
    clusters,
    generated_at: new Date().toISOString(),
  };
}
