import assert from "node:assert/strict";
import test from "node:test";

import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import {
  persistAiVisibilityHistorical,
  persistAiVisibilityNewLost,
  readAiVisibilityHistorical,
  readAiVisibilityNewLost,
} from "../src/v2/storage/ai-visibility.js";

test("AI visibility historical metrics persist only for managed sites and upsert monthly values", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1, { domain: "example.com" });

  assert.deepEqual(
    await persistAiVisibilityHistorical({
      db: d1,
      target: "rival.example",
      platform: "google",
      locationCode: 2840,
      languageCode: "en",
      points: [{ period: "2026-08", mentions: 99, ai_search_volume: 999 }],
    }),
    { persisted: false, reason: "unmanaged_site", rows: 0 },
  );

  const first = await persistAiVisibilityHistorical({
    db: d1,
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    providerFetchedAt: "2026-09-19T07:00:00.000Z",
    points: [
      { period: "2026-08", mentions: 10, ai_search_volume: 200 },
      { period: "2026-09", mentions: 15, ai_search_volume: 300 },
    ],
  });
  assert.deepEqual(first, { persisted: true, rows: 2 });

  await persistAiVisibilityHistorical({
    db: d1,
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    providerFetchedAt: "2026-09-19T08:00:00.000Z",
    points: [{ period: "2026-09", mentions: 18, ai_search_volume: 340 }],
  });

  const rows = await readAiVisibilityHistorical(d1, {
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
  });
  assert.deepEqual(rows.map((row) => [row.period, row.mentions, row.ai_search_volume]), [
    ["2026-08", 10, 200],
    ["2026-09", 18, 340],
  ]);
  assert.equal(rows[1].provider_fetched_at, "2026-09-19T08:00:00.000Z");
});

test("AI visibility new/lost storage preserves the net monthly signal used by Decision Intelligence", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1, { domain: "example.com" });

  const result = await persistAiVisibilityNewLost({
    db: d1,
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    providerFetchedAt: "2026-09-19T08:00:00.000Z",
    points: [
      {
        date: "2026-08-01",
        new_mentions: 12,
        lost_mentions: 4,
        new_ai_search_volume: 300,
        lost_ai_search_volume: 80,
      },
      {
        date: "2026-09-01",
        new_mentions: 5,
        lost_mentions: 11,
        new_ai_search_volume: 120,
        lost_ai_search_volume: 260,
      },
    ],
  });
  assert.deepEqual(result, { persisted: true, rows: 2 });

  const rows = await readAiVisibilityNewLost(d1, {
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
  });
  assert.equal(rows[0].net_mentions, 8);
  assert.equal(rows[0].net_ai_search_volume, 220);
  assert.equal(rows[1].net_mentions, -6);
  assert.equal(rows[1].net_ai_search_volume, -140);
});

test("AI visibility history is scoped by platform and market", async () => {
  const { d1 } = await dashboardDatabase();
  await seedProfile(d1, { domain: "example.com" });

  await persistAiVisibilityHistorical({
    db: d1,
    target: "example.com",
    platform: "google",
    locationCode: 2840,
    languageCode: "en",
    points: [{ period: "2026-09", mentions: 8, ai_search_volume: 100 }],
  });
  await persistAiVisibilityHistorical({
    db: d1,
    target: "example.com",
    platform: "chat_gpt",
    locationCode: 2840,
    languageCode: "en",
    points: [{ period: "2026-09", mentions: 3, ai_search_volume: 40 }],
  });

  const google = await readAiVisibilityHistorical(d1, {
    target: "example.com", platform: "google", locationCode: 2840, languageCode: "en",
  });
  const chat = await readAiVisibilityHistorical(d1, {
    target: "example.com", platform: "chat_gpt", locationCode: 2840, languageCode: "en",
  });
  assert.equal(google[0].mentions, 8);
  assert.equal(chat[0].mentions, 3);
});
