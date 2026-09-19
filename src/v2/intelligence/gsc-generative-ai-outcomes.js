function finite(value){
  if(value===null||value===undefined||value==="")return null;
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}

function percent(current,previous){
  if(previous===0)return current===0?0:null;
  return Math.round(((current-previous)/previous)*1000)/10;
}

export function summarizeGscGenerativeWorkflowOutcome({
  event,
  link,
  pre,
  post,
  windowDays=7,
}={}){
  const target=Math.max(3,Math.min(14,Number(windowDays)||7));
  const minimum=Math.max(2,Math.ceil(target*0.5));
  const before={
    days:Number(pre?.days??0),
    clicks:Number(pre?.clicks??0),
    impressions:Number(pre?.impressions??0),
  };
  const after={
    days:Number(post?.days??0),
    clicks:Number(post?.clicks??0),
    impressions:Number(post?.impressions??0),
  };

  let status;
  if(before.days<minimum)status="insufficient_baseline";
  else if(after.days===0)status="waiting_for_post_data";
  else if(after.days<minimum)status="collecting_post_data";
  else status="ready";

  const changes={
    clicks:after.clicks-before.clicks,
    impressions:after.impressions-before.impressions,
    clicks_percent:percent(after.clicks,before.clicks),
    impressions_percent:percent(after.impressions,before.impressions),
  };

  let observed;
  if(status!=="ready"){
    observed={
      code:status,
      label:status==="waiting_for_post_data"
        ?"Waiting for first-party post data"
        :status==="collecting_post_data"
          ?"Collecting first-party post data"
          :"Need first-party baseline",
      kind:"neutral",
    };
  }else if(before.impressions===0&&after.impressions>0){
    observed={code:"visibility_recovered",label:"Filtered visibility recovered",kind:"positive"};
  }else if(before.impressions>0&&after.impressions===0){
    observed={code:"visibility_lost",label:"Filtered visibility is absent",kind:"negative"};
  }else if(changes.impressions>0){
    observed={code:"impressions_up",label:"Filtered impressions increased",kind:"positive"};
  }else if(changes.impressions<0){
    observed={code:"impressions_down",label:"Filtered impressions decreased",kind:"negative"};
  }else if(changes.clicks>0){
    observed={code:"clicks_up",label:"Filtered clicks increased",kind:"positive"};
  }else if(changes.clicks<0){
    observed={code:"clicks_down",label:"Filtered clicks decreased",kind:"negative"};
  }else{
    observed={code:"stable",label:"No observed volume change",kind:"neutral"};
  }

  return {
    workflow_id:Number(event?.workflow_id??0),
    event_id:Number(event?.event_id??0),
    action_code:event?.action_code??"gsc_generative_recovery",
    page_url:event?.page_url??null,
    completed_at:event?.created_at??null,
    property:link?.property??null,
    appearance:link?.appearance_value??null,
    scope:"property_global",
    status,
    coverage:{before_days:before.days,after_days:after.days,target_days:target,minimum_days:minimum},
    before,
    after,
    change:changes,
    observed,
    disclaimer:
      "Outcome compares first-party Search Analytics filtered by the workflow-linked searchAppearance before and after completion. It is observational and does not prove the workflow action caused the change.",
  };
}
