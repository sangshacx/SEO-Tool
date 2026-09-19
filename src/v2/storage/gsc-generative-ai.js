import { summarizeGscGenerativeAiTrend } from "../intelligence/gsc-generative-ai-trends.js";
import { summarizeGscGenerativeWorkflowOutcome } from "../intelligence/gsc-generative-ai-outcomes.js";

const INSERT_CHUNK_SIZE=250;

function metricRow(row={}){
  return {
    page_url:String(row.page??""),
    country:String(row.country??""),
    device:String(row.device??""),
    clicks:Number.isFinite(Number(row.clicks))?Number(row.clicks):0,
    impressions:Number.isFinite(Number(row.impressions))?Number(row.impressions):0,
    ctr:Number.isFinite(Number(row.ctr))?Number(row.ctr):0,
    position:row.position==null||!Number.isFinite(Number(row.position))?null:Number(row.position),
  };
}

function insertStatement(db,{siteProfileId,property,appearance,date,dimensionSet,rows,syncedAt}){
  return db.prepare(
    "INSERT INTO gsc_generative_ai_daily ("+
    "site_profile_id, property, appearance_value, date, dimension_set, page_url, country, device, "+
    "clicks, impressions, ctr, position, synced_at"+
    ") SELECT ?, ?, ?, ?, ?, "+
    "COALESCE(json_extract(value, '$.page_url'), ''), "+
    "COALESCE(json_extract(value, '$.country'), ''), "+
    "COALESCE(json_extract(value, '$.device'), ''), "+
    "COALESCE(json_extract(value, '$.clicks'), 0), "+
    "COALESCE(json_extract(value, '$.impressions'), 0), "+
    "COALESCE(json_extract(value, '$.ctr'), 0), "+
    "json_extract(value, '$.position'), ? FROM json_each(?)"
  ).bind(
    siteProfileId,property,appearance,date,dimensionSet,syncedAt,
    JSON.stringify(rows.map(metricRow)),
  );
}

export async function replaceGscGenerativeAiPartition(db,{
  siteProfileId,
  property,
  appearance,
  date,
  dimensionSet,
  rows,
  syncedAt=new Date().toISOString(),
}={}){
  const clean=Array.isArray(rows)?rows:[];
  const statements=[
    db.prepare(
      "DELETE FROM gsc_generative_ai_daily WHERE site_profile_id = ? AND appearance_value = ? AND date = ? AND dimension_set = ?"
    ).bind(siteProfileId,appearance,date,dimensionSet),
  ];
  for(let index=0;index<clean.length;index+=INSERT_CHUNK_SIZE){
    statements.push(insertStatement(db,{
      siteProfileId,property,appearance,date,dimensionSet,
      rows:clean.slice(index,index+INSERT_CHUNK_SIZE),syncedAt,
    }));
  }
  const results=await db.batch(statements);
  if(!Array.isArray(results)||results.some((result)=>result?.success===false)){
    throw new Error("GSC Generative AI partition could not be persisted.");
  }
  return {rows_written:clean.length,statements:statements.length};
}

export async function recordGscGenerativeAiSyncRun(db,input){
  const row=await db.prepare(
    "INSERT INTO gsc_generative_ai_sync_runs ("+
    "site_profile_id, property, appearance_value, target_date, dimension_sets_json, row_limit_per_set, "+
    "provider_requests, rows_received, rows_written, truncated_sets_json, status, error_code, started_at, completed_at"+
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
  ).bind(
    input.site_profile_id,
    input.property,
    input.appearance_value,
    input.target_date,
    JSON.stringify(input.dimension_sets??[]),
    input.row_limit_per_set,
    input.provider_requests??0,
    input.rows_received??0,
    input.rows_written??0,
    JSON.stringify(input.truncated_sets??[]),
    input.status,
    input.error_code??null,
    input.started_at,
    input.completed_at,
  ).first();
  return {id:row?.id??null};
}

export async function latestGscGenerativeAiSyncRun(db,siteDomain){
  return db.prepare(
    "SELECT sr.id, sr.property, sr.appearance_value, sr.target_date, sr.dimension_sets_json, "+
    "sr.row_limit_per_set, sr.provider_requests, sr.rows_received, sr.rows_written, sr.truncated_sets_json, "+
    "sr.status, sr.error_code, sr.started_at, sr.completed_at "+
    "FROM gsc_generative_ai_sync_runs sr JOIN site_profiles sp ON sp.id = sr.site_profile_id "+
    "WHERE sp.domain = ? ORDER BY sr.id DESC LIMIT 1"
  ).bind(siteDomain).first();
}

export async function completedGscGenerativeAiSyncDates(db,{
  siteProfileId,
  appearance,
  dates,
  dimensionSets,
  minimumRowLimit,
}={}){
  const requested=[...new Set((Array.isArray(dates)?dates:[]).filter(Boolean))];
  if(!requested.length)return new Set();
  const placeholders=requested.map(()=>"?").join(",");
  const result=await db.prepare(
    "SELECT target_date, dimension_sets_json, row_limit_per_set FROM gsc_generative_ai_sync_runs "+
    "WHERE site_profile_id = ? AND appearance_value = ? AND target_date IN ("+placeholders+") "+
    "AND status = 'success' ORDER BY id DESC"
  ).bind(siteProfileId,appearance,...requested).all();

  const completed=new Set();
  const required=new Set(dimensionSets??[]);
  for(const row of result.results??[]){
    if(completed.has(row.target_date))continue;
    if(Number(row.row_limit_per_set??0)<Number(minimumRowLimit??0))continue;
    let sets=[];
    try{sets=JSON.parse(row.dimension_sets_json);}catch{sets=[];}
    if(!Array.isArray(sets))continue;
    const available=new Set(sets);
    if([...required].every((set)=>available.has(set)))completed.add(row.target_date);
  }
  return completed;
}

function windowFrom(latestDate,days){
  const end=new Date(latestDate+"T00:00:00Z");
  const start=new Date(end);
  start.setUTCDate(start.getUTCDate()-days+1);
  return {start:start.toISOString().slice(0,10),end:latestDate};
}

function normalizeAggregate(row={}){
  const clicks=Number(row.clicks??0);
  const impressions=Number(row.impressions??0);
  return {
    clicks,
    impressions,
    ctr:impressions>0?clicks/impressions:0,
    position:row.position==null?null:Number(row.position),
  };
}

async function aggregateRows(db,{siteProfileId,appearance,dimensionSet,primary,window,limit}){
  const sql=
    "SELECT "+primary+" AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, "+
    "CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE NULL END AS position "+
    "FROM gsc_generative_ai_daily WHERE site_profile_id = ? AND appearance_value = ? AND dimension_set = ? "+
    "AND date BETWEEN ? AND ? AND "+primary+" <> '' GROUP BY "+primary+
    " ORDER BY impressions DESC, clicks DESC LIMIT ?";
  const result=await db.prepare(sql).bind(
    siteProfileId,appearance,dimensionSet,window.start,window.end,limit
  ).all();
  return (result.results??[]).map((row)=>({key:row.key,...normalizeAggregate(row)}));
}

export async function readGscGenerativeAiSummary(db,{
  siteDomain,
  appearance,
  days=28,
  limit=20,
}={}){
  const site=await db.prepare("SELECT id FROM site_profiles WHERE domain = ? LIMIT 1").bind(siteDomain).first();
  if(!site?.id){
    const error=new Error("SITE_PROFILE_NOT_FOUND");
    error.code="SITE_PROFILE_NOT_FOUND";
    error.httpStatus=404;
    throw error;
  }
  const selected=String(appearance??"").trim();
  if(!selected){
    return {
      site_profile_id:Number(site.id),
      appearance:null,
      latest_date:null,
      window:null,
      coverage_days:0,
      metrics:{clicks:0,impressions:0,ctr:0,position:null},
      pages:[],countries:[],devices:[],daily:[],
      trend:summarizeGscGenerativeAiTrend([]),
    };
  }
  const windowDays=[7,28,90].includes(Number(days))?Number(days):28;
  const rowLimit=Math.max(1,Math.min(100,Number(limit)||20));
  const latest=await db.prepare(
    "SELECT MAX(date) AS latest_date FROM gsc_generative_ai_daily "+
    "WHERE site_profile_id = ? AND appearance_value = ? AND dimension_set = 'property'"
  ).bind(site.id,selected).first();
  if(!latest?.latest_date){
    return {
      site_profile_id:Number(site.id),appearance:selected,latest_date:null,window:null,coverage_days:0,
      metrics:{clicks:0,impressions:0,ctr:0,position:null},pages:[],countries:[],devices:[],daily:[],
      trend:summarizeGscGenerativeAiTrend([]),
    };
  }

  const window=windowFrom(latest.latest_date,windowDays);
  const total=await db.prepare(
    "SELECT COUNT(DISTINCT date) AS coverage_days, SUM(clicks) AS clicks, SUM(impressions) AS impressions, "+
    "CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE NULL END AS position "+
    "FROM gsc_generative_ai_daily WHERE site_profile_id = ? AND appearance_value = ? AND dimension_set = 'property' "+
    "AND date BETWEEN ? AND ?"
  ).bind(site.id,selected,window.start,window.end).first();

  const historyStart=windowFrom(latest.latest_date,Math.max(windowDays,28)).start;
  const [pages,countries,devices,dailyResult]=await Promise.all([
    aggregateRows(db,{siteProfileId:site.id,appearance:selected,dimensionSet:"page",primary:"page_url",window,limit:rowLimit}),
    aggregateRows(db,{siteProfileId:site.id,appearance:selected,dimensionSet:"country",primary:"country",window,limit:20}),
    aggregateRows(db,{siteProfileId:site.id,appearance:selected,dimensionSet:"device",primary:"device",window,limit:10}),
    db.prepare(
      "SELECT date, clicks, impressions, ctr, position FROM gsc_generative_ai_daily "+
      "WHERE site_profile_id = ? AND appearance_value = ? AND dimension_set = 'property' "+
      "AND date BETWEEN ? AND ? ORDER BY date ASC"
    ).bind(site.id,selected,historyStart,latest.latest_date).all(),
  ]);
  const daily=(dailyResult?.results??[]).map((row)=>({
    date:row.date,
    clicks:Number(row.clicks??0),
    impressions:Number(row.impressions??0),
    ctr:Number(row.ctr??0),
    position:row.position==null?null:Number(row.position),
  }));
  const trend=summarizeGscGenerativeAiTrend(daily,{comparisonDays:7});

  return {
    site_profile_id:Number(site.id),
    appearance:selected,
    latest_date:latest.latest_date,
    window:{start_date:window.start,end_date:window.end,days:windowDays},
    coverage_days:Number(total?.coverage_days??0),
    metrics:normalizeAggregate(total),
    pages,countries,devices,daily,trend,
    disclaimer:
      "This view is Search Analytics filtered by the manually selected discovered searchAppearance value. It is not a reverse-engineered Google Generative AI score and does not infer unavailable traffic.",
  };
}


function dateOffset(value,days){
  if(!value)return null;
  const date=new Date(String(value).slice(0,10)+"T00:00:00Z");
  if(Number.isNaN(date.getTime()))return null;
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

export async function linkGscGenerativeWorkflow(db,{
  siteDomain,
  workflowId,
  appearance,
}={}){
  const site=await db.prepare("SELECT id FROM site_profiles WHERE domain = ? LIMIT 1")
    .bind(siteDomain).first();
  if(!site?.id){
    const error=new Error("GSC Generative workflow link requires a saved own-site profile.");
    error.code="MANAGED_SITE_REQUIRED";
    error.httpStatus=409;
    throw error;
  }

  const workflow=await db.prepare(
    "SELECT id, action_code FROM seo_action_workflow WHERE id = ? AND site_profile_id = ? LIMIT 1"
  ).bind(Number(workflowId),site.id).first();
  if(!workflow?.id||workflow.action_code!=="gsc_generative_recovery"){
    const error=new Error("GSC Generative link requires a matching recovery workflow.");
    error.code="INVALID_GSC_GENERATIVE_WORKFLOW";
    error.httpStatus=400;
    throw error;
  }

  const value=String(appearance??"").trim();
  const selected=await db.prepare(
    "SELECT property, appearance_value FROM gsc_search_appearance_capabilities "+
    "WHERE site_profile_id = ? AND appearance_value = ? AND selected_for_generative_ai = 1 LIMIT 1"
  ).bind(site.id,value).first();
  if(!selected?.appearance_value){
    const error=new Error("The workflow searchAppearance must be the currently selected discovered value.");
    error.code="GSC_GENERATIVE_APPEARANCE_NOT_SELECTED";
    error.httpStatus=409;
    throw error;
  }

  await db.prepare(
    "INSERT INTO gsc_generative_workflow_links (workflow_id, site_profile_id, property, appearance_value) "+
    "VALUES (?, ?, ?, ?) ON CONFLICT(workflow_id) DO UPDATE SET "+
    "property = excluded.property, appearance_value = excluded.appearance_value, updated_at = CURRENT_TIMESTAMP"
  ).bind(workflow.id,site.id,selected.property,selected.appearance_value).run();

  return {
    workflow_id:Number(workflow.id),
    site_profile_id:Number(site.id),
    property:selected.property,
    appearance_value:selected.appearance_value,
  };
}

async function gscGenerativeOutcomeWindow(db,{
  siteProfileId,
  appearance,
  startDate,
  endDate,
}={}){
  const row=await db.prepare(
    "SELECT COUNT(DISTINCT date) AS days, COALESCE(SUM(clicks),0) AS clicks, "+
    "COALESCE(SUM(impressions),0) AS impressions FROM gsc_generative_ai_daily "+
    "WHERE site_profile_id = ? AND appearance_value = ? AND dimension_set = 'property' "+
    "AND date BETWEEN ? AND ?"
  ).bind(siteProfileId,appearance,startDate,endDate).first();
  return {
    days:Number(row?.days??0),
    clicks:Number(row?.clicks??0),
    impressions:Number(row?.impressions??0),
  };
}

export async function readGscGenerativeWorkflowOutcomes(db,{
  siteDomain,
  limit=10,
  windowDays=7,
}={}){
  const site=await db.prepare("SELECT id FROM site_profiles WHERE domain = ? LIMIT 1")
    .bind(siteDomain).first();
  if(!site?.id)return [];

  const boundedLimit=Math.max(1,Math.min(25,Number(limit)||10));
  const days=Math.max(3,Math.min(14,Number(windowDays)||7));
  const done=await db.prepare(`
    SELECT
      e.id AS event_id,
      e.workflow_id,
      e.page_url,
      e.action_code,
      e.created_at,
      l.property,
      l.appearance_value
    FROM seo_action_workflow_events e
    JOIN (
      SELECT workflow_id, MAX(id) AS event_id
      FROM seo_action_workflow_events
      WHERE to_status = 'done' AND action_code = 'gsc_generative_recovery'
      GROUP BY workflow_id
    ) latest ON latest.event_id = e.id
    JOIN gsc_generative_workflow_links l ON l.workflow_id = e.workflow_id
    WHERE e.site_profile_id = ?
    ORDER BY e.id DESC
    LIMIT ?
  `).bind(site.id,boundedLimit).all();

  const outcomes=[];
  for(const event of done?.results??[]){
    const completed=String(event.created_at??"").slice(0,10);
    const preStart=dateOffset(completed,-days);
    const preEnd=dateOffset(completed,-1);
    const postStart=dateOffset(completed,1);
    const postEnd=dateOffset(completed,days);
    if(!preStart||!preEnd||!postStart||!postEnd)continue;

    const [pre,post]=await Promise.all([
      gscGenerativeOutcomeWindow(db,{
        siteProfileId:site.id,
        appearance:event.appearance_value,
        startDate:preStart,
        endDate:preEnd,
      }),
      gscGenerativeOutcomeWindow(db,{
        siteProfileId:site.id,
        appearance:event.appearance_value,
        startDate:postStart,
        endDate:postEnd,
      }),
    ]);

    outcomes.push(summarizeGscGenerativeWorkflowOutcome({
      event,
      link:{
        property:event.property,
        appearance_value:event.appearance_value,
      },
      pre,
      post,
      windowDays:days,
    }));
  }
  return outcomes;
}
