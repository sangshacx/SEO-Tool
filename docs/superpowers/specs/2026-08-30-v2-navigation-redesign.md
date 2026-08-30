# SEO Pro V2 Navigation Redesign Specification

## Goal

Turn the current single, vertically stacked SEO Pro V2 page into a personal multi-site dashboard with a persistent left navigation, without deleting or rebuilding existing tools.

## Approved product decisions

- Layout A: dashboard plus persistent left navigation.
- Primary job: inspect a website and compare it with competitors.
- Support switching among multiple managed sites from the first release.
- Preserve every completed feature and its stored data.
- Keep paused or low-priority features, including Content Brief, outside the primary navigation.
- Optimize for one owner; do not add roles, invitations, approvals, or team workflows.
- Keep the application portable to a future custom domain.

## Information architecture

| Navigation item | Existing functions |
|---|---|
| Overview | Active site, quick actions, usage/cost summary, cached-result status |
| Website Data | Backlink Snapshot, Backlink History |
| Competitors | Competitor Snapshot, Keyword Gap, Backlink Comparison |
| Keywords | Keyword Explorer, Keyword Ideas, Content Plan, Content Clusters |
| Backlinks | Batch Analyzer, Referring Domains, Backlink Details, Anchor Text |
| Opportunities | Backlink Gap, relevance/outreach scoring, Saved Link Prospects |
| More Tools | Paused Content Brief and secondary utilities |
| Site Management | Add, rename, select, and remove locally stored site profiles |
| Cost & Settings | DataForSEO Cost Guard explanation and D1 usage summary |

## Phase 1 architecture

Phase 1 is a low-risk presentation refactor. The existing API routes, D1 schema, KV keys, provider modules, form IDs, and event handlers remain unchanged. A lightweight hash router shows one feature group at a time while all existing DOM nodes remain available to the current scripts.

The page shell and routing logic are extracted into focused static assets:

- `public/v2-shell.css`: application shell, sidebar, dashboard, mobile navigation, and view visibility.
- `public/v2-shell.js`: view registry, hash routing, navigation state, mobile drawer, and site-profile persistence.
- `public/v2.html`: existing tool markup and behavior, annotated with stable `data-v2-view` group boundaries.

Routes use URL fragments such as `v2#overview` and relative API URLs. They therefore work on the current Pages subdomain and after binding any custom domain, with no host-name rewrite.

## Site profiles

Phase 1 stores a small list of managed root domains in browser `localStorage`. A profile contains only:

```json
{"domain":"great-ocean-waterproof.com","label":"Great Ocean Waterproof"}
```

Changing the active site fills compatible domain fields but does not automatically submit a form or trigger a paid request. Existing Cost Guard behavior remains unchanged. D1-backed cross-device project storage is a later, separately reviewed phase.

## Overview behavior

The Overview is an orientation page rather than a new paid analytics endpoint. It displays:

- the active site;
- shortcuts to Website Data, Competitors, Keywords, Backlinks, and Opportunities;
- the existing D1 usage summary;
- cached or already-known summaries only when present in the browser session;
- clear empty states when analysis has not yet been run.

Opening Overview must never call DataForSEO.

## Compatibility and migration constraints

- No absolute deployment host names in HTML, JavaScript, API requests, redirects, or exports.
- No new production-only configuration.
- Secrets remain in Cloudflare environment bindings.
- D1 remains authoritative for durable workflow/cost data; KV remains disposable cache.
- Existing Preview URL and `/v2` entry remain valid.
- Browser back/forward navigation must switch views.
- Direct links to a valid fragment must open the matching view; invalid fragments fall back to Overview.
- Mobile navigation collapses without hiding access to any feature group.
- Existing API contracts, D1 migrations, and paid-request authorization are unchanged.

## Acceptance criteria

1. The initial screen is Overview, not Keyword Explorer.
2. Only the selected feature group is visible.
3. Every completed tool is reachable from one primary navigation item.
4. Content Brief is not visible in primary navigation.
5. Selecting a site never starts a paid request.
6. Existing tool IDs remain unique and existing automated tests still pass.
7. A navigation-focused test verifies route mapping, fallback, back/forward support, and safe site switching.
8. Static assets and API calls use relative URLs.
9. Preview verification confirms desktop navigation, mobile navigation, direct hashes, and unchanged Cost Guard defaults.

## Deferred phases

- Split each feature group into independently loaded page modules after the shell is stable.
- Persist site profiles in D1 for cross-device access.
- Create a consolidated cached-data dashboard endpoint.
- Restore or further develop Content Brief only after explicit user approval.

