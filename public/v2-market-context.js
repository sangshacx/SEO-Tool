const DEFAULT_MARKET = Object.freeze({
  location_code: 2840,
  location_name: "United States",
  country_iso_code: "US",
  language_code: "en",
  language_name: "English",
});
const LEGACY_PROFILES_KEY = "seo-pro-v2.site-profiles.v1";
const MIGRATION_KEY = "seo-pro-v2.site-profiles-d1-migrated.v1";
const SITES_URL = "/api/v2/sites";
const MAX_IMPORT_BYTES = 64 * 1024;
const MAX_IMPORT_PROFILES = 100;

function normalizedMarket(value = {}) {
  const locationCode = Number(value.location_code);
  const languageCode = String(value.language_code || "").trim();
  if (!Number.isInteger(locationCode) || !languageCode) throw new TypeError("Invalid market context.");
  return Object.freeze({
    domain: value.domain ? String(value.domain) : undefined,
    location_code: locationCode,
    location_name: String(value.location_name || locationCode),
    country_iso_code: String(value.country_iso_code || ""),
    language_code: languageCode,
    language_name: String(value.language_name || languageCode),
  });
}

export function createMarketContext(initial = DEFAULT_MARKET) {
  let current = normalizedMarket(initial);
  const subscribers = new Set();
  return Object.freeze({
    get: () => current,
    set(next) {
      const value = normalizedMarket(next);
      if (JSON.stringify(value) === JSON.stringify(current)) return current;
      current = value;
      subscribers.forEach((subscriber) => subscriber(current));
      return current;
    },
    subscribe(subscriber) {
      if (typeof subscriber !== "function") throw new TypeError("Subscriber must be a function.");
      subscribers.add(subscriber);
      subscriber(current);
      return () => subscribers.delete(subscriber);
    },
  });
}

export function marketRequestFields(context) {
  const market = context.get();
  return { location_code: market.location_code, language_code: market.language_code };
}

export function resolveActiveProfile(profiles, savedDomain) {
  const list = Array.isArray(profiles) ? profiles : [];
  return list.find((profile) => profile.domain === savedDomain) || list[0] || null;
}

export function siteProfileFormPayload(existing, draft) {
  const hasExplicitValue = Object.hasOwn(draft || {}, "include_subdomains");
  return { ...draft, include_subdomains: hasExplicitValue ? Boolean(draft.include_subdomains) : Boolean(existing?.include_subdomains) };
}

export function createProfileMarketSync({ write, onStateChange = () => {} }) {
  if (typeof write !== "function") throw new TypeError("Profile writer must be a function.");
  const dirty = new Map();
  const writeChains = new Map();
  let revision = 0;

  const snapshot = () => ({
    dirty_domains: [...dirty.keys()].sort(),
    failed_domains: [...dirty.entries()].filter(([, entry]) => entry.status === "failed").map(([domain]) => domain).sort(),
  });
  const notify = () => onStateChange(snapshot());

  const save = async (domain, market) => {
    const entry = { revision: ++revision, market: structuredClone(market), status: "saving", retryable: false, error: null };
    let operation;
    dirty.set(domain, entry);
    notify();
    try {
      const previous = writeChains.get(domain) || Promise.resolve();
      operation = previous.catch(() => {}).then(() => write(domain, entry.market));
      writeChains.set(domain, operation);
      const result = await operation;
      if (writeChains.get(domain) === operation) writeChains.delete(domain);
      if (dirty.get(domain)?.revision === entry.revision) dirty.delete(domain);
      notify();
      return { ok: true, data: result };
    } catch (error) {
      if (writeChains.get(domain) === operation) writeChains.delete(domain);
      if (dirty.get(domain)?.revision === entry.revision) {
        entry.status = "failed";
        entry.retryable = true;
        entry.error = error;
      }
      notify();
      return { ok: false, error };
    }
  };

  return Object.freeze({
    save,
    retry(domain) {
      const entry = dirty.get(domain);
      return entry ? save(domain, entry.market) : Promise.resolve({ ok: true, skipped: true });
    },
    get(domain) {
      const entry = dirty.get(domain);
      return entry ? { ...entry, market: structuredClone(entry.market) } : null;
    },
    dirtyDomains: () => [...dirty.keys()].sort(),
  });
}

export function applyMarketToRoot(root, market) {
  if (!root || !Number.isInteger(Number(market?.location_code)) || !market?.language_code) return false;
  root.querySelectorAll("[data-v2-location-code]").forEach((field) => { field.value = String(market.location_code); });
  root.querySelectorAll("[data-v2-language-code]").forEach((field) => { field.value = String(market.language_code); });
  return true;
}

export async function loadMarketCatalog(fetchImpl = fetch) {
  const response = await fetchImpl("./data/v2-markets.json", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("MARKET_CATALOG_UNAVAILABLE");
  const catalog = await response.json();
  if (!Array.isArray(catalog.locations) || !Array.isArray(catalog.languages)) throw new Error("INVALID_MARKET_CATALOG");
  return catalog;
}

export function orderedLocations(catalog) {
  const byCode = new Map((catalog?.locations || []).map((item) => [Number(item.location_code), item]));
  const pinned = (catalog?.pinned_location_codes || []).map((code) => byCode.get(Number(code))).filter(Boolean);
  const pinnedCodes = new Set(pinned.map((item) => Number(item.location_code)));
  const remaining = [...byCode.values()].filter((item) => !pinnedCodes.has(Number(item.location_code))).sort((a, b) => a.location_name.localeCompare(b.location_name));
  return [...pinned, ...remaining];
}

export function compatibleLanguages(catalog, locationCode) {
  const location = (catalog?.locations || []).find((item) => Number(item.location_code) === Number(locationCode));
  if (!location) return [];
  const supported = new Set(location.supported_language_codes || []);
  return (catalog.languages || []).filter((item) => supported.has(item.language_code));
}

export function findMarket(catalog, locationCode, languageCode) {
  const location = (catalog?.locations || []).find((item) => Number(item.location_code) === Number(locationCode));
  const language = compatibleLanguages(catalog, locationCode).find((item) => item.language_code === languageCode);
  if (!location || !language) return null;
  return {
    location_code: Number(location.location_code),
    location_name: location.location_name,
    country_iso_code: location.country_iso_code,
    language_code: language.language_code,
    language_name: language.language_name,
  };
}

export function resolveProfileMarket(catalog, profile) {
  const requested = findMarket(catalog, profile?.location_code, profile?.language_code);
  const fallback = findMarket(catalog, DEFAULT_MARKET.location_code, DEFAULT_MARKET.language_code) || DEFAULT_MARKET;
  return {
    market: requested || fallback,
    warning: profile && !requested ? "此网站保存的市场已不受支持，当前临时重置为 United States · English。" : "",
  };
}

export function composeMarketWarnings({ base = "", compatibility = "", dirtyDomains = [] } = {}) {
  const dirty = dirtyDomains.length ? `尚未同步：${dirtyDomains.join("、")}` : "";
  return [base, compatibility, dirty].filter(Boolean).join(" ");
}

function normalizeLocalDomain(value) {
  let raw = String(value || "").trim().toLowerCase();
  try {
    if (!/^https?:\/\//.test(raw)) raw = `https://${raw}`;
    const host = new URL(raw).hostname.replace(/^www\./, "").replace(/\.$/, "");
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
  } catch { return null; }
}

function normalizeLocalProfiles(storage, catalog) {
  let records = [];
  try { records = JSON.parse(storage?.getItem(LEGACY_PROFILES_KEY) || "[]"); } catch { records = []; }
  const seen = new Set();
  return (Array.isArray(records) ? records : []).flatMap((raw) => {
    const domain = normalizeLocalDomain(raw?.domain);
    if (!domain || seen.has(domain)) return [];
    seen.add(domain);
    const requested = findMarket(catalog, raw.location_code, raw.language_code);
    const market = requested || findMarket(catalog, DEFAULT_MARKET.location_code, DEFAULT_MARKET.language_code) || DEFAULT_MARKET;
    const competitors = (Array.isArray(raw.competitors) ? raw.competitors : []).map(normalizeLocalDomain).filter(Boolean).filter((item, index, all) => item !== domain && all.indexOf(item) === index).slice(0, 5);
    return [{ domain, label: String(raw.label || domain).trim().slice(0, 80) || domain, ...market, include_subdomains: Boolean(raw.include_subdomains), competitors }];
  });
}

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body?.error?.message || "SITE_PROFILE_SYNC_FAILED");
  return body.data;
}

export async function loadSiteProfilesD1First({ fetchImpl = fetch, storage, catalog }) {
  const localProfiles = normalizeLocalProfiles(storage, catalog);
  let serverProfiles;
  try {
    serverProfiles = await readJson(await fetchImpl(SITES_URL, { headers: { accept: "application/json" } }));
    if (!Array.isArray(serverProfiles)) throw new Error("INVALID_SITE_PROFILE_RESPONSE");
  } catch {
    return { profiles: localProfiles, source: "local-fallback", warning: "网站配置暂时未同步；当前仅使用本机临时资料。" };
  }
  if (serverProfiles.length) return { profiles: serverProfiles, source: "d1", warning: "" };
  if (storage?.getItem(MIGRATION_KEY) === "complete" || !localProfiles.length) return { profiles: [], source: "d1", warning: "" };

  try {
    for (const profile of localProfiles) {
      await readJson(await fetchImpl(SITES_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(profile),
      }));
    }
    const profiles = await readJson(await fetchImpl(SITES_URL, { headers: { accept: "application/json" } }));
    if (!Array.isArray(profiles)) throw new Error("INVALID_SITE_PROFILE_RESPONSE");
    storage?.setItem(MIGRATION_KEY, "complete");
    return { profiles, source: "d1", warning: "", migrated: true };
  } catch {
    return { profiles: localProfiles, source: "local-fallback", warning: "旧网站资料尚未同步；当前仅使用本机临时资料。" };
  }
}

export function profileExportUrl() {
  return `${SITES_URL}?format=export`;
}

export function parseSiteProfileImportText(text) {
  if (new TextEncoder().encode(String(text)).byteLength > MAX_IMPORT_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  let envelope;
  try { envelope = JSON.parse(String(text)); } catch { throw new Error("INVALID_JSON"); }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !Array.isArray(envelope.profiles)) {
    throw new Error("INVALID_IMPORT_SHAPE");
  }
  const keys = Object.keys(envelope).sort();
  if (keys.length !== 2 || keys[0] !== "profiles" || keys[1] !== "version") throw new Error("INVALID_IMPORT_SHAPE");
  if (envelope.version !== 1) throw new Error("UNSUPPORTED_IMPORT_VERSION");
  if (envelope.profiles.length > MAX_IMPORT_PROFILES) throw new Error("TOO_MANY_PROFILES");
  return envelope;
}

export async function importSiteProfileEnvelope(fetchImpl, envelope) {
  return readJson(await fetchImpl(`${SITES_URL}?format=import`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(envelope),
  }));
}

export const MARKET_DEFAULTS = DEFAULT_MARKET;
