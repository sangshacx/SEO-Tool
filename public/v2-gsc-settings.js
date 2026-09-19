const STATUS_ENDPOINT="/api/v2/gsc/status";
const PROPERTIES_ENDPOINT="/api/v2/gsc/properties";
const MAPPINGS_ENDPOINT="/api/v2/gsc/mappings";
const DISCONNECT_ENDPOINT="/api/v2/gsc/disconnect";
const GENERATIVE_AI_ENDPOINT="/api/v2/gsc/generative-ai";

export function gscPropertiesForDomain(properties, domain) {
  const normalized=String(domain||"").trim().toLowerCase().replace(/^www\./,"");
  return (Array.isArray(properties)?properties:[]).filter((item)=>item?.verified!==false&&String(item?.domain||"").toLowerCase()===normalized);
}

export function createGscSettingsWorkspace(documentLike=document) {
  const section=documentLike.createElement("section");
  section.className="panel v2-gsc-settings";
  section.dataset.v2View="settings";
  section.innerHTML=`
    <div class="v2-gsc-hero">
      <div>
        <div class="v2-gsc-eyebrow">GOOGLE SEARCH CONSOLE · READ ONLY</div>
        <h2>Google Search Console</h2>
        <p>连接真实 Clicks、Impressions、CTR 和 Average Position。SEO Pro V2 只申请 webmasters.readonly，不会修改你的 Search Console。</p>
      </div>
      <span class="v2-gsc-state" data-v2-gsc-state>CHECKING</span>
    </div>
    <div class="v2-gsc-status" data-v2-gsc-status role="status">正在读取连接状态…</div>
    <div class="v2-gsc-actions">
      <button type="button" data-v2-gsc-connect>Connect Google Search Console</button>
      <button type="button" data-v2-gsc-refresh>Refresh Properties</button>
      <button type="button" class="secondary" data-v2-gsc-disconnect>Disconnect</button>
    </div>
    <div class="v2-gsc-grid">
      <article><span>Permission</span><b>Read only</b><small>webmasters.readonly</small></article>
      <article><span>Current Site</span><b data-v2-gsc-site>—</b><small data-v2-gsc-site-state>No property mapped</small></article>
      <article><span>Connected</span><b data-v2-gsc-connected-at>—</b><small>Refresh token encrypted in D1</small></article>
    </div>
    <div class="v2-gsc-mapping">
      <div>
        <b>Search Console Property</b>
        <span>只显示与当前 Site Profile 根域名匹配、且当前 Google 账号有权限的 Property。</span>
      </div>
      <select data-v2-gsc-property aria-label="Search Console Property"><option value="">Load properties first</option></select>
      <button type="button" data-v2-gsc-map>Map to Current Site</button>
      <button type="button" class="secondary" data-v2-gsc-unmap>Remove Mapping</button>
    </div>
    <div class="v2-gsc-ai-discovery">
      <div class="v2-gsc-ai-head">
        <div>
          <b>Generative AI API Discovery</b>
          <span>先按官方要求查询 searchAppearance，再从当前 Property 实际返回的 raw value 中手工选择。不会硬编码未公开的 AI filter。</span>
        </div>
        <strong data-v2-gsc-ai-state>NOT DISCOVERED</strong>
      </div>
      <div class="v2-gsc-ai-controls">
        <button type="button" data-v2-gsc-ai-discover>Discover Search Appearances · $0</button>
        <select data-v2-gsc-ai-appearance aria-label="Generative AI Search Appearance"><option value="">Discover first</option></select>
        <button type="button" data-v2-gsc-ai-select>Use Selected Value · $0</button>
        <button type="button" class="secondary" data-v2-gsc-ai-clear>Clear</button>
      </div>
      <div class="v2-gsc-ai-note" data-v2-gsc-ai-note>需要先连接并映射 Search Console Property。Discovery 会发 1 次 Google Search Console API 请求，费用 $0。</div>
    </div>
    <div class="v2-gsc-meta" data-v2-gsc-meta>OAuth state 10 min · refresh token AES-GCM · Google API cost $0</div>
  `;
  return section;
}

async function jsonFetch(fetchImpl,url,options={}) {
  const response=await fetchImpl(url,{...options,headers:{accept:"application/json",...(options.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.ok){const error=new Error(payload?.error?.message||"GSC request failed");error.code=payload?.error?.code;error.status=response.status;throw error;}
  return payload;
}

export function mountGscSettings({root,context,fetchImpl=globalThis.fetch,locationLike=globalThis.location,historyLike=globalThis.history}={}) {
  const section=root?.querySelector?.(".v2-gsc-settings");
  if(!section||typeof fetchImpl!=="function")return()=>{};
  const controller=new AbortController(),signal=controller.signal;
  const stateBadge=section.querySelector("[data-v2-gsc-state]");
  const status=section.querySelector("[data-v2-gsc-status]");
  const connect=section.querySelector("[data-v2-gsc-connect]");
  const refresh=section.querySelector("[data-v2-gsc-refresh]");
  const disconnect=section.querySelector("[data-v2-gsc-disconnect]");
  const site=section.querySelector("[data-v2-gsc-site]");
  const siteState=section.querySelector("[data-v2-gsc-site-state]");
  const connectedAt=section.querySelector("[data-v2-gsc-connected-at]");
  const propertySelect=section.querySelector("[data-v2-gsc-property]");
  const mapButton=section.querySelector("[data-v2-gsc-map]");
  const unmapButton=section.querySelector("[data-v2-gsc-unmap]");
  const meta=section.querySelector("[data-v2-gsc-meta]");
  const aiDiscover=section.querySelector("[data-v2-gsc-ai-discover]");
  const aiAppearance=section.querySelector("[data-v2-gsc-ai-appearance]");
  const aiSelect=section.querySelector("[data-v2-gsc-ai-select]");
  const aiClear=section.querySelector("[data-v2-gsc-ai-clear]");
  const aiState=section.querySelector("[data-v2-gsc-ai-state]");
  const aiNote=section.querySelector("[data-v2-gsc-ai-note]");
  let connection={connected:false,mappings:[],oauth_configured:false};
  let properties=[];
  let aiCapability={items:[],selected_appearance:null,discovered:false,mapped:false,sync_enabled:false};

  const currentDomain=()=>String(context?.get?.()?.domain||"").trim().toLowerCase();
  const currentMapping=()=>connection.mappings?.find((item)=>item.site_domain===currentDomain())||null;
  const setStatus=(message,state="info")=>{status.textContent=message;status.dataset.state=state;};

  const renderAiCapability=()=>{
    const mapping=currentMapping();
    const rows=Array.isArray(aiCapability?.items)?aiCapability.items:[];
    aiAppearance.replaceChildren(new Option(
      rows.length?"Select discovered raw value":"Discover first",
      ""
    ));
    rows.forEach((item)=>{
      const labels=[
        item.appearance,
        item.generative_ai_candidate?"candidate hint":null,
        Number.isFinite(Number(item.impressions))?Number(item.impressions).toLocaleString()+" impressions":null,
      ].filter(Boolean);
      aiAppearance.add(new Option(labels.join(" · "),item.appearance));
    });
    if(aiCapability?.selected_appearance&&rows.some((item)=>item.appearance===aiCapability.selected_appearance)){
      aiAppearance.value=aiCapability.selected_appearance;
    }

    const mapped=Boolean(mapping);
    const selected=aiCapability?.selected_appearance||null;
    aiState.textContent=!mapped
      ?"MAP PROPERTY"
      :!rows.length
        ?"NOT DISCOVERED"
        :selected
          ?"SELECTED"
          :"SELECT VALUE";
    aiState.dataset.state=selected?"selected":rows.length?"discovered":"empty";
    aiDiscover.disabled=!connection.connected||!mapped;
    aiAppearance.disabled=!mapped||!rows.length;
    aiSelect.disabled=!mapped||!aiAppearance.value;
    aiClear.disabled=!selected;
    aiNote.textContent=!mapped
      ?"需要先映射当前网站的 Search Console Property。"
      :!rows.length
        ?"尚未发现 searchAppearance。点击 Discover 会发 1 次 Google API 请求，费用 $0。"
        :selected
          ?"已选择 raw value: "+selected+"。Generative AI 同步门已就绪，但本阶段不会自动抓取明细。"
          :"已发现 "+rows.length+" 个 searchAppearance；请选择一个 raw value。candidate hint 只是提示，不会自动启用。";
  };

  const render=()=>{
    const domain=currentDomain();
    const mapping=currentMapping();
    site.textContent=domain||"—";
    siteState.textContent=mapping?mapping.property:"No property mapped";
    connectedAt.textContent=connection.connected_at?new Date(connection.connected_at).toLocaleDateString("zh-CN"):"—";
    stateBadge.textContent=connection.connected?"CONNECTED":connection.oauth_configured?"READY":"SETUP REQUIRED";
    stateBadge.dataset.state=connection.connected?"connected":connection.oauth_configured?"ready":"setup";
    connect.disabled=connection.connected||!connection.oauth_configured;
    refresh.disabled=!connection.connected;
    disconnect.disabled=!connection.connected;
    mapButton.disabled=!connection.connected||!propertySelect.value||Boolean(mapping);
    unmapButton.disabled=!mapping;
    meta.textContent=[connection.scope||"webmasters.readonly","OAuth state 10 min","AES-GCM encrypted refresh token","Google API cost $0"].filter(Boolean).join(" · ");
    renderAiCapability();
  };

  const renderProperties=()=>{
    const domain=currentDomain();
    const rows=gscPropertiesForDomain(properties,domain);
    const mapping=currentMapping();
    propertySelect.replaceChildren(new Option(rows.length?"Select a property":"No matching property",""));
    rows.forEach((item)=>propertySelect.add(new Option(item.property+" · "+(item.permission_level||"access"),item.property)));
    if(mapping&&rows.some((item)=>item.property===mapping.property))propertySelect.value=mapping.property;
    render();
  };

  const loadStatus=async()=>{
    try{
      const payload=await jsonFetch(fetchImpl,STATUS_ENDPOINT);
      connection=payload.data||connection;
      const params=new URLSearchParams(locationLike?.search||"");
      if(params.get("gsc")==="connected")setStatus("Google Search Console 已连接。现在可以加载 Property 并映射当前网站。","success");
      else if(params.get("gsc")==="error")setStatus("Google OAuth 未完成："+(params.get("code")||"unknown error"),"error");
      else if(connection.connected)setStatus("GSC 已连接；所有 API 操作为只读。","success");
      else if(!connection.oauth_configured)setStatus("服务器尚未配置 Google OAuth Client ID / Secret / 加密密钥。配置完成后无需再改代码。","warning");
      else setStatus("OAuth 已配置，可以连接 Google Search Console。","info");
      if(params.has("gsc")&&historyLike?.replaceState){const clean=new URL(locationLike.href);clean.searchParams.delete("gsc");clean.searchParams.delete("code");historyLike.replaceState({}, "", clean.pathname+clean.search+clean.hash);}
      renderProperties();
    }catch(error){setStatus(error.message||"无法读取 GSC 状态","error");}
  };

  const loadProperties=async()=>{
    refresh.disabled=true;setStatus("正在读取 Search Console Properties…","info");
    try{const payload=await jsonFetch(fetchImpl,PROPERTIES_ENDPOINT);properties=payload.data?.properties||[];connection.mappings=payload.data?.mappings||connection.mappings;renderProperties();setStatus("Property 已读取：仅显示当前站点可匹配项。","success");}
    catch(error){setStatus(error.message||"Property 加载失败","error");}
    finally{refresh.disabled=!connection.connected;}
  };

  const loadAiCapability=async()=>{
    const domain=currentDomain();
    if(!domain){aiCapability={items:[],selected_appearance:null,discovered:false,mapped:false,sync_enabled:false};renderAiCapability();return;}
    try{
      const payload=await jsonFetch(fetchImpl,GENERATIVE_AI_ENDPOINT+"?site_domain="+encodeURIComponent(domain));
      aiCapability=payload.data||aiCapability;
      renderAiCapability();
    }catch(error){
      aiCapability={items:[],selected_appearance:null,discovered:false,mapped:Boolean(currentMapping()),sync_enabled:false};
      renderAiCapability();
      if(error.status!==404)setStatus(error.message||"Generative AI capability 读取失败","error");
    }
  };

  const discoverAiCapability=async()=>{
    const domain=currentDomain();if(!domain||!currentMapping())return;
    aiDiscover.disabled=true;setStatus("正在按 searchAppearance 发现当前 Property 的能力；Google API 费用 $0…","info");
    try{
      const payload=await jsonFetch(fetchImpl,GENERATIVE_AI_ENDPOINT,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({site_domain:domain,action:"discover",days:90}),
      });
      aiCapability=payload.data||aiCapability;
      renderAiCapability();
      setStatus(
        "Search Appearance Discovery 完成：发现 "+(aiCapability.items?.length??0)+" 个值，候选提示 "+(payload.data?.candidate_count??0)+" 个；请手工确认 raw value。",
        "success"
      );
    }catch(error){setStatus(error.message||"Generative AI capability discovery 失败","error");renderAiCapability();}
    finally{renderAiCapability();}
  };

  const selectAiCapability=async(action="select")=>{
    const domain=currentDomain();if(!domain)return;
    const appearance=aiAppearance.value;
    if(action==="select"&&!appearance)return;
    aiSelect.disabled=true;aiClear.disabled=true;
    try{
      const payload=await jsonFetch(fetchImpl,GENERATIVE_AI_ENDPOINT,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({site_domain:domain,action,...(action==="select"?{appearance}:{})}),
      });
      aiCapability=payload.data||aiCapability;
      renderAiCapability();
      setStatus(
        action==="clear"
          ?"Generative AI raw filter 已清除，本次费用 $0。"
          :"已保存 Generative AI raw filter: "+aiCapability.selected_appearance+"，本次费用 $0。",
        "success"
      );
    }catch(error){setStatus(error.message||"Generative AI filter 保存失败","error");renderAiCapability();}
  };



  connect.addEventListener("click",()=>{if(!connect.disabled)locationLike.assign("/api/v2/gsc/connect/start");},{signal});
  refresh.addEventListener("click",loadProperties,{signal});
  propertySelect.addEventListener("change",render,{signal});
  mapButton.addEventListener("click",async()=>{
    const domain=currentDomain(),property=propertySelect.value;if(!domain||!property)return;
    mapButton.disabled=true;setStatus("正在验证并映射 Property…","info");
    try{const payload=await jsonFetch(fetchImpl,MAPPINGS_ENDPOINT,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({site_domain:domain,property})});connection.mappings=[...(connection.mappings||[]).filter((item)=>item.site_domain!==domain),payload.data];renderProperties();await loadAiCapability();setStatus("当前网站已映射到 "+payload.data.property+"。","success");}
    catch(error){setStatus(error.message||"Property 映射失败","error");render();}
  },{signal});
  unmapButton.addEventListener("click",async()=>{
    const domain=currentDomain();if(!domain)return;unmapButton.disabled=true;
    try{await jsonFetch(fetchImpl,MAPPINGS_ENDPOINT,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({site_domain:domain})});connection.mappings=(connection.mappings||[]).filter((item)=>item.site_domain!==domain);aiCapability={...aiCapability,mapped:false,sync_enabled:false};renderProperties();setStatus("当前网站的 GSC 映射已移除。","success");}
    catch(error){setStatus(error.message||"移除映射失败","error");render();}
  },{signal});
  disconnect.addEventListener("click",async()=>{
    if(globalThis.confirm&&!globalThis.confirm("断开 Google Search Console？本地加密凭据与所有站点映射都会删除。"))return;
    disconnect.disabled=true;setStatus("正在断开 Google Search Console…","info");
    try{const payload=await jsonFetch(fetchImpl,DISCONNECT_ENDPOINT,{method:"POST"});connection={connected:false,mappings:[],oauth_configured:connection.oauth_configured};properties=[];aiCapability={items:[],selected_appearance:null,discovered:false,mapped:false,sync_enabled:false};renderProperties();setStatus(payload.data?.revoke_warning||"Google Search Console 已断开。",payload.data?.revoke_warning?"warning":"success");}
    catch(error){setStatus(error.message||"断开失败","error");render();}
  },{signal});
  aiDiscover.addEventListener("click",discoverAiCapability,{signal});
  aiAppearance.addEventListener("change",renderAiCapability,{signal});
  aiSelect.addEventListener("click",()=>selectAiCapability("select"),{signal});
  aiClear.addEventListener("click",()=>selectAiCapability("clear"),{signal});
  const unsubscribe=context?.subscribe?.(()=>{renderProperties();loadAiCapability();})??(()=>{});
  loadStatus().then?.(()=>loadAiCapability());
  return()=>{unsubscribe();controller.abort();};
}
