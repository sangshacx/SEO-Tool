export const GSC_GENERATIVE_DIMENSION_SETS = Object.freeze({
  property: Object.freeze([]),
  page: Object.freeze(["page"]),
  country: Object.freeze(["country"]),
  device: Object.freeze(["device"]),
});

export const DEFAULT_GSC_GENERATIVE_DIMENSION_SETS = Object.freeze(["property","page","country","device"]);
export const GSC_GENERATIVE_BACKFILL_DAYS = Object.freeze([1,3,7]);
export const GSC_GENERATIVE_ROW_LIMITS = Object.freeze([1000,2500,5000]);

function isoDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+"T00:00:00Z")))return null;
  return value;
}

export function defaultGscGenerativeSyncDate(now=new Date()){
  return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-3)).toISOString().slice(0,10);
}

export function normalizeGscGenerativeSyncRequest(input={},now=new Date()){
  const targetDate=isoDate(input.target_date)||defaultGscGenerativeSyncDate(now);
  const today=now.toISOString().slice(0,10);
  if(targetDate>=today){
    const error=new TypeError("GSC Generative AI sync date must be before today.");
    error.code="GSC_GENERATIVE_INVALID_SYNC_DATE";
    throw error;
  }

  const rawSets=Array.isArray(input.dimension_sets)&&input.dimension_sets.length
    ?input.dimension_sets
    :DEFAULT_GSC_GENERATIVE_DIMENSION_SETS;
  const sets=[...new Set(rawSets.map((value)=>String(value).trim()).filter(Boolean))];
  if(!sets.length||sets.some((value)=>!Object.hasOwn(GSC_GENERATIVE_DIMENSION_SETS,value))){
    const error=new TypeError("Choose supported Generative AI dimension sets.");
    error.code="GSC_GENERATIVE_INVALID_DIMENSION_SETS";
    throw error;
  }

  const rowLimit=Number(input.row_limit_per_set??1000);
  if(!GSC_GENERATIVE_ROW_LIMITS.includes(rowLimit)){
    const error=new TypeError("Choose a Generative AI row limit of 1000, 2500, or 5000.");
    error.code="GSC_GENERATIVE_INVALID_ROW_LIMIT";
    throw error;
  }

  const backfillDays=Number(input.backfill_days??1);
  if(!GSC_GENERATIVE_BACKFILL_DAYS.includes(backfillDays)){
    const error=new TypeError("Choose a Generative AI backfill window of 1, 3, or 7 days.");
    error.code="GSC_GENERATIVE_INVALID_BACKFILL";
    throw error;
  }
  if(backfillDays>1&&rowLimit>1000){
    const error=new TypeError("Multi-day Generative AI backfill is capped at 1,000 rows per dimension set.");
    error.code="GSC_GENERATIVE_BACKFILL_ROW_LIMIT";
    throw error;
  }

  return {
    target_date:targetDate,
    dimension_sets:sets,
    row_limit_per_set:rowLimit,
    backfill_days:backfillDays,
  };
}

export function gscGenerativeSyncDates(targetDate,backfillDays=1){
  const days=Number(backfillDays);
  if(!GSC_GENERATIVE_BACKFILL_DAYS.includes(days))throw new TypeError("Unsupported Generative AI backfill window.");
  const end=new Date(targetDate+"T00:00:00Z");
  return Array.from({length:days},(_,index)=>{
    const date=new Date(end);
    date.setUTCDate(date.getUTCDate()-index);
    return date.toISOString().slice(0,10);
  }).sort();
}

export function gscSearchAppearanceFilter(appearance){
  const value=String(appearance??"").trim();
  if(!value){
    const error=new TypeError("A discovered search appearance value is required.");
    error.code="GSC_GENERATIVE_APPEARANCE_REQUIRED";
    throw error;
  }
  return [{
    groupType:"and",
    filters:[{
      dimension:"searchAppearance",
      operator:"equals",
      expression:value,
    }],
  }];
}
