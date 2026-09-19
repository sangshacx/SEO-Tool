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

function rowToEvent(row) {
  return {
    id: Number(row.id),
    workflow_id: Number(row.workflow_id),
    site_domain: row.site_domain,
    page_url: row.page_url,
    action_code: row.action_code,
    query: row.query_text || null,
    from_status: row.from_status ?? null,
    to_status: row.to_status,
    note: row.note_snapshot || "",
    snooze_until: row.snooze_until ?? null,
    priority_score: row.priority_score == null ? null : Number(row.priority_score),
    created_at: row.created_at,
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

async function readWorkflowIdentity(db, siteProfileId, input) {
  return db.prepare(`
    SELECT id, status, note, snooze_until, last_priority_score
    FROM seo_action_workflow
    WHERE site_profile_id = ?
      AND page_url = ?
      AND action_code = ?
      AND query_text = ?
    LIMIT 1
  `).bind(
    siteProfileId,
    input.page_url,
    input.action_code,
    input.query ?? "",
  ).first();
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

export async function listSeoActionWorkflowEvents(db, siteDomain, { limit = 50 } = {}) {
  const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = await db.prepare(`
    SELECT
      e.id,
      e.workflow_id,
      sp.domain AS site_domain,
      e.page_url,
      e.action_code,
      e.query_text,
      e.from_status,
      e.to_status,
      e.note_snapshot,
      e.snooze_until,
      e.priority_score,
      e.created_at
    FROM seo_action_workflow_events e
    JOIN site_profiles sp ON sp.id = e.site_profile_id
    WHERE sp.domain = ?
    ORDER BY e.id DESC
    LIMIT ?
  `).bind(siteDomain, boundedLimit).all();
  return (rows?.results ?? []).map(rowToEvent);
}

export async function upsertSeoActionWorkflow(db, input) {
  const site = await resolveSiteProfile(db, input.site_domain);
  const previous = await readWorkflowIdentity(db, site.id, input);
  const nextSnoozeUntil = input.status === "snoozed" ? input.snooze_until : null;
  const nextNote = input.note_provided === false
    ? (previous?.note ?? "")
    : (input.note ?? "");

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
    nextNote,
    nextSnoozeUntil,
    input.priority_score ?? null,
  ).first();

  if (!row?.id) throw new Error("Unable to persist SEO action workflow.");

  const changed =
    !previous ||
    previous.status !== input.status ||
    (previous.note ?? "") !== nextNote ||
    (previous.snooze_until ?? null) !== (nextSnoozeUntil ?? null);

  if (changed) {
    await db.prepare(`
      INSERT INTO seo_action_workflow_events (
        site_profile_id,
        workflow_id,
        page_url,
        action_code,
        query_text,
        from_status,
        to_status,
        note_snapshot,
        snooze_until,
        priority_score,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      site.id,
      row.id,
      input.page_url,
      input.action_code,
      input.query ?? "",
      previous?.status ?? null,
      input.status,
      nextNote,
      nextSnoozeUntil,
      input.priority_score ?? previous?.last_priority_score ?? null,
    ).run();
  }

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


export async function getSeoActionWorkflowStats(db, siteDomain) {
  const currentRows = await db.prepare(`
    SELECT w.status, COUNT(*) AS total
    FROM seo_action_workflow w
    JOIN site_profiles sp ON sp.id = w.site_profile_id
    WHERE sp.domain = ?
    GROUP BY w.status
  `).bind(siteDomain).all();

  const current = { new: 0, in_progress: 0, done: 0, snoozed: 0, total: 0 };
  for (const row of currentRows?.results ?? []) {
    const status = String(row.status || "");
    const total = Number(row.total ?? 0);
    if (Object.hasOwn(current, status)) current[status] = total;
    current.total += total;
  }

  const recent = await db.prepare(`
    SELECT
      COUNT(*) AS events_7d,
      SUM(CASE WHEN e.to_status = 'in_progress' THEN 1 ELSE 0 END) AS started_7d,
      SUM(CASE WHEN e.to_status = 'done' THEN 1 ELSE 0 END) AS completed_7d,
      SUM(CASE WHEN e.to_status = 'snoozed' THEN 1 ELSE 0 END) AS snoozed_7d,
      SUM(CASE WHEN e.to_status = 'new' AND e.from_status IS NOT NULL THEN 1 ELSE 0 END) AS reopened_7d
    FROM seo_action_workflow_events e
    JOIN site_profiles sp ON sp.id = e.site_profile_id
    WHERE sp.domain = ?
      AND e.created_at >= datetime('now', '-7 days')
  `).bind(siteDomain).first();

  const month = await db.prepare(`
    SELECT
      SUM(CASE WHEN e.to_status = 'done' THEN 1 ELSE 0 END) AS completed_30d
    FROM seo_action_workflow_events e
    JOIN site_profiles sp ON sp.id = e.site_profile_id
    WHERE sp.domain = ?
      AND e.created_at >= datetime('now', '-30 days')
  `).bind(siteDomain).first();

  return {
    current,
    last_7_days: {
      events: Number(recent?.events_7d ?? 0),
      started: Number(recent?.started_7d ?? 0),
      completed: Number(recent?.completed_7d ?? 0),
      snoozed: Number(recent?.snoozed_7d ?? 0),
      reopened: Number(recent?.reopened_7d ?? 0),
    },
    last_30_days: {
      completed: Number(month?.completed_30d ?? 0),
    },
  };
}
