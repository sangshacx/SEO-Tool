# DataForSEO market catalog provenance

`public/data/v2-markets.json` is the reviewed, canonical runtime catalog derived from DataForSEO Labs' locations-and-languages metadata (`/v3/dataforseo_labs/locations_and_languages`) on 2026-08-06. It keeps only the location and language fields needed to validate supported keyword markets; it contains no credentials, keyword metrics, query results, or customer data.

`scripts/generate-v2-market-catalog.mjs` validates that catalog and deterministically generates `catalog.js`. Refreshing the catalog requires acquiring current official metadata, reviewing the provider response/schema and distribution terms, replacing the normalized public catalog, updating its version, regenerating the module, and running the catalog checks. Raw provider exports are intentionally not committed.

DataForSEO remains the source and owner of its metadata. Before public or commercial redistribution, verify the current DataForSEO terms and obtain any permission required. The normalized runtime catalog documents application compatibility; it is not a legal conclusion about licensing.

## Deployment security prerequisite

The site-profile API must be deployed behind Cloudflare Access. The Worker checks for the Access-injected JWT assertion and rejects cross-origin browser requests, but it does not independently verify the JWT signature. A caller could forge that header when reaching an unprotected origin. Therefore Access must prevent direct anonymous origin access, and the Preview workflow must verify that anonymous requests are rejected at the edge.
