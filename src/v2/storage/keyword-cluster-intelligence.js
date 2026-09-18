async function resolveSiteProfile(db, domain) {
  const row = await db.prepare(
    "SELECT id, domain FROM site_profiles WHERE domain = ? LIMIT 1",
  ).bind(domain).first();
  if (!row?.id) {
    const error = new Error("SITE_PROFILE_NOT_FOUND");
    error.code = "SITE_PROFILE_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }
  return row;
}

function memberFromRow(row) {
  return {
    saved_keyword_id: Number(row.saved_keyword_id),
    keyword: row.keyword,
    role: row.role,
    intent_primary: row.intent_primary ?? null,
  };
}

function groupClusters(rows) {
  const clusters = new Map();
  for (const row of rows) {
    const clusterId = Number(row.cluster_id);
    if (!clusters.has(clusterId)) {
      clusters.set(clusterId, {
        id: clusterId,
        name: row.cluster_name,
        primary: null,
        supporting: [],
      });
    }
    if (row.saved_keyword_id == null) continue;
    const cluster = clusters.get(clusterId);
    const member = memberFromRow(row);
    if (member.role === "primary") cluster.primary = member;
    else cluster.supporting.push(member);
  }
  return [...clusters.values()];
}

export async function loadClusterIntelligenceInput(db, input) {
  const site = await resolveSiteProfile(db, input.site_domain);

  const totalRow = await db.prepare(
    "SELECT COUNT(*) AS total FROM saved_keywords WHERE site_profile_id = ?",
  ).bind(site.id).first();
  const total = Number(totalRow?.total ?? 0);

  const keywordRows = await db.prepare(`
    SELECT
      sk.id AS saved_keyword_id,
      k.keyword,
      km.intent_primary
    FROM saved_keywords sk
    JOIN keywords k ON k.id = sk.keyword_id
    LEFT JOIN keyword_metrics km ON km.id = (
      SELECT latest.id
      FROM keyword_metrics latest
      WHERE latest.keyword_id = k.id
      ORDER BY latest.fetched_at DESC, latest.id DESC
      LIMIT 1
    )
    WHERE sk.site_profile_id = ?
    ORDER BY sk.updated_at DESC, sk.id DESC
    LIMIT ?
  `).bind(site.id, input.limit).all();

  const clusterRows = await db.prepare(`
    SELECT
      c.id AS cluster_id,
      c.name AS cluster_name,
      m.saved_keyword_id,
      m.role,
      k.keyword,
      km.intent_primary
    FROM topic_clusters c
    LEFT JOIN topic_cluster_members m ON m.cluster_id = c.id
    LEFT JOIN saved_keywords sk ON sk.id = m.saved_keyword_id
    LEFT JOIN keywords k ON k.id = sk.keyword_id
    LEFT JOIN keyword_metrics km ON km.id = (
      SELECT latest.id
      FROM keyword_metrics latest
      WHERE latest.keyword_id = k.id
      ORDER BY latest.fetched_at DESC, latest.id DESC
      LIMIT 1
    )
    WHERE c.site_profile_id = ?
    ORDER BY c.id ASC,
      CASE m.role WHEN 'primary' THEN 0 ELSE 1 END,
      k.normalized_keyword ASC
  `).bind(site.id).all();

  return {
    site_domain: input.site_domain,
    total_saved_keywords: total,
    truncated: total > input.limit,
    keywords: (keywordRows?.results ?? []).map((row) => ({
      saved_keyword_id: Number(row.saved_keyword_id),
      keyword: row.keyword,
      intent_primary: row.intent_primary ?? null,
    })),
    clusters: groupClusters(clusterRows?.results ?? []),
  };
}
