import assert from "node:assert/strict";
import test from "node:test";
import { gscPropertiesForDomain, createGscSettingsWorkspace } from "../public/v2-gsc-settings.js";

test("GSC settings only offers verified properties matching the active managed domain",()=>{
  const rows=gscPropertiesForDomain([
    {property:"sc-domain:example.com",domain:"example.com",verified:true},
    {property:"https://www.example.com/",domain:"example.com",verified:true},
    {property:"sc-domain:rival.example",domain:"rival.example",verified:true},
    {property:"sc-domain:example.com-unverified",domain:"example.com",verified:false},
  ],"www.example.com");
  assert.deepEqual(rows.map((row)=>row.property),["sc-domain:example.com","https://www.example.com/"]);
});

test("GSC settings communicates readonly scope and encrypted token storage",()=>{
  const fake={createElement(){return {className:"",dataset:{},innerHTML:""};}};
  const section=createGscSettingsWorkspace(fake);
  assert.match(section.innerHTML,/GOOGLE SEARCH CONSOLE · READ ONLY/);
  assert.match(section.innerHTML,/webmasters\.readonly/);
  assert.match(section.innerHTML,/Refresh token encrypted in D1/);
  assert.match(section.innerHTML,/Map to Current Site/);
});


test("GSC settings exposes explicit Generative AI searchAppearance discovery without an undocumented hard-coded filter",()=>{
  const fake={createElement(){return {className:"",dataset:{},innerHTML:""};}};
  const section=createGscSettingsWorkspace(fake);
  assert.match(section.innerHTML,/Generative AI API Discovery/);
  assert.match(section.innerHTML,/Discover Search Appearances · \$0/);
  assert.match(section.innerHTML,/Use Selected Value · \$0/);
  assert.match(section.innerHTML,/raw value/);
  assert.match(section.innerHTML,/不会硬编码未公开的 AI filter/);
  assert.match(section.innerHTML,/data-v2-gsc-ai-appearance/);
  assert.doesNotMatch(section.innerHTML,/AI_OVERVIEW/);
  assert.doesNotMatch(section.innerHTML,/AI_MODE/);
});
