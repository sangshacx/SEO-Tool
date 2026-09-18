function parseTags(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function rowToSavedKeyword(row) {
  return {
    id: Number(row.id),
    site_domain: row.site_domain,
    keyword: row.keyword,
    location_code: Number(row.location_code),
    language_code: row.language_code,
    source: row.source,
    note: row.note ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tags: parseTags(row.tags_json),
    metrics: {
      search_volume: row.search_volume ?? null,
      keyword_difficulty: row.keyword_difficulty ?? null,
      cpc_usd: row.cpc_usd ?? null,
      competition: row.competition ?? null,
      intent_primary: row.intent_primary ?? null,
      fetched_at: row.metrics_fetched_at ?? null,
      provider: row.metrics_provider ?? null,
    },
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

async function readSavedKeyword(db, id, siteDomain) {
  const row = await db.prepare(`
    SELECT
      sk.id,
      sp.domain AS site_domain,
      k.keyword,
      k.location_code,
      k.language_code,
      sk.source,
      sk.note,
      sk.created_at,
      sk.updated_at,
      km.search_volume,
      km.keyword_difficulty,
      km.cpc_usd,
      km.competition,
      km.intent_primary,
      km.fetched_at AS metrics_fetched_at,
      km.provider AS metrics_provider,
      COALESCE((
        SELECT json_group_array(tag_name)
        FROM (
          SELECT t.name AS tag_name
          FROM saved_keyword_tag_assignments a
          JOIN saved_keyword_tags t ON t.id = a.tag_id
          WHERE a.saved_keyword_id = sk.id
          ORDER BY t.normalized_name ASC
        )
      ), '[]') AS tags_json
    FROM saved_keywords sk
    JOIN site_profiles sp ON sp.id = sk.site_profile_id
    JOIN keywords k ON k.id = sk.keyword_id
    LEFT JOIN keyword_metrics km ON km.id = (
      SELECT latest.id
      FROM keyword_metrics latest
      WHERE latest.keyword_id = k.id
      ORDER BY latest.fetched_at DESC, latest.id DESC
      LIMIT 1
    )
    WHERE sk.id = ? AND sp.domain = ?
    LIMIT 1
  `).bind(id, siteDomain).first();
  return row ? rowToSavedKeyword(row) : null;
}

export async function saveKeyword(db, input) {
  const site = await resolveSiteProfile(db, input.site_domain);

  const keyword = await db.prepare(`
    INSERT INTO keywords (
      keyword,
      normalized_keyword,
      language_code,
      location_code
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(normalized_keyword, language_code, location_code)
    DO UPDATE SET
      keyword = excluded.keyword,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `).bind(
    input.keyword,
    input.normalized_keyword,
    input.language_code,
    input.location_code,
  ).first();

  if (!keyword?.id) throw new Error("Unable to persist keyword identity.");

  const saved = await db.prepare(`
    INSERT INTO saved_keywords (
      site_profile_id,
      keyword_id,
      source,
      note
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(site_profile_id, keyword_id)
    DO UPDATE SET
      source = excluded.source,
      note = COALESCE(excluded.note, saved_keywords.note),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `).bind(site.id, keyword.id, input.source, input.note).first();

  if (!saved?.id) throw new Error("Unable to save keyword.");

  if (input.tags.length) {
    const statements = [];
    for (const tag of input.tags) {
      statements.push(
        db.prepare(`
          INSERT INTO saved_keyword_tags (
            site_profile_id,
            name,
            normalized_name
          ) VALUES (?, ?, ?)
          ON CONFLICT(site_profile_id, normalized_name)
          DO UPDATE SET name = excluded.name
        `).bind(site.id, tag.name, tag.normalized_name),
      );
      statements.push(
        db.prepare(`
          INSERT OR IGNORE INTO saved_keyword_tag_assignments (
            saved_keyword_id,
            tag_id
          )
          SELECT ?, id
          FROM saved_keyword_tags
          WHERE site_profile_id = ? AND normalized_name = ?
        `).bind(saved.id, site.id, tag.normalized_name),
      );
    }
    await db.batch(statements);
  }

  return readSavedKeyword(db, saved.id, input.site_domain);
}

const SORT_SQL = Object.freeze({
  created_at: "sk.created_at",
  keyword: "k.normalized_keyword",
  search_volume: "COALESCE(km.search_volume, -1)",
  keyword_difficulty: "COALESCE(km.keyword_difficulty, -1)",
  cpc_usd: "COALESCE(km.cpc_usd, -1)",
});

function whereClause(query, values) {
  const clauses = ["sp.domain = ?"];
  values.push(query.site_domain);

  if (query.q) {
    clauses.push("k.normalized_keyword LIKE ?");
    values.push(`%${query.q.toLowerCase()}%`);
  }
  if (query.tag) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM saved_keyword_tag_assignments filter_assignment
      JOIN saved_keyword_tags filter_tag ON filter_tag.id = filter_assignment.tag_id
      WHERE filter_assignment.saved_keyword_id = sk.id
        AND filter_tag.normalized_name = ?
    )`);
    values.push(query.tag);
  }
  return clauses.join(" AND ");
}

export async function listSavedKeywords(db, query) {
  const values = [];
  const where = whereClause(query, values);
  const countRow = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM saved_keywords sk
    JOIN site_profiles sp ON sp.id = sk.site_profile_id
    JOIN keywords k ON k.id = sk.keyword_id
    WHERE ${where}
  `).bind(...values).first();

  const total = Number(countRow?.total ?? 0);
  const offset = (query.page - 1) * query.page_size;
  const rows = await db.prepare(`
    SELECT
      sk.id,
      sp.domain AS site_domain,
      k.keyword,
      k.normalized_keyword,
      k.location_code,
      k.language_code,
      sk.source,
      sk.note,
      sk.created_at,
      sk.updated_at,
      km.search_volume,
      km.keyword_difficulty,
      km.cpc_usd,
      km.competition,
      km.intent_primary,
      km.fetched_at AS metrics_fetched_at,
      km.provider AS metrics_provider,
      COALESCE((
        SELECT json_group_array(tag_name)
        FROM (
          SELECT t.name AS tag_name
          FROM saved_keyword_tag_assignments a
          JOIN saved_keyword_tags t ON t.id = a.tag_id
          WHERE a.saved_keyword_id = sk.id
          ORDER BY t.normalized_name ASC
        )
      ), '[]') AS tags_json
    FROM saved_keywords sk
    JOIN site_profiles sp ON sp.id = sk.site_profile_id
    JOIN keywords k ON k.id = sk.keyword_id
    LEFT JOIN keyword_metrics km ON km.id = (
      SELECT latest.id
      FROM keyword_metrics latest
      WHERE latest.keyword_id = k.id
      ORDER BY latest.fetched_at DESC, latest.id DESC
      LIMIT 1
    )
    WHERE ${where}
    ORDER BY ${SORT_SQL[query.sort]} ${query.order.toUpperCase()}, sk.id DESC
    LIMIT ? OFFSET ?
  `).bind(...values, query.page_size, offset).all();

  return {
    items: (rows?.results ?? []).map(rowToSavedKeyword),
    page: query.page,
    page_size: query.page_size,
    total,
    total_pages: Math.max(1, Math.ceil(total / query.page_size)),
  };
}

export async function deleteSavedKeyword(db, input) {
  const result = await db.prepare(`
    DELETE FROM saved_keywords
    WHERE id = ?
      AND site_profile_id = (
        SELECT id FROM site_profiles WHERE domain = ? LIMIT 1
      )
  `).bind(input.id, input.site_domain).run();

  if (Number(result?.meta?.changes ?? 0) < 1) {
    const error = new Error("SAVED_KEYWORD_NOT_FOUND");
    error.code = "SAVED_KEYWORD_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }
  return { id: input.id, site_domain: input.site_domain };
}


export async function addTagsToSavedKeywords(db, input) {
  const site = await resolveSiteProfile(db, input.site_domain);
  const placeholders = input.ids.map(() => "?").join(", ");
  const owned = await db.prepare(
    `SELECT COUNT(*) AS total
     FROM saved_keywords
     WHERE site_profile_id = ?
       AND id IN (${placeholders})`,
  ).bind(site.id, ...input.ids).first();

  if (Number(owned?.total ?? 0) !== input.ids.length) {
    const error = new Error("SAVED_KEYWORD_NOT_FOUND");
    error.code = "SAVED_KEYWORD_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }

  await db.batch(input.tags.map((tag) =>
    db.prepare(`
      INSERT INTO saved_keyword_tags (
        site_profile_id,
        name,
        normalized_name
      ) VALUES (?, ?, ?)
      ON CONFLICT(site_profile_id, normalized_name)
      DO UPDATE SET name = excluded.name
    `).bind(site.id, tag.name, tag.normalized_name),
  ));

  const assignmentStatements = input.tags.map((tag) =>
    db.prepare(`
      INSERT OR IGNORE INTO saved_keyword_tag_assignments (
        saved_keyword_id,
        tag_id
      )
      SELECT sk.id, t.id
      FROM saved_keywords sk
      JOIN saved_keyword_tags t
        ON t.site_profile_id = sk.site_profile_id
       AND t.normalized_name = ?
      WHERE sk.site_profile_id = ?
        AND sk.id IN (${placeholders})
    `).bind(tag.normalized_name, site.id, ...input.ids),
  );
  await db.batch(assignmentStatements);

  return {
    site_domain: input.site_domain,
    updated_count: input.ids.length,
    ids: input.ids,
    tags: input.tags.map((tag) => tag.name),
  };
}
