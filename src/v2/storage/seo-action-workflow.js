function rowToWorkflow(row) {
  return {
    id: Number(row.id),
    site_domain: row.site_domain,
    page_url: row.page_url,
    action_code: row.action_code,
    query: row.query_text || null,
    status: row.status,
    note: row.note || "",
    snooze_until: row.snooze_until ?? null,
    last_priority_score: row.last_priority_score == null ? null : Number(row.last_priority_score),
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

export async function listSeoActionWorkflow(db, siteDomain) {
  const rows = await db.prepare(`
    SELECT
      w.id,
      sp.domain AS site_domain,
      w.page_url,
      w.action_code,
      w.query_text,
      w.status,
      w.note,
      w.snooze_until,
      w.last_priority_score,
      w.first_seen_at,
      w.last_seen_at,
      w.created_at,
      w.updated_at
    FROM seo_action_workflow w
    JOIN site_profiles sp ON sp.id = w.site_profile_id
    WHERE sp.domain = ?
    ORDER BY w.updated_at DESC, w.id DESC
  `).bind(siteDomain).all();
  return (rows?.results ?? []).map(rowToWorkflow);
}

export async function upsertSeoActionWorkflow(db, input) {
  const site = await resolveSiteProfile(db, input.site_domain);
  const row = await db.prepare(`
    INSERT INTO seo_action_workflow (
      site_profile_id,
      page_url,
      action_code,
      query_text,
      status,
      note,
      snooze_until,
      last_priority_score,
      first_seen_at,
      last_seen_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(site_profile_id, page_url, action_code, query_text)
    DO UPDATE SET
      status = excluded.status,
      note = excluded.note,
      snooze_until = excluded.snooze_until,
      last_priority_score = COALESCE(excluded.last_priority_score, seo_action_workflow.last_priority_score),
      last_seen_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `).bind(
    site.id,
    input.page_url,
    input.action_code,
    input.query ?? "",
    input.status,
    input.note ?? "",
    input.status === "snoozed" ? input.snooze_until : null,
    input.priority_score ?? null,
  ).first();

  if (!row?.id) throw new Error("Unable to persist SEO action workflow.");

  const saved = await db.prepare(`
    SELECT
      w.id,
      sp.domain AS site_domain,
      w.page_url,
      w.action_code,
      w.query_text,
      w.status,
      w.note,
      w.snooze_until,
      w.last_priority_score,
      w.first_seen_at,
      w.last_seen_at,
      w.created_at,
      w.updated_at
    FROM seo_action_workflow w
    JOIN site_profiles sp ON sp.id = w.site_profile_id
    WHERE w.id = ?
    LIMIT 1
  `).bind(row.id).first();
  return rowToWorkflow(saved);
}
