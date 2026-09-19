import assert from "node:assert/strict";
import test from "node:test";

import { classifyOrganicPageAction } from "../src/v2/intelligence/organic-page-actions.js";

test("own-site page actions distinguish risk, growth, winners and improvement candidates", () => {
  assert.equal(classifyOrganicPageAction({organic_keywords:20,changes:{lost:4},positions:{top_10:5,top_20:10}},{mode:"own"}).code,"reclaim");
  assert.equal(classifyOrganicPageAction({organic_keywords:20,changes:{up:2,down:6,lost:0},positions:{top_10:5,top_20:10}},{mode:"own"}).code,"at_risk");
  assert.equal(classifyOrganicPageAction({organic_keywords:20,changes:{up:6,down:1,lost:0},positions:{top_10:5,top_20:10}},{mode:"own"}).code,"growing");
  assert.equal(classifyOrganicPageAction({organic_keywords:20,changes:{up:1,down:1,lost:0},positions:{top_10:12,top_20:14}},{mode:"own"}).code,"protect");
  assert.equal(classifyOrganicPageAction({organic_keywords:20,changes:{up:1,down:1,lost:0},positions:{top_10:2,top_20:8}},{mode:"own"}).code,"improve");
});

test("competitor page actions never emit own-site repair language", () => {
  assert.equal(classifyOrganicPageAction({organic_keywords:20,changes:{lost:4},positions:{}},{mode:"competitor"}).code,"competitor_weakness");
  assert.equal(classifyOrganicPageAction({organic_keywords:20,changes:{up:6,down:1,lost:0},positions:{}},{mode:"competitor"}).code,"study_gain");
  assert.equal(classifyOrganicPageAction({organic_keywords:20,changes:{up:1,down:1,lost:0},positions:{top_10:10}},{mode:"competitor"}).code,"study_winner");
});
