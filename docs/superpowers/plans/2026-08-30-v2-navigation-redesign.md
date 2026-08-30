# SEO Pro V2 Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single scrolling SEO Pro V2 interface with an Overview-first, multi-site shell and grouped navigation while preserving all existing tools and data.

**Architecture:** Add a client-side shell around the existing DOM and use hash-based view routing so current event handlers continue to find their elements. Extract new shell styling and behavior into focused static assets; migrate tools by adding stable view-group annotations rather than rewriting their APIs or business logic.

**Tech Stack:** Cloudflare Pages static HTML, vanilla JavaScript ES modules, CSS, Cloudflare Pages Functions, D1, KV, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-08-30-v2-navigation-redesign.md`

## Global Constraints

- Keep all existing API contracts, D1 migrations, KV keys, form IDs, and Cost Guard behavior unchanged.
- Do not modify `main` or Production; deploy only `seo-pro-v2` Preview.
- Do not call DataForSEO during automated or Preview verification.
- Use only relative static-asset and API URLs.
- Preserve Content Brief code and data but omit it from primary navigation.
- Site selection must never submit a form or trigger a paid request.

---

### Task 1: Navigation registry and routing behavior

**Files:**
- Create: `public/v2-shell.js`
- Create: `tests/v2-shell-navigation.test.mjs`

**Interfaces:**
- Produces: `V2_VIEWS`, `normalizeView(value)`, `readHashView(location)`, `writeHashView(view)`, and `activateView(view, root)`.
- Consumes: elements with `[data-v2-view]`, `[data-v2-nav]`, and `[data-v2-view-title]`.

- [ ] **Step 1: Write failing tests for the complete view registry, invalid-fragment fallback, active navigation state, and one-visible-view behavior.**
- [ ] **Step 2: Run `node --test tests/v2-shell-navigation.test.mjs` and confirm failure because `public/v2-shell.js` does not exist.**
- [ ] **Step 3: Implement the registry and pure routing helpers, then bind `DOMContentLoaded` and `hashchange` without submitting forms.**
- [ ] **Step 4: Run `node --test tests/v2-shell-navigation.test.mjs` and confirm all navigation tests pass.**
- [ ] **Step 5: Commit `public/v2-shell.js` and its test as `feat: add V2 view router`.**

### Task 2: Personal multi-site profiles

**Files:**
- Modify: `public/v2-shell.js`
- Create: `tests/v2-site-profiles.test.mjs`

**Interfaces:**
- Produces: `normalizeSiteProfile(input)`, `loadSiteProfiles(storage)`, `saveSiteProfiles(storage, profiles)`, and `applyActiveDomain(root, domain)`.
- Consumes: `localStorage` key `seo-pro-v2.site-profiles.v1` and fields explicitly marked `[data-v2-domain-field]`.

- [ ] **Step 1: Write failing tests for root-domain normalization, malformed storage fallback, deduplication, and non-submitting field updates.**
- [ ] **Step 2: Run `node --test tests/v2-site-profiles.test.mjs` and verify the missing exports fail.**
- [ ] **Step 3: Implement profile serialization and safe field filling; dispatch `input` and `change` only, never `submit` or `click`.**
- [ ] **Step 4: Run the site-profile and navigation tests together and confirm they pass.**
- [ ] **Step 5: Commit the profile behavior and tests as `feat: add personal site switcher`.**

### Task 3: Application shell and responsive navigation

**Files:**
- Create: `public/v2-shell.css`
- Modify: `public/v2.html`
- Create: `tests/v2-shell-ui.test.mjs`

**Interfaces:**
- Consumes: view IDs from `V2_VIEWS` and attributes defined in Task 1.
- Produces: sidebar, site switcher, mobile menu button, Overview view, and grouped tool containers.

- [ ] **Step 1: Write failing markup tests for all nine navigation entries, Overview as default, Content Brief exclusion, stylesheet/script references, and unique IDs.**
- [ ] **Step 2: Run `node --test tests/v2-shell-ui.test.mjs` and confirm the new shell assertions fail against the current page.**
- [ ] **Step 3: Add the semantic shell and annotate existing sections with their mapped `data-v2-view` values; do not rename existing control IDs.**
- [ ] **Step 4: Add responsive CSS for persistent desktop sidebar and accessible mobile drawer using existing design tokens where possible.**
- [ ] **Step 5: Run the shell UI, navigation, and site-profile tests and confirm they pass.**
- [ ] **Step 6: Commit shell markup and styling as `feat: reorganize V2 interface`.**

### Task 4: Overview and usage summary integration

**Files:**
- Modify: `public/v2.html`
- Modify: `public/v2-shell.js`
- Modify: `tests/v2-shell-ui.test.mjs`

**Interfaces:**
- Consumes: the existing `/api/v2/usage/summary` request already made by the page and current session results.
- Produces: Overview quick actions and zero-cost empty states; does not introduce an API endpoint.

- [ ] **Step 1: Add failing tests that Overview contains five tool-group shortcuts, usage summary placeholders, and no paid-request control.**
- [ ] **Step 2: Run `node --test tests/v2-shell-ui.test.mjs` and verify the Overview assertions fail.**
- [ ] **Step 3: Add the Overview markup and connect shortcuts to hash routes; reuse the existing usage summary values rather than issuing a second request.**
- [ ] **Step 4: Run shell tests and verify Overview switching causes no form submission and no DataForSEO URL access.**
- [ ] **Step 5: Commit as `feat: add zero-cost V2 overview`.**

### Task 5: Full regression and portability checks

**Files:**
- Create: `tests/v2-portability.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Validates: all public HTML/JS uses relative application URLs and current tests remain compatible.

- [ ] **Step 1: Write a portability test that rejects the Pages hostname, localhost, and absolute same-app API/static URLs in `public/`.**
- [ ] **Step 2: Run the new test and correct only real portability violations in files changed by this feature.**
- [ ] **Step 3: Document the navigation map, hash routes, local site-profile storage, and future custom-domain binding steps in `README.md`.**
- [ ] **Step 4: Run `node --test tests/*.test.mjs` and confirm the complete suite passes.**
- [ ] **Step 5: Compile every inline and external browser script and verify all HTML IDs are unique.**
- [ ] **Step 6: Commit tests and documentation as `test: verify V2 shell portability`.**

### Task 6: Review, Preview deployment, and zero-cost verification

**Files:**
- Modify only if review identifies a confirmed Critical or Important defect.

**Interfaces:**
- Produces: reviewed commit on `seo-pro-v2` and verified Cloudflare Preview.

- [ ] **Step 1: Review the complete branch diff for unreachable tools, hash-routing regressions, duplicate IDs, mobile access, paid-request triggers, and absolute host names.**
- [ ] **Step 2: For each confirmed Critical or Important finding, add a failing regression test, implement the smallest correction, and rerun the targeted suite.**
- [ ] **Step 3: Fetch remote state, verify no conflicting `seo-pro-v2` changes, and push the reviewed commits without modifying `main`.**
- [ ] **Step 4: Wait for Cloudflare Preview deployment; no D1 migration is expected because this phase changes no schema.**
- [ ] **Step 5: Verify Overview default, all navigation routes, direct hash loading, mobile menu, site switching, Cost Guard defaults, and unchanged D1 usage totals without allowing a paid request.**
- [ ] **Step 6: Report final commit SHA, full test count, deployment result, migration status `not required`, and Preview verification evidence.**

