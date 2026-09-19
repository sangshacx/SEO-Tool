import assert from "node:assert/strict";
import test from "node:test";
import { createGscOauthState, consumeGscOauthState } from "../src/v2/gsc/oauth-state.js";
import { memoryCache } from "./dashboard-test-helpers.mjs";

test("GSC OAuth state is random, ten-minute and one-time", async () => {
  const cache=memoryCache();
  const created=await createGscOauthState(cache,{redirectUri:"https://preview.example/api/v2/gsc/connect/callback",now:"2026-09-19T02:00:00.000Z"});
  assert.match(created.state,/^[a-f0-9]{64}$/);
  assert.equal(created.expires_in,600);
  assert.equal(cache.writes[0].options.expirationTtl,600);
  const first=await consumeGscOauthState(cache,created.state);
  assert.equal(first.redirect_uri,"https://preview.example/api/v2/gsc/connect/callback");
  assert.equal(await consumeGscOauthState(cache,created.state),null);
});
