function normalizeText(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}

const GENERIC_ANCHORS = new Set([
  "click here",
  "here",
  "learn more",
  "more info",
  "more information",
  "read more",
  "this website",
  "visit site",
  "visit website",
  "website",
]);
const COMMON_SECOND_LEVEL_SUFFIXES = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);

function brandPhrase(domain) {
  if (typeof domain !== "string") return "";
  const labels = domain.trim().toLowerCase().replace(/^www\./, "").split(".");
  labels.pop();
  if (labels.length > 1 && COMMON_SECOND_LEVEL_SUFFIXES.has(labels.at(-1))) labels.pop();
  return normalizeText(labels.join(" ").replace(/[-_]+/g, " "));
}

function isNakedUrl(value) {
  return /^(?:https?:\/\/|www\.)\S+$/i.test(value)
    || /^(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:[/?#]\S*)?$/i.test(value);
}

function isPartialKeywordMatch(anchor, keyword) {
  const keywordTokens = [...new Set(keyword.split(" ").filter((token) => token.length > 1))];
  if (keywordTokens.length < 2) return false;
  const anchorTokens = new Set(anchor.split(" ").filter(Boolean));
  const overlap = keywordTokens.filter((token) => anchorTokens.has(token)).length;
  return overlap >= Math.max(2, Math.ceil(keywordTokens.length / 2));
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function percent(value, total) {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

export function classifyAnchorText(anchor, { keyword = "", domain = "" } = {}) {
  const normalizedAnchor = normalizeText(anchor);
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedAnchor) {
    return { code: "empty", label: "Empty / Image" };
  }
  if (normalizedKeyword && normalizedAnchor === normalizedKeyword) {
    return { code: "exact", label: "Exact Match" };
  }
  const brand = brandPhrase(domain);
  if (brand && (normalizedAnchor === brand || normalizedAnchor.includes(brand))) {
    return { code: "branded", label: "Branded" };
  }
  if (isNakedUrl(normalizedAnchor)) {
    return { code: "naked", label: "Naked URL" };
  }
  if (GENERIC_ANCHORS.has(normalizedAnchor)) {
    return { code: "generic", label: "Generic" };
  }
  if (normalizedKeyword && isPartialKeywordMatch(normalizedAnchor, normalizedKeyword)) {
    return { code: "partial", label: "Partial Match" };
  }
  return { code: "other", label: "Other" };
}

export function enrichAnchorPage(page, { keyword = "" } = {}) {
  const items = Array.isArray(page?.items)
    ? page.items.map((item) => {
      const referringPages = finite(item?.referring_pages);
      const nofollowPages = finite(item?.referring_pages_nofollow);
      return {
        ...item,
        classification: classifyAnchorText(item?.anchor, { keyword, domain: page?.target }),
        nofollow_share_percent: percent(nofollowPages, referringPages),
      };
    })
    : [];
  const representedBacklinks = items.reduce((sum, item) => sum + finite(item.backlinks), 0);
  const backlinksFor = (codes) => items.reduce(
    (sum, item) => sum + (codes.has(item.classification.code) ? finite(item.backlinks) : 0),
    0,
  );
  const exactPartialBacklinks = backlinksFor(new Set(["exact", "partial"]));
  const brandedBacklinks = backlinksFor(new Set(["branded"]));
  const genericNakedBacklinks = backlinksFor(new Set(["generic", "naked"]));
  const riskyAnchors = items.filter((item) => {
    const backlinks = finite(item.backlinks);
    return finite(item.spam_score) >= 50
      || (backlinks > 0 && finite(item.broken_backlinks) / backlinks >= 0.25);
  }).length;
  return {
    ...page,
    classification_keyword: normalizeText(keyword) || null,
    items,
    summary: {
      returned_anchors: items.length,
      represented_backlinks: representedBacklinks,
      exact_partial_backlinks: exactPartialBacklinks,
      exact_partial_share_percent: percent(exactPartialBacklinks, representedBacklinks),
      branded_backlinks: brandedBacklinks,
      branded_share_percent: percent(brandedBacklinks, representedBacklinks),
      generic_naked_backlinks: genericNakedBacklinks,
      generic_naked_share_percent: percent(genericNakedBacklinks, representedBacklinks),
      risky_anchors: riskyAnchors,
    },
  };
}
