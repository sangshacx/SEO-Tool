import assert from "node:assert/strict";
import test from "node:test";
import { dashboardDatabase, seedProfile } from "./dashboard-test-helpers.mjs";
import { deleteGscConnection, deleteGscMapping, listGscMappings, readGscConnection, saveGscConnection, saveGscMapping } from "../src/v2/storage/gsc-connections.js";

test("GSC storage keeps one encrypted connection and maps verified properties to managed sites", async () => {
  const { d1 }=await dashboardDatabase();
  await seedProfile(d1,{domain:"example.com"});
  await saveGscConnection(d1,{ciphertext:"ciphertext-only",iv:"iv-only",version:1,scope:"readonly",tokenType:"Bearer",connectedAt:"2026-09-19T02:00:00.000Z"});
  const connection=await readGscConnection(d1);
  assert.equal(connection.refresh_token_ciphertext,"ciphertext-only");
  assert.equal("refresh_token" in connection,false);
  const mapping=await saveGscMapping(d1,{siteDomain:"example.com",property:"sc-domain:example.com",propertyType:"domain",permissionLevel:"siteOwner",mappedAt:"2026-09-19T02:10:00.000Z"});
  assert.equal(mapping.site_domain,"example.com");
  assert.equal((await listGscMappings(d1))[0].property,"sc-domain:example.com");
  assert.equal((await deleteGscMapping(d1,"example.com")).deleted,true);
  assert.equal((await listGscMappings(d1)).length,0);
  await saveGscMapping(d1,{siteDomain:"example.com",property:"sc-domain:example.com",propertyType:"domain",permissionLevel:"siteOwner"});
  await deleteGscConnection(d1);
  assert.equal(await readGscConnection(d1),null);
  assert.equal((await listGscMappings(d1)).length,0);
});
