import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_AUTHORIZATION_ENDPOINT, GOOGLE_REVOKE_ENDPOINT, GOOGLE_TOKEN_ENDPOINT, GSC_READONLY_SCOPE,
  buildGoogleAuthorizationUrl, exchangeGoogleAuthorizationCode, refreshGoogleAccessToken, revokeGoogleToken,
} from "../src/v2/providers/google-oauth.js";

test("Google OAuth authorization URL is readonly, offline and state-protected", () => {
  const location = buildGoogleAuthorizationUrl({
    clientId:"client-id", redirectUri:"https://preview.example/api/v2/gsc/connect/callback", state:"abc123", promptConsent:true,
  });
  const url = new URL(location);
  assert.equal(url.origin + url.pathname, GOOGLE_AUTHORIZATION_ENDPOINT);
  assert.equal(url.searchParams.get("scope"), GSC_READONLY_SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "abc123");
});

test("Google OAuth exchanges codes and refresh tokens with form-encoded server requests", async (context) => {
  const originalFetch=globalThis.fetch; context.after(()=>{globalThis.fetch=originalFetch;});
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify({access_token:"access",refresh_token:calls.length===1?"refresh":undefined,expires_in:3600,scope:GSC_READONLY_SCOPE,token_type:"Bearer"}),{headers:{"content-type":"application/json"}});
  };
  const exchanged=await exchangeGoogleAuthorizationCode({clientId:"client",clientSecret:"secret",code:"code",redirectUri:"https://preview.example/callback"});
  assert.equal(exchanged.refresh_token,"refresh");
  const first=new URLSearchParams(calls[0].options.body);
  assert.equal(calls[0].url,GOOGLE_TOKEN_ENDPOINT);
  assert.equal(first.get("grant_type"),"authorization_code");
  assert.equal(first.get("code"),"code");
  const refreshed=await refreshGoogleAccessToken({clientId:"client",clientSecret:"secret",refreshToken:"refresh"});
  assert.equal(refreshed.access_token,"access");
  const second=new URLSearchParams(calls[1].options.body);
  assert.equal(second.get("grant_type"),"refresh_token");
  assert.equal(second.get("refresh_token"),"refresh");
});

test("Google token revocation uses the revoke endpoint", async (context) => {
  const originalFetch=globalThis.fetch; context.after(()=>{globalThis.fetch=originalFetch;});
  let captured;
  globalThis.fetch=async(url,options)=>{captured={url,options};return new Response(null,{status:200});};
  await revokeGoogleToken("refresh-token");
  assert.equal(captured.url,GOOGLE_REVOKE_ENDPOINT);
  assert.equal(new URLSearchParams(captured.options.body).get("token"),"refresh-token");
});
