function finite(value){
  if(value===null||value===undefined||value==="")return null;
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}

function isoDate(value){
  return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
}

function dateAdd(date,days){
  const value=new Date(date+"T00:00:00Z");
  value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
}

function sum(rows,key){
  return rows.reduce((total,row)=>total+(finite(row?.[key])??0),0);
}

function pctDelta(current,previous){
  if(previous===0)return current===0?0:null;
  return Math.round(((current-previous)/previous)*1000)/10;
}

function windowStats(rows,start,end,requestedDays){
  const matching=rows.filter((row)=>row.date>=start&&row.date<=end);
  const clicks=sum(matching,"clicks");
  const impressions=sum(matching,"impressions");
  return {
    start_date:start,
    end_date:end,
    requested_days:requestedDays,
    coverage_days:new Set(matching.map((row)=>row.date)).size,
    clicks,
    impressions,
    ctr:impressions>0?clicks/impressions:0,
  };
}

export function summarizeGscGenerativeAiTrend(rows=[],{
  comparisonDays=7,
  minimumCoverageRatio=0.5,
}={}){
  const clean=(Array.isArray(rows)?rows:[])
    .map((row)=>({
      date:isoDate(row?.date),
      clicks:finite(row?.clicks)??0,
      impressions:finite(row?.impressions)??0,
      ctr:finite(row?.ctr)??0,
      position:finite(row?.position),
    }))
    .filter((row)=>row.date)
    .sort((a,b)=>a.date.localeCompare(b.date));

  if(!clean.length){
    return {
      status:"no_data",
      current:null,
      previous:null,
      deltas:null,
      change:{code:"no_data",label:"No first-party Generative AI history",kind:"neutral"},
      disclaimer:"Trend is descriptive first-party Search Analytics filtered by the selected searchAppearance value.",
    };
  }

  const days=Math.max(1,Math.min(28,Number(comparisonDays)||7));
  const latest=clean[clean.length-1].date;
  const currentEnd=latest;
  const currentStart=dateAdd(currentEnd,-days+1);
  const previousEnd=dateAdd(currentStart,-1);
  const previousStart=dateAdd(previousEnd,-days+1);
  const current=windowStats(clean,currentStart,currentEnd,days);
  const previous=windowStats(clean,previousStart,previousEnd,days);
  const minimumCoverage=Math.max(1,Math.ceil(days*Math.max(0,Math.min(1,Number(minimumCoverageRatio)||0.5))));
  const sufficient=current.coverage_days>=minimumCoverage&&previous.coverage_days>=minimumCoverage;

  const deltas={
    clicks:current.clicks-previous.clicks,
    impressions:current.impressions-previous.impressions,
    clicks_percent:pctDelta(current.clicks,previous.clicks),
    impressions_percent:pctDelta(current.impressions,previous.impressions),
    ctr_points:Math.round((current.ctr-previous.ctr)*10000)/100,
  };

  let change;
  if(!sufficient){
    change={code:"insufficient_coverage",label:"Need more comparable days",kind:"neutral"};
  }else if(previous.impressions===0&&current.impressions>0){
    change={code:"visibility_gained",label:"Filtered visibility appeared",kind:"positive"};
  }else if(previous.impressions>0&&current.impressions===0){
    change={code:"visibility_lost",label:"Filtered visibility disappeared",kind:"negative"};
  }else if(deltas.impressions>0){
    change={code:"impressions_up",label:"Filtered impressions increased",kind:"positive"};
  }else if(deltas.impressions<0){
    change={code:"impressions_down",label:"Filtered impressions decreased",kind:"negative"};
  }else if(deltas.clicks>0){
    change={code:"clicks_up",label:"Filtered clicks increased",kind:"positive"};
  }else if(deltas.clicks<0){
    change={code:"clicks_down",label:"Filtered clicks decreased",kind:"negative"};
  }else{
    change={code:"stable",label:"No observed volume change",kind:"neutral"};
  }

  return {
    status:sufficient?"ready":"insufficient_coverage",
    latest_date:latest,
    comparison_days:days,
    minimum_coverage_days:minimumCoverage,
    current,
    previous,
    deltas,
    change,
    disclaimer:
      "Trend compares observed first-party Search Analytics windows filtered by the manually selected searchAppearance. Missing days reduce confidence; changes do not prove a site action caused them.",
  };
}
