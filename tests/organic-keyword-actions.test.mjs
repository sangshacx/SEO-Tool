import assert from "node:assert/strict";
import test from "node:test";
import { classifyOrganicKeywordAction } from "../src/v2/intelligence/organic-keyword-actions.js";

test("own-site organic actions protect winners and prioritize recoverable visibility", () => {
  assert.equal(classifyOrganicKeywordAction({ position: 2 }, { mode: "own" }).code, "protect");
  assert.equal(classifyOrganicKeywordAction({ position: 8 }, { mode: "own" }).code, "quick_win");
  assert.equal(classifyOrganicKeywordAction({ position: 32 }, { mode: "own" }).code, "improve");
  assert.equal(classifyOrganicKeywordAction({ position: 75 }, { mode: "own" }).code, "monitor");
  assert.equal(classifyOrganicKeywordAction({ position: 8, movement: { is_down: true } }, { mode: "own" }).code, "recover");
  assert.equal(classifyOrganicKeywordAction({ movement: { is_lost: true } }, { mode: "own" }).code, "reclaim");
});

test("competitor mode never emits own-site optimize actions", () => {
  assert.equal(classifyOrganicKeywordAction({ position: 2 }, { mode: "competitor" }).code, "study_winner");
  assert.equal(classifyOrganicKeywordAction({ movement: { is_up: true } }, { mode: "competitor" }).code, "study_gain");
  assert.equal(classifyOrganicKeywordAction({ movement: { is_down: true } }, { mode: "competitor" }).code, "competitor_weakness");
  assert.equal(classifyOrganicKeywordAction({ movement: { is_lost: true } }, { mode: "competitor" }).code, "gap_opportunity");
});
