import { enrichGscIntelligenceRows, summarizeGscStoredMetrics } from "../../../../src/v2/gsc/intelligence.js";
import { readGscIntelligence } from "../../../../src/v2/storage/gsc-search-analytics.js";
import { normalizeRegistrableDomain } from "../../../../src/v2/storage/registrable-domain.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../src/v2/gsc/http.js";

const VIEWS = new Set(["queries", "pages", "query_page"]);

export async function onRequestGet({ request, env }) {
  const denied = requireGscAccess(request);
  if (denied) return denied;
  if (!env?.DB) return gscJson({ ok: false, error: { code: "GSC_DB_MISSING", message: "D1 binding is not configured." } }, 503);

  try {
    const url = new URL(request.url);
    const siteDomain = normalizeRegistrableDomain(url.searchParams.get("site_domain"));
    if (!siteDomain) {
      const error = new Error("A valid managed site domain is required.");
      error.code = "GSC_SITE_DOMAIN_REQUIRED";
      error.httpStatus = 400;
      throw error;
    }
    const view = url.searchParams.get("view") || "queries";
    if (!VIEWS.has(view)) {
      const error = new Error("Choose queries, pages, or query_page.");
      error.code = "GSC_INTELLIGENCE_VIEW_INVALID";
      error.httpStatus = 400;
      throw error;
    }
    const days = Number(url.searchParams.get("days") || 28);
    const limit = Number(url.searchParams.get("limit") || 100);
    const pageUrl = url.searchParams.get("page_url") || null;

    const stored = await readGscIntelligence(env.DB, { siteDomain, view, days, limit, pageUrl });
    const summary = summarizeGscStoredMetrics(stored.metrics, stored.coverage);
    const rows = enrichGscIntelligenceRows(stored.rows, {
      view,
      comparisonAvailable: summary.comparison_available,
    });

    return gscJson({
      ok: true,
      data: {
        site_domain: siteDomain,
        view,
        latest_date: stored.latest_date,
        window: stored.window,
        coverage: stored.coverage,
        summary,
        rows,
        disclaimer:
          "Metrics are recomputed from stored finalized Search Console rows. Query/page dimensions can be incomplete because Google may omit lower-volume rows, and configured sync caps may intentionally truncate a partition.",
      },
      meta: { actual_cost_usd: 0, provider_requests: 0, source: "d1" },
    });
  } catch (error) {
    return gscMappedError(error, "GSC_INTELLIGENCE_FAILED");
  }
}
