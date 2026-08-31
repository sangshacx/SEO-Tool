# Cached Site Dashboard Design

## Goal

Turn SEO Pro V2 Overview into an Ahrefs-style, high-information website dashboard that reads cached and durable project data by default and performs live provider updates only after an explicit module-level confirmation.

## Dependency

This subsystem is implemented after `2026-08-30-global-keyword-markets-design.md`. Dashboard data is always scoped by the active site plus its selected country and language.

## Data model

The dashboard reads a normalized `site_dashboard_snapshots` model. A snapshot contains independently nullable modules:

- organic overview;
- top organic keywords;
- backlink overview;
- backlink history delta;
- competitor summary;
- keyword opportunities;
- backlink opportunities;
- workflow prospect counts.

Each module stores:

- normalized data;
- source (`d1`, `kv_cache`, or `live` at capture time);
- `updated_at`;
- provider freshness when available;
- market scope where relevant;
- schema version.

Missing modules are represented as unavailable, never as zero. Zero is displayed only when the source explicitly reports zero.

## Read path

`GET /api/v2/dashboard?site=<domain>&location_code=<code>&language_code=<code>` is a zero-cost aggregator.

It reads only:

- D1 site and snapshot records;
- existing D1 backlink history;
- existing D1 saved Link Prospects;
- existing KV cache entries that can be addressed deterministically from the site and market.

It must never call DataForSEO. The response reports per-module availability, freshness, and source. A failure to read one optional module does not suppress other modules. A total D1 binding/read failure returns a structured `503`.

## Overview layout

### Header

```text
Site | Country | Language | Last dashboard update | Update dashboard data
```

Changing site or market triggers only the zero-cost dashboard read.

### Core metrics

- Organic Keywords
- Organic Traffic
- Traffic Value
- Domain Rank
- Backlinks
- Referring Domains

Each card displays the current value, previous-snapshot delta when available, scope, updated time, and a link to its detailed view.

### Trends

- Organic Traffic and Organic Keywords
- Backlinks and Referring Domains

Available ranges are 30 days, 90 days, six months, and one year. If fewer than two snapshots exist, show the exact empty state: `需要至少两份快照才能显示趋势`.

### Tables

Top Organic Keywords shows up to ten rows:

- keyword;
- position;
- search volume;
- estimated traffic;
- keyword difficulty;
- CPC;
- ranking URL.

Competitors shows up to ten rows:

- competitor domain;
- shared keywords;
- competitor-only keywords;
- estimated traffic;
- keyword gap count;
- backlink gap count.

### Opportunities and risks

Show five to ten items per module with a `查看全部` route:

- high-value Keyword Gap;
- high-quality Backlink Gap;
- domains recommended for manual research;
- new or lost backlinks;
- spam and broken-link warnings;
- saved Link Prospects awaiting action.

## Manual refresh workflow

Clicking `更新总览数据` opens a review dialog. It does not start work immediately.

The dialog lists refresh modules:

- Organic Overview + Top Keywords (one shared provider result);
- Backlink Overview;
- Competitor Summary;
- Keyword Opportunities;
- Backlink Opportunities.

Each module is labeled:

- `缓存可用 · $0`;
- `需要实时更新 · 可能付费`;
- `暂不更新`.

The user selects modules and confirms. The client sends one refresh request containing the selected module identifiers and `allow_live_request: true` only for explicitly confirmed live modules.

The server executes modules independently with a single-flight lock per site/market/module set. It rechecks cache state after acquiring the lock, so concurrent requests cannot pay twice for a result another request just stored.

The result reports each module's:

- status;
- cached flag;
- actual provider task count;
- actual cost;
- cache write status;
- updated timestamp;
- safe error if failed.

Successful modules are saved even if another module fails. The dialog shows actual total cost after completion and keeps previous data for failed modules.

## Snapshot and history behavior

- A dashboard snapshot is inserted only when at least one module has new normalized data.
- Cache-only reads do not create duplicate snapshots.
- Repeated results may create a dated snapshot only after the configured minimum interval, preventing noisy history.
- Organic and backlink histories remain independently nullable.
- Trend comparison uses the closest earlier available snapshot inside the selected range.

## Cost and safety rules

- Opening Overview: `$0`.
- Switching site, country, language, filters, or chart range: `$0`.
- Merely opening the refresh dialog: `$0`.
- Only explicitly checked live modules may call DataForSEO.
- No paid checkbox remains enabled after a request completes or fails.
- A repeated click while refresh is active joins the current operation rather than starting another.
- Provider response size and request-body limits follow existing V2 protections.
- Actual provider costs continue to be recorded in D1 `api_usage`.

## Portability and file boundaries

Create focused modules rather than expanding the large legacy page:

- dashboard data normalizer;
- dashboard D1 storage;
- zero-cost dashboard API;
- guarded refresh API;
- dashboard view renderer;
- refresh review dialog;
- trend rendering;
- tests for each boundary.

All asset and API paths are relative or origin-relative. D1 and KV use Cloudflare bindings. No deployment hostname or secret is stored in source or snapshot exports.

## Error handling

- No data: module-specific empty state with a route to the corresponding analysis tool.
- Stale data: show the stored value and stale timestamp; never erase it while refresh is pending.
- Partial cache failure: return available modules plus a warning list.
- D1 unavailable: structured `503`; no fallback may claim durable freshness.
- Live confirmation missing: structured `409` with zero actual cost and the exact modules requiring confirmation.
- Provider failure: retain previous dashboard module and report that its update failed.
- Cache write failure after a paid response: persist normalized D1 data when possible and warn that the next refresh may charge again.

## Testing and acceptance criteria

1. Opening Overview calls only the zero-cost dashboard endpoint and usage summary.
2. No-data modules show unavailable, not zero.
3. Core cards, trends, top keywords, competitors, opportunities, and risks render only sourced data.
4. Every displayed metric includes scope and freshness.
5. Direct card/table links open the correct existing detailed view.
6. Refresh dialog shows cache/live classification before confirmation.
7. Unconfirmed live modules return `409` and actual cost `$0`.
8. Confirmed refresh executes only selected modules and reports real per-module and total cost.
9. Single-flight and post-lock cache recheck prevent duplicate paid requests.
10. Partial failure preserves successful modules and previous data.
11. Snapshot history produces correct deltas and requires two snapshots for trends.
12. Full existing test suite remains green.
13. Independent review has zero unresolved Critical or Important findings.
14. Preview verification checks zero-cost load, manual dialog, cached refresh, navigation, and unchanged cost totals without authorizing a live request.

## Explicit exclusions

- Revenue prediction
- Automatic refresh on page load
- Content Brief development
- Team collaboration and permissions
- A full clone of every Ahrefs metric
- Fabricated placeholder analytics

