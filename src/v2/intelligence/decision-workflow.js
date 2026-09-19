function workflowKey(page, action, query) {
  return [String(page || "").trim(), String(action || "").trim(), String(query || "").trim()].join("\n");
}

function parseTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function applyDecisionWorkflow(data = {}, workflowRows = [], now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const workflowMap = new Map(
    (Array.isArray(workflowRows) ? workflowRows : []).map((row) => [
      workflowKey(row.page_url, row.action_code, row.query),
      row,
    ]),
  );

  const active = [];
  const counts = { new: 0, in_progress: 0, done: 0, snoozed: 0, suppressed: 0 };

  for (const item of Array.isArray(data.action_queue) ? data.action_queue : []) {
    const row = workflowMap.get(workflowKey(item.page, item.action, item.query)) ?? null;
    let effectiveStatus = row?.status ?? "new";
    let suppressed = false;
    let snoozeExpired = false;

    if (effectiveStatus === "done") {
      suppressed = true;
    } else if (effectiveStatus === "snoozed") {
      const until = parseTime(row?.snooze_until);
      if (until !== null && until > nowMs) {
        suppressed = true;
      } else {
        effectiveStatus = "new";
        snoozeExpired = true;
      }
    }

    counts[effectiveStatus] = (counts[effectiveStatus] ?? 0) + 1;
    if (suppressed) counts.suppressed += 1;

    const enriched = {
      ...item,
      workflow: {
        status: effectiveStatus,
        persisted_status: row?.status ?? null,
        note: row?.note ?? "",
        snooze_until: row?.snooze_until ?? null,
        snooze_expired: snoozeExpired,
        updated_at: row?.updated_at ?? null,
      },
    };
    if (!suppressed) active.push(enriched);
  }

  return {
    ...data,
    action_queue: active,
    next_best_action: active[0] ?? null,
    workflow_summary: {
      ...counts,
      active: active.length,
      source: "d1",
    },
  };
}
