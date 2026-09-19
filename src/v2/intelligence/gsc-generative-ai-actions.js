function finite(value){
  if(value===null||value===undefined||value==="")return null;
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}

function declinePercent(trend={}){
  const value=finite(trend?.deltas?.impressions_percent);
  return value===null?null:Math.abs(Math.min(0,value));
}

export function buildGscGenerativeAiRecoveryAction({
  target,
  selectedAppearance,
  summary,
}={}){
  const domain=String(target??"").trim().toLowerCase();
  const appearance=String(selectedAppearance??summary?.appearance??"").trim();
  const trend=summary?.trend??null;
  if(!domain||!appearance||trend?.status!=="ready")return null;

  const code=trend?.change?.code;
  const previousImpressions=finite(trend?.previous?.impressions)??0;
  const currentImpressions=finite(trend?.current?.impressions)??0;
  const previousCoverage=finite(trend?.previous?.coverage_days)??0;
  const currentCoverage=finite(trend?.current?.coverage_days)??0;
  let priority=null;
  let confidence=null;
  let actionLabel=null;
  let reason=null;

  if(code==="visibility_lost"&&previousImpressions>0&&currentImpressions===0){
    priority=Math.min(88,78+(previousImpressions>=500?8:previousImpressions>=100?5:2));
    confidence=previousCoverage>=6&&currentCoverage>=6?"high":"medium";
    actionLabel="Review lost first-party AI visibility";
    reason=
      "Selected GSC searchAppearance had "+previousImpressions+
      " filtered impressions in the previous comparable window and 0 in the current window.";
  }else if(
    code==="impressions_down"&&
    previousImpressions>=100&&
    currentImpressions<=previousImpressions*0.5
  ){
    const drop=declinePercent(trend)??0;
    priority=Math.min(82,70+Math.round(Math.min(12,drop/10)));
    confidence=previousImpressions>=500&&previousCoverage>=6&&currentCoverage>=6?"high":"medium";
    actionLabel="Review major first-party AI visibility decline";
    reason=
      "Selected GSC searchAppearance filtered impressions fell from "+previousImpressions+
      " to "+currentImpressions+" ("+drop+"% decrease) across comparable windows.";
  }else{
    return null;
  }

  return {
    rank:null,
    workstream:"gsc_generative_recovery",
    page:"https://"+domain+"/",
    action:"gsc_generative_recovery",
    action_label:actionLabel,
    priority_score:priority,
    confidence,
    query:"GSC Generative · "+appearance,
    query_source:"gsc_generative_ai_d1",
    why_now:
      reason+
      " This is property-global first-party evidence, not the currently selected market. Review the trend and affected pages before changing content; this observation does not establish causality.",
    evidence:{
      appearance,
      latest_date:summary?.latest_date??trend?.latest_date??null,
      current_impressions:currentImpressions,
      previous_impressions:previousImpressions,
      impressions_delta:finite(trend?.deltas?.impressions),
      impressions_delta_percent:finite(trend?.deltas?.impressions_percent),
      current_clicks:finite(trend?.current?.clicks)??0,
      previous_clicks:finite(trend?.previous?.clicks)??0,
      current_coverage_days:currentCoverage,
      previous_coverage_days:previousCoverage,
      comparison_days:finite(trend?.comparison_days)??7,
      change_code:code,
      top_page:summary?.pages?.[0]?.key??null,
      scope:"property_global",
    },
  };
}

export function mergeGscGenerativeAiActions(data={},candidates=[],{limit=25}={}){
  const existing=Array.isArray(data?.action_queue)?data.action_queue:[];
  const additions=(Array.isArray(candidates)?candidates:[]).filter(Boolean);
  const seen=new Set();
  const combined=[...existing,...additions].filter((item)=>{
    const key=[item.page,item.action,item.query||""].join("\n");
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
  combined.sort((a,b)=>
    (finite(b.priority_score)??0)-(finite(a.priority_score)??0)||
    String(a.page||"").localeCompare(String(b.page||""))||
    String(a.action||"").localeCompare(String(b.action||""))
  );
  const bounded=combined.slice(0,Math.max(1,Number(limit)||25))
    .map((item,index)=>({...item,rank:index+1}));
  return {
    ...data,
    action_queue:bounded,
    next_best_action:bounded[0]??data.next_best_action??null,
    supplemental_signals:{
      ...(data.supplemental_signals??{}),
      gsc_generative_ai:{
        candidate_count:additions.length,
        model:"gsc-generative-recovery-v0.1",
        disclaimer:
          "First-party Generative AI recovery candidates use only manually selected searchAppearance-filtered GSC data with comparable coverage. They are review prompts, not causal claims.",
      },
    },
  };
}
