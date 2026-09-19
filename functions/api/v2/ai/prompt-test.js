import {
  LlmPromptProviderError,
  fetchLlmPromptResponse,
  fetchLlmResponseModels,
  normalizeLlmModelName,
  normalizeLlmPrompt,
  normalizeLlmPromptPlatform,
} from "../../../../src/v2/providers/dataforseo-llm-responses.js";
import { normalizeAiVisibilityDomain } from "../../../../src/v2/providers/dataforseo-ai-visibility.js";
import {
  PROMPT_MODELS_CACHE_TTL_SECONDS,
  PROMPT_RESULT_CACHE_TTL_SECONDS,
  readPromptModelsCache,
  readPromptResultCache,
  writePromptModelsCache,
  writePromptResultCache,
} from "../../../../src/v2/ai/prompt-tracker-cache.js";
import { findLocation } from "../../../../src/v2/markets/catalog.js";
import { normalizeMarketRequest } from "../../../../src/v2/markets/request-market.js";
import { recordApiUsage } from "../../../../src/v2/storage/keyword-overview.js";

const ENDPOINT_NAME="ai_optimization/llm_responses/live";
const MAX_OUTPUT_TOKENS=1024;
const JSON_HEADERS={
  "Content-Type":"application/json; charset=UTF-8",
  "Cache-Control":"no-store",
};

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});
}

async function logUsage(env,values,platform){
  if(!env?.DB)return;
  try{
    await recordApiUsage({
      db:env.DB,
      ...values,
      provider:"dataforseo",
      endpoint:"ai_optimization/"+platform+"/llm_responses/live",
      operation:"ai_prompt_test",
    });
  }catch(error){
    console.error(JSON.stringify({
      message:"Custom Prompt Tracker usage logging failed",
      error:error instanceof Error?error.message:String(error),
    }));
  }
}

async function modelsFor(env,platform){
  const cached=await readPromptModelsCache(env.CACHE,platform);
  if(cached)return {models:cached.data?.models??[],providerRequests:0};
  const provider=await fetchLlmResponseModels({
    login:env.DATAFORSEO_LOGIN,
    password:env.DATAFORSEO_PASSWORD,
    platform,
  });
  await writePromptModelsCache(env.CACHE,platform,provider.data);
  return {models:provider.data.models??[],providerRequests:1};
}

function validate(body){
  const target=normalizeAiVisibilityDomain(body?.target??body?.domain);
  if(!target){
    const error=new Error("Enter a valid root domain.");
    error.code="VALIDATION_ERROR";
    error.httpStatus=400;
    throw error;
  }

  const platform=normalizeLlmPromptPlatform(body?.platform);
  const prompt=normalizeLlmPrompt(body?.prompt??body?.user_prompt);
  const modelName=normalizeLlmModelName(body?.model_name);

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
  const location=findLocation(locationCode);
  return{
    target,
    platform,
    prompt,
    modelName,
    locationCode,
    languageCode,
    countryIsoCode:location?.country_iso_code??null,
    webSearch:body?.web_search!==false,
  };
}

export async function onRequestPost({request,env}){
  const startedAt=Date.now();
  const requestId=crypto.randomUUID();
  if(!env?.CACHE){
    return json({ok:false,error:{code:"BINDING_MISSING",message:"Preview cache binding is not configured."}},503);
  }

  let body;
  try{body=await request.json();}
  catch{return json({ok:false,error:{code:"INVALID_JSON",message:"Request body must be valid JSON."}},400);}

  let scope;
  try{scope=validate(body);}
  catch(error){
    const known=error instanceof LlmPromptProviderError;
    return json({
      ok:false,
      error:{
        code:known?error.code:error?.code??"VALIDATION_ERROR",
        message:error?.message??"Invalid Prompt Test request.",
      },
      meta:{request_id:requestId,actual_cost_usd:0,provider_requests:0},
    },known?error.httpStatus:error?.httpStatus??400);
  }

  const cacheInput={
    target:scope.target,
    platform:scope.platform,
    modelName:scope.modelName,
    prompt:scope.prompt,
    webSearch:scope.webSearch,
    countryIsoCode:scope.countryIsoCode,
    maxOutputTokens:MAX_OUTPUT_TOKENS,
  };
  const forceRefresh=body?.force_refresh===true;
  const cached=forceRefresh?null:await readPromptResultCache(env.CACHE,cacheInput);

  if(cached){
    await logUsage(env,{
      requestId,
      taskCount:0,
      resultCount:1,
      actualCostUsd:0,
      cacheHit:true,
      status:"success",
      httpStatus:200,
      durationMs:Date.now()-startedAt,
    },scope.platform);
    return json({
      ok:true,
      data:{...cached.data,source:"cache"},
      meta:{
        request_id:requestId,
        cached:true,
        cached_at:cached.cached_at,
        actual_cost_usd:0,
        provider_requests:0,
        cache_ttl_days:PROMPT_RESULT_CACHE_TTL_SECONDS/86400,
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
          ?"A paid Prompt Test refresh requires explicit confirmation."
          :"No compatible Prompt Test cache exists. Allow one paid live request to continue.",
      },
      meta:{
        request_id:requestId,
        cached:false,
        force_refresh:forceRefresh,
        actual_cost_usd:0,
        provider_requests:0,
        max_output_tokens:MAX_OUTPUT_TOKENS,
        billing_note:"LLM Responses Live is billed per task plus the underlying model usage. SEO Pro V2 never auto-runs Prompt Tests.",
      },
    },409);
  }

  try{
    const modelLookup=await modelsFor(env,scope.platform);
    const selected=modelLookup.models.find((item)=>item.model_name===scope.modelName);
    if(!selected){
      return json({
        ok:false,
        error:{code:"LLM_MODEL_NOT_AVAILABLE",message:"The selected model is no longer available. Refresh the free model list."},
        meta:{request_id:requestId,actual_cost_usd:0,provider_requests:modelLookup.providerRequests},
      },400);
    }
    if(scope.webSearch&&selected.web_search_supported!==true&&scope.platform!=="perplexity"){
      return json({
        ok:false,
        error:{code:"MODEL_WEB_SEARCH_UNSUPPORTED",message:"The selected model does not support web search. Choose another model or disable web search."},
        meta:{request_id:requestId,actual_cost_usd:0,provider_requests:modelLookup.providerRequests},
      },400);
    }

    const provider=await fetchLlmPromptResponse({
      login:env.DATAFORSEO_LOGIN,
      password:env.DATAFORSEO_PASSWORD,
      platform:scope.platform,
      userPrompt:scope.prompt,
      modelName:scope.modelName,
      target:scope.target,
      maxOutputTokens:MAX_OUTPUT_TOKENS,
      webSearch:scope.webSearch,
      countryIsoCode:scope.countryIsoCode,
    });
    const cachedAt=new Date().toISOString();
    await writePromptResultCache(env.CACHE,cacheInput,provider.data,{cachedAt});

    await logUsage(env,{
      requestId,
      taskCount:provider.taskCount,
      resultCount:provider.resultCount,
      actualCostUsd:provider.actualCostUsd,
      cacheHit:false,
      status:"success",
      httpStatus:200,
      durationMs:Date.now()-startedAt,
    },scope.platform);

    return json({
      ok:true,
      data:{...provider.data,source:"provider"},
      meta:{
        request_id:requestId,
        cached:false,
        cached_at:cachedAt,
        actual_cost_usd:provider.actualCostUsd,
        provider_requests:1+modelLookup.providerRequests,
        paid_provider_requests:1,
        free_model_provider_requests:modelLookup.providerRequests,
        max_output_tokens:MAX_OUTPUT_TOKENS,
        model_list_cache_hours:PROMPT_MODELS_CACHE_TTL_SECONDS/3600,
        cache_ttl_days:PROMPT_RESULT_CACHE_TTL_SECONDS/86400,
        duration_ms:Date.now()-startedAt,
      },
    });
  }catch(error){
    const providerError=error instanceof LlmPromptProviderError?error:null;
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
    },scope.platform);
    return json({
      ok:false,
      error:{
        code:providerError?.code??"LLM_PROMPT_TEST_FAILED",
        message:providerError?.message??"Prompt Test could not be completed.",
        provider_status:providerError?.providerStatus??undefined,
      },
      meta:{request_id:requestId,actual_cost_usd:providerError?.actualCostUsd??null},
    },httpStatus);
  }
}

export function onRequestGet(){
  return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Use POST for a cache-first Prompt Test."}},405);
}

export async function onRequest(context){
  if(context.request.method==="POST")return onRequestPost(context);
  return onRequestGet(context);
}
