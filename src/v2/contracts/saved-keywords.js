import { normalizeMarketRequest } from "../markets/request-market.js";
import { normalizeRegistrableDomain } from "../storage/registrable-domain.js";

export const SAVED_KEYWORDS_CONTRACT_VERSION = "saved-keywords-v0.2";
export const SAVED_KEYWORD_SOURCES = Object.freeze([
  "manual",
  "keyword_explorer",
  "keyword_ideas",
  "competitor_snapshot",
  "keyword_gap",
  "serp_reality",
]);

const SOURCE_SET = new Set(SAVED_KEYWORD_SOURCES);
const SORT_FIELDS = new Set([
  "created_at",
  "keyword",
  "search_volume",
  "keyword_difficulty",
  "cpc_usd",
]);
const SORT_ORDERS = new Set(["asc", "desc"]);

export class SavedKeywordContractError extends Error {
  constructor(code, field, message = code) {
    super(message);
    this.name = "SavedKeywordContractError";
    this.code = code;
    this.field = field;
    this.httpStatus = 400;
  }
}

function fail(code, field, message) {
  throw new SavedKeywordContractError(code, field, message);
}

function cleanKeyword(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanDomain(value) {
  const domain = normalizeRegistrableDomain(value);
  if (!domain) fail("INVALID_SITE_DOMAIN", "site_domain", "A valid site domain is required.");
  return domain;
}

function cleanSource(value) {
  const source = value == null ? "manual" : String(value).trim();
  if (!SOURCE_SET.has(source)) {
    fail("INVALID_SOURCE", "source", "Unsupported saved-keyword source.");
  }
  return source;
}

function cleanNote(value) {
  if (value == null) return null;
  const note = String(value).trim();
  if (note.length > 1000) fail("NOTE_TOO_LONG", "note", "Note must be 1000 characters or fewer.");
  return note || null;
}

function cleanTags(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail("INVALID_TAGS", "tags", "Tags must be an array.");
  if (value.length > 20) fail("TOO_MANY_TAGS", "tags", "No more than 20 tags may be supplied.");

  const tags = [];
  const seen = new Set();
  for (const raw of value) {
    const name = String(raw ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 64) fail("INVALID_TAG", "tags", "Each tag must be 1-64 characters.");
    const normalized_name = name.toLowerCase();
    if (seen.has(normalized_name)) continue;
    seen.add(normalized_name);
    tags.push({ name, normalized_name });
  }
  return tags;
}

export function normalizeSavedKeywordCreate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_BODY", "body", "Request body must be a JSON object.");
  }

  const keyword = cleanKeyword(input.keyword);
  if (!keyword || keyword.length > 80 || keyword.split(" ").length > 10) {
    fail("INVALID_KEYWORD", "keyword", "Keyword must be 1-80 characters and no more than 10 words.");
  }

  let market;
  try {
    market = normalizeMarketRequest(input);
  } catch {
    fail("INVALID_MARKET", "market", "Select a supported country and language combination.");
  }

  return {
    site_domain: cleanDomain(input.site_domain),
    keyword,
    normalized_keyword: keyword.toLowerCase(),
    location_code: market.locationCode,
    language_code: market.languageCode,
    source: cleanSource(input.source),
    note: cleanNote(input.note),
    tags: cleanTags(input.tags),
  };
}

export function normalizeSavedKeywordListQuery(searchParams) {
  const site_domain = cleanDomain(searchParams.get("site_domain"));
  const q = cleanKeyword(searchParams.get("q"));
  if (q.length > 80) fail("INVALID_QUERY", "q", "q must be 80 characters or fewer.");

  const tagRaw = searchParams.get("tag");
  const tag = tagRaw == null ? null : String(tagRaw).trim().replace(/\s+/g, " ").toLowerCase();
  if (tag && tag.length > 64) fail("INVALID_TAG", "tag", "tag must be 64 characters or fewer.");

  const page = Number(searchParams.get("page") ?? 1);
  const page_size = Number(searchParams.get("page_size") ?? 50);
  if (!Number.isInteger(page) || page < 1) fail("INVALID_PAGE", "page", "page must be a positive integer.");
  if (![25, 50, 100].includes(page_size)) {
    fail("INVALID_PAGE_SIZE", "page_size", "page_size must be 25, 50, or 100.");
  }

  const sort = searchParams.get("sort") ?? "created_at";
  const order = searchParams.get("order") ?? "desc";
  if (!SORT_FIELDS.has(sort)) fail("INVALID_SORT", "sort", "Unsupported sort field.");
  if (!SORT_ORDERS.has(order)) fail("INVALID_ORDER", "order", "order must be asc or desc.");

  return { site_domain, q, tag, page, page_size, sort, order };
}

export function normalizeSavedKeywordDelete(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_BODY", "body", "Request body must be a JSON object.");
  }
  const id = Number(input.id);
  if (!Number.isInteger(id) || id < 1) fail("INVALID_ID", "id", "A positive saved keyword id is required.");
  return { site_domain: cleanDomain(input.site_domain), id };
}

export function normalizeSavedKeywordTagUpdate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_BODY", "body", "Request body must be a JSON object.");
  }
  if (!Array.isArray(input.ids) || !input.ids.length) {
    fail("INVALID_IDS", "ids", "At least one saved keyword id is required.");
  }
  if (input.ids.length > 100) {
    fail("TOO_MANY_IDS", "ids", "No more than 100 saved keywords may be tagged at once.");
  }

  const ids = [];
  const seen = new Set();
  for (const raw of input.ids) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) {
      fail("INVALID_ID", "ids", "Saved keyword ids must be positive integers.");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  const tags = cleanTags(input.tags);
  if (!tags.length) fail("INVALID_TAGS", "tags", "At least one tag is required.");

  return {
    site_domain: cleanDomain(input.site_domain),
    ids,
    tags,
  };
}
