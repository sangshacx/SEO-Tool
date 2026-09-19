import {
  AI_VISIBILITY_MENTION_LIMITS,
  AiVisibilityProviderError,
  fetchAiVisibilityMentionExplorer,
  normalizeAiVisibilityDomain,
  normalizeAiVisibilityMarket,
} from "../../../../src/v2/providers/dataforseo-ai-visibility.js";
import {
  AI_VISIBILITY_CACHE_TTL_SECONDS,
  readAiVisibilityCache,
  writeAiVisibilityCache,
} from "../../../../src/v2/ai/ai-visibility-cache.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const ENDPOINT_NAME="ai_optimization/llm_mentions/search_mentions/live";
const JSON_HEADERS={"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"};

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});
}

async function logUsage(env,values){
  try{
    await recordApiUsage({
      db:env.DB,
      ...values,
      provider:"dataforseo",
      endpoint:ENDPOINT_NAME,
      operation:"ai_citation_explorer",
    });
  }catch(error){
    console.error(JSON.stringify({
      message:"AI citation explorer usage logging failed",
      error:error instanceof Error?error.message:String(error),
    }));
  }
}

function validate(body){
  const target=normalizeAiVisibilityDomain(body?.target??body?.domain);
  if(!target){
    const error=new Error("Enter a valid root domain.");
    error.code="VALIDATION_ERROR";
    error.httpStatus=400;
    throw error;
  }

  const limit=Number(body?.limit??25);
  if(!AI_VISIBILITY_MENTION_LIMITS.includes(limit)){
    const error=new Error("Choose 10, 25, or 50 citation results.");
    error.code="INVALID_PROVIDER_LIMIT";
    error.httpStatus=400;
    throw error;
  }

  let locationCode;
  let languageCode;
  try{
    ({locationCode,languageCode}=normalizeMarketRequest(body));
  }catch{
    const error=new Error("Select a supported country and language combination.");
    error.code="VALIDATION_ERROR";
    error.httpStatus=400;
    throw error;
  }
  const market=normalizeAiVisibilityMarket({
    platform:body?.platform,
    locationCode,
    languageCode,
  });
  return{
    target,
    limit,
    platform:market.platform,
    locationCode:market.locationCode,
    languageCode:market.languageCode,
  };
}

export async function onRequestPost({request,env}){
  const startedAt=Date.now();
  const requestId=crypto.randomUUID();
  if(!env?.CACHE||!env?.DB){
    return json({ok:false,error:{code:"BINDINGS_MISSING",message:"Preview storage bindings are not configured."}},503);
  }

  let body;
  try{body=await request.json();}
  catch{return json({ok:false,error:{code:"INVALID_JSON",message:"Request body must be valid JSON."}},400);}

  let scope;
  try{scope=validate(body);}
  catch(error){
    const known=error instanceof AiVisibilityProviderError;
    return json({
      ok:false,
      error:{
        code:known?error.code:error?.code??"VALIDATION_ERROR",
        message:error?.message??"Invalid AI citation explorer request.",
      },
      meta:{request_id:requestId,actual_cost_usd:0,provider_requests:0},
    },known?error.httpStatus:error?.httpStatus??400);
  }

  const cacheInput={
    target:scope.target,
    platform:scope.platform,
    locationCode:scope.locationCode,
    languageCode:scope.languageCode,
    view:"citations",
    limit:scope.limit,
  };
  const forceRefresh=body?.force_refresh===true;
  const cached=forceRefresh?null:await readAiVisibilityCache(env.CACHE,cacheInput);

  if(cached){
    await logUsage(env,{
      requestId,
      taskCount:0,
      resultCount:cached.data?.items?.length??0,
      actualCostUsd:0,
      cacheHit:true,
      status:"success",
      httpStatus:200,
      durationMs:Date.now()-startedAt,
    });
    return json({
      ok:true,
      data:{...cached.data,source:"cache"},
      meta:{
        request_id:requestId,
        cached:true,
        cached_at:cached.cached_at,
        actual_cost_usd:0,
        provider_requests:0,
        cache_ttl_days:AI_VISIBILITY_CACHE_TTL_SECONDS/86400,
        duration_ms:Date.now()-startedAt,
      },
    });
  }

  if(body?.allow_live_request!==true){
    return json({
      ok:false,
      error:{
        code:"LIVE_REQUEST_CONFIRMATION_REQUIRED",
        message:forceRefresh
          ?"A paid AI citation explorer refresh requires explicit confirmation."
          :"No compatible AI citation explorer cache exists. Allow one paid live request to continue.",
      },
      meta:{
        request_id:requestId,
        cached:false,
        force_refresh:forceRefresh,
        actual_cost_usd:0,
        provider_requests:0,
        billing_note:"Citation Explorer is a paid DataForSEO LLM Mentions Search Mentions request. Result depth affects provider cost.",
      },
    },409);
  }

  try{
    const provider=await fetchAiVisibilityMentionExplorer({
      login:env.DATAFORSEO_LOGIN,
      password:env.DATAFORSEO_PASSWORD,
      target:scope.target,
      platform:scope.platform,
      locationCode:scope.locationCode,
      languageCode:scope.languageCode,
      limit:scope.limit,
    });
    const cachedAt=new Date().toISOString();
    await writeAiVisibilityCache(env.CACHE,cacheInput,provider.data,{cachedAt});

    await logUsage(env,{
      requestId,
      taskCount:provider.taskCount,
      resultCount:provider.resultCount,
      actualCostUsd:provider.actualCostUsd,
      cacheHit:false,
      status:"success",
      httpStatus:200,
      durationMs:Date.now()-startedAt,
    });

    return json({
      ok:true,
      data:{...provider.data,source:"provider"},
      meta:{
        request_id:requestId,
        cached:false,
        cached_at:cachedAt,
        force_refresh:forceRefresh,
        actual_cost_usd:provider.actualCostUsd,
        provider_requests:1,
        cache_ttl_days:AI_VISIBILITY_CACHE_TTL_SECONDS/86400,
        duration_ms:Date.now()-startedAt,
      },
    });
  }catch(error){
    const providerError=error instanceof AiVisibilityProviderError?error:null;
    const httpStatus=providerError?.httpStatus??502;
    await logUsage(env,{
      requestId,
      taskCount:providerError?.code==="PROVIDER_CREDENTIALS_MISSING"?0:1,
      resultCount:0,
      actualCostUsd:providerError?.actualCostUsd??null,
      cacheHit:false,
      status:"error",
      httpStatus,
      durationMs:Date.now()-startedAt,
    });
    return json({
      ok:false,
      error:{
        code:providerError?.code??"AI_CITATION_EXPLORER_FAILED",
        message:providerError?.message??"AI citation explorer could not be loaded.",
        provider_status:providerError?.providerStatus??undefined,
      },
      meta:{
        request_id:requestId,
        actual_cost_usd:providerError?.actualCostUsd??null,
      },
    },httpStatus);
  }
}

export function onRequestGet(){
  return json({
    ok:false,
    error:{code:"METHOD_NOT_ALLOWED",message:"Use POST for AI citation explorer."},
  },405);
}
