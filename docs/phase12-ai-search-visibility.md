# Phase 12 — AI Search Visibility Research & Implementation Spec

Status: research-approved, implementation not started
Branch: seo-pro-v2
Updated: 2026-09-19

## Product goal

Add AI-search visibility to SEO Pro V2 without turning the product into a clone of Ahrefs Brand Radar or Semrush AI Visibility.

The differentiator remains:

**evidence -> change -> opportunity -> next action -> workflow -> observed outcome**

AI visibility must feed the existing Decision Intelligence workflow instead of becoming an isolated dashboard.

## Confirmed external data sources

### 1. DataForSEO LLM Mentions API

Primary broad-visibility source.

Use new endpoint names only:

- `/v3/ai_optimization/llm_mentions/target_metrics/live`
- `/v3/ai_optimization/llm_mentions/multi_target_metrics/live`
- `/v3/ai_optimization/llm_mentions/top_mentioned_pages/live`
- `/v3/ai_optimization/llm_mentions/search_mentions/live`
- `/v3/ai_optimization/llm_mentions/historical/live`
- `/v3/ai_optimization/llm_mentions/timeseries_new_lost/live`

Do not build new integrations on legacy aggregated_metrics, cross_aggregated_metrics, top_pages, top_domains or search endpoints.

Current supported LLM Mentions platforms:
- Google AI Overview
- ChatGPT

Important current restriction:
- ChatGPT mention data is currently US + English only.
- Google supports location/language market parameters.

Historical LLM Mentions data starts from 2025-08-01.

### 2. DataForSEO LLM Responses API

Use only for explicit custom-prompt tracking.

Supported platforms currently include:
- ChatGPT
- Claude
- Gemini
- Perplexity

This is a different product capability from LLM Mentions:
- LLM Mentions = broad indexed discovery/benchmarking.
- LLM Responses = controlled prompt-level checks.

Do not run prompt checks automatically on page load.

### 3. Google Search Console

Google launched a dedicated Generative AI performance report and rolled it out worldwide by 2026-08-31.

It reports first-party visibility in Google generative AI features including:
- AI Overviews
- AI Mode

Useful dimensions include:
- page
- country
- device
- date

Current Search Analytics API documentation still exposes the standard API and dynamic `searchAppearance` values rather than documenting a dedicated generative-AI API endpoint/value.

Therefore:
- do not hard-code an undocumented Generative AI searchAppearance expression;
- first add support for querying/grouping `searchAppearance`;
- discover available values per connected property at runtime;
- only enable a GSC Generative AI provider when the property exposes an identifiable supported value.

## Phase 12 architecture

### Phase 12A — AI Visibility Overview

Goal: domain-level visibility snapshot for own site and competitors.

Provider calls:
1. Target Metrics Lite/full for a single target.
2. Multi-Target Metrics for competitor comparison.
3. Top Mentioned Pages Lite/full for cited/mentioned page discovery.

UI:
- AI Mentions
- AI Search Volume
- Cited / Mentioned Pages
- Platform split
- Own-site vs competitors
- Source freshness
- Explicit provider/source label

Rules:
- cached-first
- manual refresh
- Cost Guard before paid provider request
- no automatic paid calls on navigation

### Phase 12B — AI Mention Explorer

Goal: inspect why a brand/page is appearing.

Provider:
- Search Mentions

Show:
- question
- answer excerpt
- target mention
- cited sources
- retrieved/search-result sources where available
- AI search volume
- platform
- location/language

This view should support handoff to:
- Keyword Explorer
- Competitor Research
- Backlink / Citation Opportunity
- Opportunity Center

### Phase 12C — AI Visibility History

Providers:
- Historical
- Timeseries New/Lost

Store normalized monthly snapshots in D1.

Core signals:
- mentions delta
- AI search-volume delta
- new mentions
- lost mentions
- pages gaining/lossing citation visibility where available

Feed meaningful losses/gains into Decision Intelligence.

### Phase 12D — Custom Prompt Tracker

Reuse Saved Keywords and Topic Clusters as prompt seeds, but do not overload the saved_keywords schema with response history.

New entities should be separate:
- ai_tracked_prompts
- ai_prompt_runs
- ai_prompt_mentions
- ai_prompt_citations

A prompt can optionally reference:
- saved_keyword_id
- topic_cluster_id

Tracking cadence should initially be manual/on-demand.
Scheduled tracking is a later phase and must obey spend limits.

### Phase 12E — GSC Generative AI

First step:
- extend GSC provider dimension validation to allow `searchAppearance`;
- add a zero-cost capability discovery query grouped by `searchAppearance`;
- persist discovered supported appearances per property.

Only after capability discovery proves an AI-specific appearance value should we sync/store its data.

Do not infer AI clicks/impressions by subtracting normal Search data.

## Suggested D1 model

### ai_visibility_snapshots
- id
- site_profile_id
- platform
- location_code
- language_code
- mentions
- ai_search_volume
- source
- provider_updated_at
- captured_at

Unique/dedupe key should use site + platform + market + captured period/source.

### ai_visibility_pages
- snapshot_id
- page_url
- mentions
- ai_search_volume
- citation_count if explicitly available
- source_domains_json (bounded/normalized)

### ai_visibility_events
Normalized new/lost history for Decision Intelligence:
- site_profile_id
- platform
- period
- event_type
- mentions_delta
- ai_search_volume_delta
- evidence_json

### ai_tracked_prompts
Separate from saved_keywords but may reference keyword/cluster IDs:
- site_profile_id
- prompt
- platform
- market
- active
- saved_keyword_id nullable
- topic_cluster_id nullable

## Decision Intelligence integration

New possible workstreams:
- ai_visibility_recovery
- ai_citation_growth
- ai_competitor_gap
- ai_prompt_tracking

Example decisions:

1. Lost AI mentions
Evidence: meaningful lost_mentions + prior visibility
Action: Review cited competitor/source pages and refresh own relevant page.

2. Competitor AI citation gap
Evidence: competitor cited/mentioned for a topic where own domain has organic relevance
Action: Analyze cited pages/sources and improve topic coverage or digital PR target list.

3. AI-visible page with weak organic performance
Evidence: AI mentions/citations + low traditional search performance
Action: Protect AI visibility while improving organic discoverability.

4. Strong organic page with no AI visibility
Evidence: strong GSC/DataForSEO organic signals + competitor AI mentions
Action: AI citation/coverage review.

All AI-derived recommendations must display source and freshness. They must not imply causal certainty.

## Cost policy

1. No paid AI provider request on initial page load.
2. Read KV/D1 first.
3. Manual refresh shows estimated/known billing behavior and requires the existing Cost Guard flow.
4. Cache provider results by:
   - target
   - platform
   - location
   - language
   - endpoint family
   - request options/version
5. LLM Responses custom-prompt checks must be separately budgeted from LLM Mentions.
6. Prefer Lite endpoints where their fields satisfy the UI.
7. Broad historical refresh should not run daily unless the user explicitly enables scheduled tracking later.

## Competitive benchmark conclusions

Ahrefs and Semrush now separate two AI-visibility modes:

1. large indexed discovery databases;
2. custom prompt tracking.

SEO Pro V2 should mirror the conceptual separation, not their scale.

We should not attempt to recreate hundreds of millions of prompts.
Use DataForSEO's indexed LLM Mentions for breadth and controlled LLM Responses for a small set of business-critical prompts.

## Implementation order

1. Phase 12 provider contracts + normalization tests.
2. Target Metrics + Multi-Target Metrics provider.
3. AI Visibility cache/API contract.
4. Overview UI.
5. Top Mentioned Pages + citation/source explorer.
6. D1 history schema + historical/new-lost endpoints.
7. Decision Intelligence integration.
8. Custom Prompt Tracker.
9. GSC searchAppearance capability discovery.
10. GSC Generative AI sync only when an official/discoverable API appearance value is available.

## Non-goals for first release

- no synthetic proprietary AI Visibility 0-100 score;
- no automatic daily paid tracking;
- no unsupported claims that mentions equal traffic;
- no imitation of Ahrefs/Semrush database scale;
- no full Content Brief integration;
- no hard-coded undocumented Search Console Generative AI filter value.
