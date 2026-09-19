import { queryGscSearchAnalytics } from "../../../../src/v2/providers/google-search-console.js";
import { getGscAccessToken } from "../../../../src/v2/gsc/connection-service.js";
import {
  GSC_GENERATIVE_DIMENSION_SETS,
  gscGenerativeSyncDates,
  gscSearchAppearanceFilter,
  normalizeGscGenerativeSyncRequest,
} from "../../../../src/v2/gsc/generative-ai-sync-plan.js";
import {
  getGscSiteMapping,
  readGscSearchAppearanceCapabilities,
} from "../../../../src/v2/storage/gsc-search-analytics.js";
import {
  completedGscGenerativeAiSyncDates,
  latestGscGenerativeAiSyncRun,
  readGscGenerativeAiSummary,
  recordGscGenerativeAiSyncRun,
  replaceGscGenerativeAiPartition,
} from "../../../../src/v2/storage/gsc-generative-ai.js";
import { normalizeRegistrableDomain } from "../../../../src/v2/storage/registrable-domain.js";
import { gscJson, gscMappedError, requireGscAccess } from "../../../../src/v2/gsc/http.js";

function normalizeSiteDomain(value){
  const domain=normalizeRegistrableDomain(value);
  if(!domain){
    const error=new Error("A valid managed site domain is required.");
    error.code="GSC_SITE_DOMAIN_REQUIRED";
    error.httpStatus=400;
    throw error;
  }
  return domain;
}

async function readBody(request){
  const contentType=request.headers.get("content-type")||"";
  if(!/^application\/json(?:\s*;|$)/i.test(contentType)){
    const error=new Error("Content-Type must be application/json.");
    error.code="UNSUPPORTED_MEDIA_TYPE";
    error.httpStatus=415;
    throw error;
  }
  try{
    const body=await request.json();
    if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();
    return body;
  }catch{
    const error=new Error("Request body must be valid JSON.");
    error.code="INVALID_JSON";
    error.httpStatus=400;
    throw error;
  }
}

async function selectedCapability(db,domain,mapping){
  const capability=await readGscSearchAppearanceCapabilities(db,domain);
  if(
    !capability.selected_appearance||
    !capability.selected||
    capability.selected.property!==mapping?.property
  ){
    const error=new Error("Discover and explicitly select a searchAppearance value for the current mapped property before syncing.");
    error.code="GSC_GENERATIVE_APPEARANCE_NOT_SELECTED";
    error.httpStatus=409;
    throw error;
  }
  return capability;
}

export async function onRequestGet({request,env}){
  const denied=requireGscAccess(request);
  if(denied)return denied;
  if(!env?.DB)return gscJson({ok:false,error:{code:"GSC_DB_MISSING",message:"D1 binding is not configured."}},503);
  try{
    const url=new URL(request.url);
    const domain=normalizeSiteDomain(url.searchParams.get("site_domain"));
    const mapping=await getGscSiteMapping(env.DB,domain);
    const capability=await readGscSearchAppearanceCapabilities(env.DB,domain);
    const selected=capability.selected?.property===mapping?.property?capability.selected_appearance:null;
    const [latest,summary]=await Promise.all([
      latestGscGenerativeAiSyncRun(env.DB,domain),
      readGscGenerativeAiSummary(env.DB,{
        siteDomain:domain,
        appearance:selected,
        days:Number(url.searchParams.get("days")||28),
        limit:Number(url.searchParams.get("limit")||20),
      }),
    ]);
    return gscJson({
      ok:true,
      data:{
        site_domain:domain,
        property:mapping?.property??null,
        selected_appearance:selected,
        sync_enabled:Boolean(mapping?.property&&selected),
        latest_sync:latest??null,
        summary,
      },
      meta:{actual_cost_usd:0,provider_requests:0,source:"d1"},
    });
  }catch(error){
    return gscMappedError(error,"GSC_GENERATIVE_SYNC_STATUS_FAILED");
  }
}

export async function onRequestPost({request,env}){
  const denied=requireGscAccess(request);
  if(denied)return denied;
  if(!env?.DB)return gscJson({ok:false,error:{code:"GSC_DB_MISSING",message:"D1 binding is not configured."}},503);

  const startedAt=new Date().toISOString();
  let body,domain,plan,mapping,capability;
  try{
    body=await readBody(request);
    domain=normalizeSiteDomain(body.site_domain);
    plan=normalizeGscGenerativeSyncRequest(body);
    mapping=await getGscSiteMapping(env.DB,domain);
    if(!mapping?.property){
      const error=new Error("Map a Search Console property before syncing Generative AI appearance data.");
      error.code="GSC_SITE_NOT_MAPPED";
      error.httpStatus=409;
      throw error;
    }
    capability=await selectedCapability(env.DB,domain,mapping);
  }catch(error){
    return gscMappedError(error,"GSC_GENERATIVE_SYNC_VALIDATION_FAILED");
  }

  const appearance=capability.selected_appearance;
  const requestedDates=gscGenerativeSyncDates(plan.target_date,plan.backfill_days);
  let completedDates;
  try{
    completedDates=await completedGscGenerativeAiSyncDates(env.DB,{
      siteProfileId:mapping.site_profile_id,
      appearance,
      dates:requestedDates,
      dimensionSets:plan.dimension_sets,
      minimumRowLimit:plan.row_limit_per_set,
    });
  }catch(error){
    return gscMappedError(error,"GSC_GENERATIVE_SYNC_HISTORY_FAILED");
  }
  const datesToSync=requestedDates.filter((date)=>!completedDates.has(date));
  const skippedDates=requestedDates.filter((date)=>completedDates.has(date));

  if(!datesToSync.length){
    const summary=await readGscGenerativeAiSummary(env.DB,{siteDomain:domain,appearance,days:28,limit:20});
    return gscJson({
      ok:true,
      data:{
        site_domain:domain,property:mapping.property,appearance,
        target_date:plan.target_date,requested_dates:requestedDates,synced_dates:[],skipped_dates:skippedDates,
        dimension_sets:plan.dimension_sets,row_limit_per_set:plan.row_limit_per_set,
        status:"success",results:[],errors:[],truncated_partitions:[],rows_received:0,rows_written:0,
        summary,
        disclaimer:"All requested dates already have successful Generative AI appearance syncs at an equal or deeper row cap. No Google request was made.",
      },
      meta:{actual_cost_usd:0,provider_requests:0,started_at:startedAt,completed_at:new Date().toISOString()},
    });
  }

  let token;
  try{token=await getGscAccessToken(env);}
  catch(error){return gscMappedError(error,"GSC_GENERATIVE_SYNC_AUTH_FAILED");}

  const results=[],errors=[],truncatedPartitions=[],syncedDates=[];
  let providerRequests=0,rowsReceived=0,rowsWritten=0;

  for(const targetDate of datesToSync){
    const dateStartedAt=new Date().toISOString();
    const dateResults=[],dateErrors=[],dateTruncated=[];
    let dateProviderRequests=0,dateRowsReceived=0,dateRowsWritten=0;

    for(const dimensionSet of plan.dimension_sets){
      try{
        providerRequests+=1;dateProviderRequests+=1;
        const dimensions=GSC_GENERATIVE_DIMENSION_SETS[dimensionSet];
        const rowLimit=dimensionSet==="property"?1:plan.row_limit_per_set;
        const response=await queryGscSearchAnalytics({
          accessToken:token.accessToken,
          property:mapping.property,
          startDate:targetDate,
          endDate:targetDate,
          dimensions,
          rowLimit,
          startRow:0,
          searchType:"web",
          dataState:"final",
          dimensionFilterGroups:gscSearchAppearanceFilter(appearance),
        });

        const truncated=dimensionSet!=="property"&&response.has_more===true;
        if(truncated){
          dateTruncated.push(dimensionSet);
          truncatedPartitions.push({date:targetDate,dimension_set:dimensionSet});
        }
        rowsReceived+=response.rows.length;dateRowsReceived+=response.rows.length;
        const saved=await replaceGscGenerativeAiPartition(env.DB,{
          siteProfileId:mapping.site_profile_id,
          property:mapping.property,
          appearance,
          date:targetDate,
          dimensionSet,
          rows:response.rows,
        });
        rowsWritten+=saved.rows_written;dateRowsWritten+=saved.rows_written;
        const result={
          target_date:targetDate,dimension_set:dimensionSet,dimensions,
          rows_received:response.rows.length,rows_written:saved.rows_written,truncated,
        };
        dateResults.push(result);results.push(result);
      }catch(error){
        const failure={
          target_date:targetDate,dimension_set:dimensionSet,
          code:error?.code||"GSC_GENERATIVE_SYNC_DIMENSION_FAILED",
          message:error?.message||"Generative AI appearance sync failed.",
        };
        dateErrors.push(failure);errors.push(failure);
      }
    }

    const dateStatus=dateErrors.length?(dateResults.length?"partial":"error"):"success";
    if(dateResults.length)syncedDates.push(targetDate);
    try{
      await recordGscGenerativeAiSyncRun(env.DB,{
        site_profile_id:mapping.site_profile_id,
        property:mapping.property,
        appearance_value:appearance,
        target_date:targetDate,
        dimension_sets:plan.dimension_sets,
        row_limit_per_set:plan.row_limit_per_set,
        provider_requests:dateProviderRequests,
        rows_received:dateRowsReceived,
        rows_written:dateRowsWritten,
        truncated_sets:dateTruncated,
        status:dateStatus,
        error_code:dateErrors[0]?.code??null,
        started_at:dateStartedAt,
        completed_at:new Date().toISOString(),
      });
    }catch(error){
      console.error(JSON.stringify({message:"GSC Generative AI sync logging failed",target_date:targetDate,error:error instanceof Error?error.message:String(error)}));
    }
  }

  if(!results.length&&errors.length){
    const error=new Error(errors[0].message);
    error.code=errors[0].code;
    error.httpStatus=502;
    return gscMappedError(error,"GSC_GENERATIVE_SYNC_FAILED");
  }

  const summary=await readGscGenerativeAiSummary(env.DB,{siteDomain:domain,appearance,days:28,limit:20});
  const status=errors.length?(results.length?"partial":"error"):"success";
  return gscJson({
    ok:true,
    data:{
      site_domain:domain,property:mapping.property,appearance,
      target_date:plan.target_date,backfill_days:plan.backfill_days,
      requested_dates:requestedDates,synced_dates:syncedDates,skipped_dates:skippedDates,
      dimension_sets:plan.dimension_sets,row_limit_per_set:plan.row_limit_per_set,
      status,results,errors,truncated_partitions:truncatedPartitions,
      rows_received:rowsReceived,rows_written:rowsWritten,summary,
      disclaimer:truncatedPartitions.length
        ?"At least one filtered Search Analytics partition reached the configured row cap; stored rows for that partition are partial."
        :"This dataset is Search Analytics filtered by the manually selected discovered searchAppearance value. No AI traffic is inferred by subtraction.",
    },
    meta:{actual_cost_usd:0,provider_requests:providerRequests,started_at:startedAt,completed_at:new Date().toISOString()},
  });
}

export async function onRequest(context){
  if(context.request.method==="GET")return onRequestGet(context);
  if(context.request.method==="POST")return onRequestPost(context);
  return gscJson({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Use GET or POST."}},405);
}
