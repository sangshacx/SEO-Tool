import {
  LlmPromptProviderError,
  fetchLlmResponseModels,
  normalizeLlmPromptPlatform,
} from "../../../../src/v2/providers/dataforseo-llm-responses.js";
import {
  PROMPT_MODELS_CACHE_TTL_SECONDS,
  readPromptModelsCache,
  writePromptModelsCache,
} from "../../../../src/v2/ai/prompt-tracker-cache.js";

const JSON_HEADERS={
  "Content-Type":"application/json; charset=UTF-8",
  "Cache-Control":"no-store",
};

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});
}

export async function onRequestGet({request,env}){
  const startedAt=Date.now();
  const requestId=crypto.randomUUID();
  if(!env?.CACHE){
    return json({ok:false,error:{code:"BINDING_MISSING",message:"Preview cache binding is not configured."}},503);
  }

  let platform;
  try{
    platform=normalizeLlmPromptPlatform(new URL(request.url).searchParams.get("platform"));
  }catch(error){
    const known=error instanceof LlmPromptProviderError;
    return json({
      ok:false,
      error:{code:known?error.code:"VALIDATION_ERROR",message:error?.message??"Invalid LLM platform."},
      meta:{request_id:requestId,actual_cost_usd:0,provider_requests:0},
    },known?error.httpStatus:400);
  }

  const cached=await readPromptModelsCache(env.CACHE,platform);
  if(cached){
    return json({
      ok:true,
      data:{...cached.data,source:"cache"},
      meta:{
        request_id:requestId,
        cached:true,
        cached_at:cached.cached_at,
        actual_cost_usd:0,
        provider_requests:0,
        cache_ttl_hours:PROMPT_MODELS_CACHE_TTL_SECONDS/3600,
        duration_ms:Date.now()-startedAt,
      },
    });
  }

  try{
    const provider=await fetchLlmResponseModels({
      login:env.DATAFORSEO_LOGIN,
      password:env.DATAFORSEO_PASSWORD,
      platform,
    });
    const cachedAt=new Date().toISOString();
    await writePromptModelsCache(env.CACHE,platform,provider.data,{cachedAt});
    return json({
      ok:true,
      data:{...provider.data,source:"provider"},
      meta:{
        request_id:requestId,
        cached:false,
        cached_at:cachedAt,
        actual_cost_usd:0,
        provider_requests:1,
        cache_ttl_hours:PROMPT_MODELS_CACHE_TTL_SECONDS/3600,
        duration_ms:Date.now()-startedAt,
      },
    });
  }catch(error){
    const providerError=error instanceof LlmPromptProviderError?error:null;
    return json({
      ok:false,
      error:{
        code:providerError?.code??"LLM_MODELS_FAILED",
        message:providerError?.message??"LLM model list could not be loaded.",
        provider_status:providerError?.providerStatus??undefined,
      },
      meta:{request_id:requestId,actual_cost_usd:0},
    },providerError?.httpStatus??502);
  }
}

export function onRequestPost(){
  return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Use GET for the free LLM models list."}},405);
}

export async function onRequest(context){
  if(context.request.method==="GET")return onRequestGet(context);
  return onRequestPost(context);
}
