function rowToMember(row) {
  return {
    saved_keyword_id: Number(row.saved_keyword_id),
    keyword: row.keyword,
    role: row.role,
    location_code: Number(row.location_code),
    language_code: row.language_code,
    assigned_at: row.assigned_at,
  };
}

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

async function requireOwnedCluster(db, siteId, clusterId) {
  const cluster = await db.prepare(
    "SELECT id, name, normalized_name, source, created_at, updated_at FROM topic_clusters WHERE id = ? AND site_profile_id = ? LIMIT 1",
  ).bind(clusterId, siteId).first();
  if (!cluster?.id) {
    const error = new Error("TOPIC_CLUSTER_NOT_FOUND");
    error.code = "TOPIC_CLUSTER_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }
  return cluster;
}

async function readClusterRows(db, siteId, clusterId = null) {
  const filter = clusterId == null ? "" : " AND c.id = ?";
  const args = clusterId == null ? [siteId] : [siteId, clusterId];
  const sql = [
    "SELECT",
    "c.id AS cluster_id, c.name, c.source, c.created_at, c.updated_at,",
    "m.saved_keyword_id, m.role, m.assigned_at,",
    "k.keyword, k.location_code, k.language_code",
    "FROM topic_clusters c",
    "LEFT JOIN topic_cluster_members m ON m.cluster_id = c.id",
    "LEFT JOIN saved_keywords sk ON sk.id = m.saved_keyword_id",
    "LEFT JOIN keywords k ON k.id = sk.keyword_id",
    "WHERE c.site_profile_id = ?" + filter,
    "ORDER BY c.updated_at DESC, c.id DESC,",
    "CASE m.role WHEN 'primary' THEN 0 ELSE 1 END,",
    "k.normalized_keyword ASC",
  ].join(" ");
  const rows = await db.prepare(sql).bind(...args).all();
  return rows?.results ?? [];
}

function groupClusters(rows, siteDomain) {
  const grouped = new Map();
  for (const row of rows) {
    const id = Number(row.cluster_id);
    if (!grouped.has(id)) {
      grouped.set(id, {
        id,
        site_domain: siteDomain,
        name: row.name,
        source: row.source,
        created_at: row.created_at,
        updated_at: row.updated_at,
        primary: null,
        supporting: [],
        member_count: 0,
      });
    }
    if (row.saved_keyword_id == null) continue;
    const cluster = grouped.get(id);
    const member = rowToMember(row);
    cluster.member_count += 1;
    if (member.role === "primary") cluster.primary = member;
    else cluster.supporting.push(member);
  }
  return [...grouped.values()];
}

export async function listKeywordClusters(db, input) {
  const site = await resolveSiteProfile(db, input.site_domain);
  return {
    site_domain: input.site_domain,
    clusters: groupClusters(await readClusterRows(db, site.id), input.site_domain),
  };
}

export async function createKeywordCluster(db, input) {
  const site = await resolveSiteProfile(db, input.site_domain);
  const row = await db.prepare(
    "INSERT INTO topic_clusters (site_profile_id, name, normalized_name, source) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(site_profile_id, normalized_name) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP RETURNING id",
  ).bind(site.id, input.name, input.normalized_name, input.source).first();

  const clusters = groupClusters(await readClusterRows(db, site.id, row.id), input.site_domain);
  return clusters[0] ?? null;
}

export async function assignKeywordClusterMembers(db, input) {
  const site = await resolveSiteProfile(db, input.site_domain);
  await requireOwnedCluster(db, site.id, input.cluster_id);

  const ids = input.assignments.map((assignment) => assignment.saved_keyword_id);
  const placeholders = ids.map(() => "?").join(", ");
  const owned = await db.prepare(
    "SELECT COUNT(*) AS total FROM saved_keywords WHERE site_profile_id = ? AND id IN (" + placeholders + ")",
  ).bind(site.id, ...ids).first();

  if (Number(owned?.total ?? 0) !== ids.length) {
    const error = new Error("SAVED_KEYWORD_NOT_FOUND");
    error.code = "SAVED_KEYWORD_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }

  const statements = [
    db.prepare(
      "DELETE FROM topic_cluster_members WHERE saved_keyword_id IN (" + placeholders + ")",
    ).bind(...ids),
    db.prepare(
      "DELETE FROM topic_cluster_members WHERE cluster_id = ?",
    ).bind(input.cluster_id),
    ...input.assignments.map((assignment) =>
      db.prepare(
        "INSERT INTO topic_cluster_members (cluster_id, saved_keyword_id, role) VALUES (?, ?, ?)",
      ).bind(input.cluster_id, assignment.saved_keyword_id, assignment.role),
    ),
    db.prepare(
      "UPDATE topic_clusters SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND site_profile_id = ?",
    ).bind(input.cluster_id, site.id),
  ];
  await db.batch(statements);

  const clusters = groupClusters(await readClusterRows(db, site.id, input.cluster_id), input.site_domain);
  return clusters[0] ?? null;
}
