export const KEYWORD_RELEVANCE_VERSION = "keyword-relevance-v0.1";

const STOP_WORDS = new Set([
  "a", "an", "and", "for", "in", "of", "on", "the", "to", "with",
]);

function tokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreKeywordRelevance(keyword, seedKeyword, coreKeyword = null) {
  const keywordText = String(keyword ?? "").toLowerCase().trim();
  const seedText = String(seedKeyword ?? "").toLowerCase().trim();
  const seedTokens = [...new Set(tokens(seedText))];
  const keywordTokens = [...new Set(tokens(keywordText))];

  if (!seedTokens.length || !keywordTokens.length) {
    return { version: KEYWORD_RELEVANCE_VERSION, score: 0, label: "Low relevance" };
  }

  if (keywordText === seedText) {
    return { version: KEYWORD_RELEVANCE_VERSION, score: 100, label: "Exact seed" };
  }

  const shared = seedTokens.filter((token) => keywordTokens.includes(token)).length;
  const seedCoverage = shared / seedTokens.length;
  const keywordPrecision = shared / keywordTokens.length;
  const phraseBonus = keywordText.includes(seedText) ? 20 : 0;
  const coreTokens = tokens(coreKeyword);
  const coreBonus = coreTokens.some((token) => seedTokens.includes(token)) ? 10 : 0;
  const score = clampScore(seedCoverage * 50 + keywordPrecision * 20 + phraseBonus + coreBonus);
  const label = score >= 75 ? "High relevance" : score >= 45 ? "Medium relevance" : "Low relevance";

  return { version: KEYWORD_RELEVANCE_VERSION, score, label };
}

export function enrichKeywordIdeas(ideas, seedKeyword) {
  return (ideas ?? [])
    .map((idea) => {
      const relevance = scoreKeywordRelevance(
        idea.keyword,
        seedKeyword,
        idea.keyword_properties?.core_keyword,
      );
      const potential = idea.intelligence?.keyword_potential?.score;
      const priorityScore = clampScore(
        (typeof potential === "number" ? potential : 0) * 0.65 +
        relevance.score * 0.35,
      );

      return {
        ...idea,
        intelligence: {
          ...(idea.intelligence ?? {}),
          keyword_relevance: relevance,
          priority_score: {
            version: "keyword-priority-v0.1",
            score: priorityScore,
            weights: { keyword_potential: 65, relevance: 35 },
          },
        },
      };
    })
    .sort((a, b) =>
      (b.intelligence.priority_score.score - a.intelligence.priority_score.score) ||
      ((b.metrics?.search_volume ?? -1) - (a.metrics?.search_volume ?? -1)),
    )
    .map((idea, index) => ({ ...idea, rank: index + 1 }));
}
