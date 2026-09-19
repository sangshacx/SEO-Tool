export async function readGscConnection(db) {
  return db.prepare("SELECT refresh_token_ciphertext, refresh_token_iv, encryption_version, scope, token_type, connected_at, updated_at FROM gsc_connections WHERE id = 1").bind().first();
}

export async function saveGscConnection(db, { ciphertext, iv, version = 1, scope, tokenType, connectedAt = new Date().toISOString() }) {
  const sql = "INSERT INTO gsc_connections (" +
    "id, refresh_token_ciphertext, refresh_token_iv, encryption_version, scope, token_type, connected_at, updated_at" +
    ") VALUES (1, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET " +
    "refresh_token_ciphertext = excluded.refresh_token_ciphertext, " +
    "refresh_token_iv = excluded.refresh_token_iv, " +
    "encryption_version = excluded.encryption_version, " +
    "scope = excluded.scope, " +
    "token_type = excluded.token_type, " +
    "connected_at = excluded.connected_at, " +
    "updated_at = excluded.updated_at";
  return db.prepare(sql).bind(ciphertext, iv, version, scope, tokenType ?? null, connectedAt, connectedAt).run();
}

export async function deleteGscConnection(db) {
  return db.batch([
    db.prepare("DELETE FROM gsc_site_mappings").bind(),
    db.prepare("DELETE FROM gsc_connections WHERE id = 1").bind(),
  ]);
}

export async function listGscMappings(db) {
  const sql = "SELECT sp.domain AS site_domain, gm.property, gm.property_type, gm.permission_level, gm.mapped_at, gm.updated_at " +
    "FROM gsc_site_mappings gm JOIN site_profiles sp ON sp.id = gm.site_profile_id ORDER BY sp.domain ASC";
  const result = await db.prepare(sql).bind().all();
  return result.results ?? [];
}

export async function saveGscMapping(db, { siteDomain, property, propertyType, permissionLevel, mappedAt = new Date().toISOString() }) {
  const site = await db.prepare("SELECT id FROM site_profiles WHERE domain = ? LIMIT 1").bind(siteDomain).first();
  if (!site?.id) {
    const error = new Error("SITE_PROFILE_NOT_FOUND");
    error.code = "SITE_PROFILE_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }
  const sql = "INSERT INTO gsc_site_mappings (" +
    "site_profile_id, property, property_type, permission_level, mapped_at, updated_at" +
    ") VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(site_profile_id) DO UPDATE SET " +
    "property = excluded.property, property_type = excluded.property_type, " +
    "permission_level = excluded.permission_level, mapped_at = excluded.mapped_at, updated_at = excluded.updated_at";
  await db.prepare(sql).bind(site.id, property, propertyType, permissionLevel ?? null, mappedAt, mappedAt).run();
  return { site_domain: siteDomain, property, property_type: propertyType, permission_level: permissionLevel ?? null, mapped_at: mappedAt };
}

export async function deleteGscMapping(db, siteDomain) {
  const site = await db.prepare("SELECT id FROM site_profiles WHERE domain = ? LIMIT 1").bind(siteDomain).first();
  if (!site?.id) return { deleted: false };
  const result = await db.prepare("DELETE FROM gsc_site_mappings WHERE site_profile_id = ?").bind(site.id).run();
  return { deleted: Number(result?.meta?.changes ?? 0) > 0 };
}
