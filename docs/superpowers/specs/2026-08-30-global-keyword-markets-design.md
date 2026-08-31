# Global Keyword Markets Design

## Goal

Replace SEO Pro V2's hard-coded United States/English keyword context with a searchable, reusable country-and-language market selector shared by every keyword and competitor workflow.

## Scope

This subsystem covers:

- a searchable catalog of all DataForSEO-supported keyword locations and languages;
- pinned common markets for quick access;
- persistent per-site default country and language settings;
- one shared market context for Keyword Explorer, Keyword Ideas, SERP Weakness, SEO Opportunity, Competitor Snapshot, and Keyword Gap;
- safe migration from browser-only site profiles to D1-backed site profiles;
- JSON export of site configuration.

It does not change backlink APIs, Content Brief, scoring formulas, or provider pricing behavior.

## User experience

The application header contains a market selector next to the active site selector:

```text
Site: Great Ocean Waterproof
Country: United States
Language: English
```

Country and language are separately searchable. Common choices are pinned before the complete catalog:

- United States
- United Kingdom
- Canada
- Australia
- Saudi Arabia
- United Arab Emirates
- Singapore
- India

Changing the site loads that site's saved defaults. Changing the country or language updates only the active UI context and compatible fields; it never submits a form or calls DataForSEO.

## Catalog

The supported-location and supported-language catalog lives in an isolated module rather than `public/v2.html`. The catalog must contain stable machine identifiers:

```json
{
  "location_code": 2840,
  "country_iso_code": "US",
  "location_name": "United States",
  "location_type": "Country"
}
```

```json
{
  "language_code": "en",
  "language_name": "English"
}
```

The initial implementation may ship a generated static catalog checked into the repository. Catalog generation must be isolated so it can later be refreshed from official provider metadata without changing UI or API contracts. The browser must not call a paid provider endpoint merely to populate selectors.

Only valid provider-supported combinations may be saved. If a previously saved combination is no longer supported, the UI keeps the site's domain but resets the market to United States/English and displays a non-blocking warning.

## D1 site profiles

Create a `site_profiles` table with:

- `id`
- `domain` (unique normalized root domain)
- `label`
- `location_code`
- `location_name`
- `country_iso_code`
- `language_code`
- `language_name`
- `include_subdomains`
- `competitors_json` (maximum five normalized root domains)
- `created_at`
- `updated_at`

The API supports:

- list profiles;
- create or update a profile by normalized domain;
- delete a profile while preventing deletion of the final remaining profile;
- export all profiles as versioned JSON.

Every mutation validates request size, root domains, catalog identifiers, competitor count, and duplicate competitors. Site-profile operations have `actual_cost_usd: 0` and never call DataForSEO.

## Browser migration

On first load after deployment:

1. Read D1 profiles.
2. If D1 is empty, read `seo-pro-v2.site-profiles.v1` from local storage.
3. Normalize and import valid local profiles using United States/English as the default market when local fields are absent.
4. Mark the migration complete in local storage only after the D1 write succeeds.
5. Continue to use the D1 response as authoritative.

If D1 is temporarily unavailable, the UI may use valid local profiles for the session and must show that changes are not synchronized. It must not silently overwrite D1 later without re-reading current server state.

## Shared market context

Create one market-context module that exposes:

- active site domain;
- location code and display name;
- language code and display name;
- subscription for UI controls that must update when context changes;
- a helper for building API request fields.

All supported keyword and competitor forms consume this context. The existing backend cache keys already include `location_code` and `language_code`; tests must prove this remains true for every affected endpoint.

Hard-coded `language_code: "en"` values are removed from browser request construction. Backend defaults remain United States/English only for backward compatibility with older clients.

## Portability

- Static catalogs and UI assets use relative URLs.
- D1 access uses Cloudflare bindings, never a public account REST URL.
- No Pages hostname is embedded in source.
- Site profiles can be exported as versioned JSON and imported into another deployment after its migrations run.
- Secrets remain environment bindings and are excluded from exports.

## Error handling

- Invalid country/language: show a field-level error and keep the last valid selection.
- D1 read failure: use local fallback for the session and show synchronization warning.
- D1 write failure: preserve the unsaved form values, do not claim success, and provide retry.
- Unsupported saved market: reset to the documented default and show a warning.
- Duplicate site: update the existing profile rather than create a second profile.

## Testing and acceptance criteria

1. Country and language selectors are searchable and include the complete checked-in catalog.
2. Common markets are pinned without duplicating catalog entries.
3. Each site persists its own market and up to five competitors in D1.
4. Switching site or market causes no network request to a paid provider endpoint.
5. All six affected workflows send the active `location_code` and `language_code`.
6. Cache keys distinguish different country/language combinations.
7. Browser-profile migration is idempotent and never overwrites non-empty D1 state.
8. Profile import/export round-trips versioned JSON without secrets.
9. Existing Cost Guard defaults and all current tests continue to pass.
10. Preview verification covers two different site markets without issuing a live DataForSEO request.

