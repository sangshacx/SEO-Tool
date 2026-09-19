import {
  LlmPromptProviderError,
  normalizeLlmModelName,
  normalizeLlmPrompt,
  normalizeLlmPromptPlatform,
} from "../../../../src/v2/providers/dataforseo-llm-responses.js";
import { normalizeAiVisibilityDomain } from "../../../../src/v2/providers/dataforseo-ai-visibility.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import {
  listAiPromptObservations,
  listAiPromptTrackers,
  updateAiPromptTrackerStatus,
  upsertAiPromptTracker,
} from "../../../../src/v2/storage/ai-prompt-tracker.js";

const ALLOW="GET, POST, OPTIONS";
const MAX_BODY_BYTES=32*1024;
const JSON_HEADERS={
  "Content-Type":"application/json; charset=UTF-8",
  "Cache-Control":"no-store",
};

function json(body,status=200,headers={}){
  return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});
}

function denied(request){
  if(!request?.headers?.get("cf-access-jwt-assertion")?.trim()){
    return json({ok:false,error:{code:"ACCESS_AUTHENTICATION_REQUIRED",message:"Cloudflare Access authentication is required."}},401);
  }
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin){
    return json({ok:false,error:{code:"CROSS_ORIGIN_FORBIDDEN",message:"Cross-origin Prompt Tracker access is forbidden."}},403);
  }
  return null;
}

async function readBody(request){
  const length=request.headers.get("content-length");
  if(length&&/^\d+$/.test(length)&&Number(length)>MAX_BODY_BYTES){
    const error=new Error("Request body must be 32 KB or smaller.");
    error.code="PAYLOAD_TOO_LARGE";
    error.httpStatus=413;
    throw error;
  }
  const text=await request.text();
  if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES){
    const error=new Error("Request body must be 32 KB or smaller.");
    error.code="PAYLOAD_TOO_LARGE";
    error.httpStatus=413;
    throw error;
  }
  let body;
  try{body=JSON.parse(text);}
  catch{
    const error=new Error("Request body must be valid JSON.");
    error.code="INVALID_JSON";
    error.httpStatus=400;
    throw error;
  }
  if(!body||typeof body!=="object"||Array.isArray(body)){
    const error=new Error("Request body must be a JSON object.");
    error.code="INVALID_BODY";
    error.httpStatus=400;
    throw error;
  }
  return body;
}

function normalizedScope(input={}){
  const target=normalizeAiVisibilityDomain(input?.target??input?.domain);
  if(!target){
    const error=new Error("Enter a valid saved root domain.");
    error.code="VALIDATION_ERROR";
    error.httpStatus=400;
    throw error;
  }
  let locationCode;
  let languageCode;
  try{
    ({locationCode,languageCode}=normalizeMarketRequest(input));
  }catch{
    const error=new Error("Select a supported country and language combination.");
    error.code="VALIDATION_ERROR";
    error.httpStatus=400;
    throw error;
  }
  return{target,locationCode,languageCode};
}

function mappedError(error){
  const provider=error instanceof LlmPromptProviderError;
  const status=provider?error.httpStatus:Number(error?.httpStatus)||500;
  const code=provider?error.code:error?.code??"AI_PROMPT_TRACKER_FAILED";
  if([400,404,409,413].includes(status)){
    return json({ok:false,error:{code,message:error.message}},status);
  }
  console.error(JSON.stringify({
    message:"AI Prompt Tracker API failed",
    code,
    error:error instanceof Error?error.message:String(error),
  }));
  return json({ok:false,error:{code:"AI_PROMPT_TRACKER_FAILED",message:"Prompt Tracker could not be processed."}},500);
}

export async function onRequestGet({request,env}){
  const access=denied(request);
  if(access)return access;
  if(!env?.DB)return json({ok:false,error:{code:"BINDING_MISSING",message:"Preview DB binding is not configured."}},503);

  const url=new URL(request.url);
  let scope;
  try{
    scope=normalizedScope({
      target:url.searchParams.get("target"),
      location_code:url.searchParams.get("location_code"),
      language_code:url.searchParams.get("language_code"),
    });
  }catch(error){
    return mappedError(error);
  }

  try{
    const trackerId=url.searchParams.get("tracker_id");
    if(trackerId){
      return json({
        ok:true,
        data:{
          target:scope.target,
          tracker_id:Number(trackerId),
          observations:await listAiPromptObservations(env.DB,{
            siteDomain:scope.target,
            trackerId,
            limit:Number(url.searchParams.get("limit")??20),
          }),
        },
        meta:{actual_cost_usd:0,provider_requests:0,source:"d1"},
      });
    }

    return json({
      ok:true,
      data:{
        target:scope.target,
        location_code:scope.locationCode,
        language_code:scope.languageCode,
        items:await listAiPromptTrackers(env.DB,{
          siteDomain:scope.target,
          locationCode:scope.locationCode,
          languageCode:scope.languageCode,
          includePaused:true,
        }),
      },
      meta:{actual_cost_usd:0,provider_requests:0,source:"d1"},
    });
  }catch(error){
    return mappedError(error);
  }
}

export async function onRequestPost({request,env}){
  const access=denied(request);
  if(access)return access;
  if(!env?.DB)return json({ok:false,error:{code:"BINDING_MISSING",message:"Preview DB binding is not configured."}},503);

  try{
    const body=await readBody(request);
    const scope=normalizedScope(body);
    const action=String(body?.action??"save").trim().toLowerCase();

    if(action==="status"){
      const status=String(body?.status??"").trim().toLowerCase();
      if(!["active","paused"].includes(status)){
        const error=new Error("Tracker status must be active or paused.");
        error.code="VALIDATION_ERROR";
        error.httpStatus=400;
        throw error;
      }
      const item=await updateAiPromptTrackerStatus(env.DB,{
        siteDomain:scope.target,
        trackerId:body?.tracker_id,
        status,
      });
      return json({
        ok:true,
        data:item,
        meta:{actual_cost_usd:0,provider_requests:0,source:"d1"},
      });
    }

    if(action!=="save"){
      const error=new Error("Unsupported Prompt Tracker action.");
      error.code="VALIDATION_ERROR";
      error.httpStatus=400;
      throw error;
    }

    const platform=normalizeLlmPromptPlatform(body?.platform);
    const modelName=normalizeLlmModelName(body?.model_name);
    const prompt=normalizeLlmPrompt(body?.prompt);
    const name=String(body?.name??"").trim();
    if(name.length>120){
      const error=new Error("Tracker name must be 120 characters or fewer.");
      error.code="VALIDATION_ERROR";
      error.httpStatus=400;
      throw error;
    }

    const item=await upsertAiPromptTracker(env.DB,{
      siteDomain:scope.target,
      name,
      platform,
      modelName,
      prompt,
      webSearch:body?.web_search!==false,
      locationCode:scope.locationCode,
      languageCode:scope.languageCode,
      status:"active",
    });

    return json({
      ok:true,
      data:item,
      meta:{actual_cost_usd:0,provider_requests:0,source:"d1"},
    });
  }catch(error){
    return mappedError(error);
  }
}

export function onRequestOptions({request}={}){
  const access=denied(request);
  if(access)return access;
  return new Response(null,{status:204,headers:{Allow:ALLOW}});
}

export async function onRequest(context){
  const handlers={GET:onRequestGet,POST:onRequestPost,OPTIONS:onRequestOptions};
  const handler=handlers[context.request.method];
  return handler
    ? handler(context)
    : json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed."}},405,{Allow:ALLOW});
}
