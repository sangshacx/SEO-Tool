export const ORGANIC_POSITION_CHANGES_VERSION = "organic-position-changes-v0.1";

export function classifyOrganicPositionChange(row = {}) {
  const movement = row.movement ?? {};
  if (movement.is_lost) return { code: "lost", label: "Lost" };
  if (movement.is_new) return { code: "new", label: "New" };
  if (movement.is_up) return { code: "improved", label: "Improved" };
  if (movement.is_down) return { code: "declined", label: "Declined" };
  return { code: "stable", label: "Stable" };
}

export function buildOrganicPositionChanges(data = {}) {
  const rows = (Array.isArray(data.items) ? data.items : []).map((row) => ({
    ...row,
    change: classifyOrganicPositionChange(row),
  }));
  const returned = {
    new: rows.filter((row) => row.change.code === "new").length,
    improved: rows.filter((row) => row.change.code === "improved").length,
    declined: rows.filter((row) => row.change.code === "declined").length,
    lost: rows.filter((row) => row.change.code === "lost").length,
    stable: rows.filter((row) => row.change.code === "stable").length,
  };
  const aggregate = data?.organic?.changes ?? {};
  return {
    ...data,
    items: rows,
    change_summary: {
      aggregate: {
        new: aggregate.new ?? null,
        improved: aggregate.up ?? null,
        declined: aggregate.down ?? null,
        lost: aggregate.lost ?? null,
      },
      returned,
    },
    change_window: {
      previous_updated_at: data?.update_window?.previous_updated_at ?? null,
      last_updated_at: data?.update_window?.last_updated_at ?? null,
      semantics: "latest_provider_update",
    },
    position_change_version: ORGANIC_POSITION_CHANGES_VERSION,
  };
}
