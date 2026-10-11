'use strict';
/* CAP Inventory PWA - direct CAPWATCH API request and encrypted device-only data. No intermediary application server. */
const $=id=>document.getElementById(id);
const ASSET_COLS='assetcd stkcls noun make model descrp sernum region wing unit dept inserv cost docnum fstusr fstdtm lstusr lstdtm remarks barcode nsn demil hazmat ORGID acqdate source location owner status demilinstructions PCN Encryption TrackedExpendable GreenFlag IssuedCAPID IssuedDate IssueAcceptDate'.split(' ');
const HISTORY_COLS='stkcls noun make model descrp sernum region wing unit dept inserv cost docnum fstusr fstdtm lstusr lstdtm trnusr trndtm trntyp rec_id histid remarks barcode nsn demil hazmat ORGID acqdate source location owner status demilinstructions PCN Encryption TrackedExpendable GreenFlag IssuedCAPID IssuedDate IssueAcceptDate'.split(' ');
const KDF_ITERATIONS=350000,DB_NAME='cap-equipment-inventory-v1';
let db=null,key=null,state=null,saveQueue=Promise.resolve(),cameraStream=null,scanTimer=null,nativeDetector=null,scanBusy=false,frameBusy=false,scanFeedbackTimer=null,lastCode='',lastCodeAt=0,scanCandidate='',scanCandidateCount=0,scanCandidateAt=0,pendingUnknown=null,activePage='dashboard',equipmentFilter='outstanding',imageUrls=[],installPrompt=null,toastTimer=null;
const enc=new TextEncoder(),dec=new TextDecoder();
const copy=e=>JSON.parse(JSON.stringify(e));
const stamp=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const str=v=>String(v??'').trim();
const norm=v=>str(v).toUpperCase().replace(/^\*(.*)\*$/,'$1');
const tagKey=v=>norm(v).replace(/[^A-Z0-9]/g,'');
function equivalentTagKeys(value){const code=tagKey(value),keys=new Set();if(!code)return keys;keys.add(code);if(/^CAP\d{6,10}$/.test(code))keys.add(code.slice(3));if(/^\d{6,10}$/.test(code))keys.add('CAP'+code);return keys}
function assetTagKeys(a){const keys=new Set();for(const val of [a.barcode,a.assetcd])for(const k of equivalentTagKeys(val))keys.add(k);return keys}
function sameTag(a,code){const lookup=tagKey(code);return lookup&&assetTagKeys(a).has(lookup)}
const displayTime=t=>t?new Date(t).toLocaleString(): '—';
const humanNumber=n=>Number(n||0).toLocaleString();
const filenameSafe=x=>str(x).replace(/[^a-z0-9_-]/gi,'_').slice(0,60)||'inventory';
const u8=arr=>arr instanceof Uint8Array?arr:new Uint8Array(arr);
const b64=bytes=>{let s='',a=u8(bytes);for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function notify(message,duration=4300){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,duration)}
function errorMessage(e){console.error(e);notify(e?.message||String(e),6500)}
async function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const d=req.result;for(const n of ['meta','vault','photos'])if(!d.objectStoreNames.contains(n))d.createObjectStore(n,{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
const dbCall=(store,method,record)=>new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite'),rq=tx.objectStore(store)[method](record);rq.onsuccess=()=>resolve(rq.result);rq.onerror=()=>reject(rq.error)});
const get=(store,k)=>dbCall(store,'get',k);
const put=(store,v)=>dbCall(store,'put',v);
const del=(store,k)=>dbCall(store,'delete',k);
const getAll=store=>dbCall(store,'getAll');
async function deriveKey(pass,salt,iterations=KDF_ITERATIONS){const base=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:u8(salt),iterations,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function seal(data,useKey=key){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},useKey,typeof data==='string'?enc.encode(data):u8(data));return {iv,cipher:new Uint8Array(encrypted)}}
async function unseal(record,useKey=key){return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:u8(record.iv)},useKey,u8(record.cipher)))}
function newState(profile){return {version:1,profile,assets:[],history:[],orgMap:{},sessions:[],scans:[],lastImport:null,prefs:{unit:'',session:''}}}
async function createAccount(name,capid,pass){const salt=crypto.getRandomValues(new Uint8Array(16));const vaultKey=await deriveKey(pass,salt),check=await seal('CAP_INVENTORY_V1',vaultKey);const initial=newState({name:str(name),capid:str(capid),deviceId:id()});const record=await seal(JSON.stringify(initial),vaultKey);
 await put('meta',{id:'config',salt:Array.from(salt),iterations:KDF_ITERATIONS,check});await put('vault',{id:'state',...record});key=vaultKey;state=initial;activateApp()}
async function unlock(pass){const config=await get('meta','config');if(!config)throw Error('This device is not set up yet.');const possible=await deriveKey(pass,config.salt,config.iterations);
 let verifier;try{verifier=dec.decode(await unseal(config.check,possible))}catch{throw Error('Incorrect passphrase. Please try again.')}
 if(verifier!=='CAP_INVENTORY_V1')throw Error('Incorrect passphrase.');const record=await get('vault','state');if(!record)throw Error('Encrypted inventory records are missing.');const decrypted=JSON.parse(dec.decode(await unseal(record,possible)));key=possible;state=decrypted;if(reconcileScanMatches())await persist();activateApp()}
function persist(){if(!state||!key)return Promise.resolve();const snapshot=JSON.stringify(state);saveQueue=saveQueue.catch(()=>{}).then(async()=>{const data=await seal(snapshot);await put('vault',{id:'state',...data})});return saveQueue}
async function storePhoto(blob){if(!blob)return null;const identifier=id(),data=new Uint8Array(await blob.arrayBuffer()),sealed=await seal(data);await put('photos',{id:identifier,...sealed,mime:blob.type||'image/jpeg',createdAt:stamp()});return identifier}
async function loadPhotoData(identifier){const photo=await get('photos',identifier);if(!photo)return null;return {blob:new Blob([await unseal(photo)],{type:photo.mime}),mime:photo.mime}}
async function photoUrl(identifier){if(!identifier)return null;try{const data=await loadPhotoData(identifier);if(!data)return null;const url=URL.createObjectURL(data.blob);imageUrls.push(url);return url}catch(e){console.warn(e);return null}}
function clearPhotoUrls(){for(const x of imageUrls)URL.revokeObjectURL(x);imageUrls=[]}
function lock(){pendingUnknown=null;stopCamera();clearPhotoUrls();state=null;key=null;activePage='dashboard';$('app').hidden=true;$('detailOverlay').hidden=true;$('authScreen').hidden=false;$('loginForm').hidden=false;$('setupForm').hidden=true;$('loginForm').reset();$('authStatus').hidden=true}
function getUnit(){return state?.prefs?.unit||''}
function getSession(){return state?.sessions.find(s=>s.id===state.prefs.session&&s.orgid===getUnit())||null}
function assetsInUnit(orgid=getUnit()){return state?.assets.filter(a=>str(a.ORGID)===str(orgid))||[]}
function scansForSession(){const ses=getSession();return ses?state.scans.filter(s=>s.sessionId===ses.id):[]}
function nameForUnit(orgid){return str(state.orgMap[str(orgid)])||`ORGID ${orgid||'(blank)'}`}
function unitIds(){return [...new Set(state.assets.map(a=>str(a.ORGID)))].sort((a,b)=>nameForUnit(a).localeCompare(nameForUnit(b),undefined,{numeric:true}))}
function keyForAsset(row,i){return norm(row.barcode)?`bc:${norm(row.barcode)}`:str(row.assetcd)?`asset:${str(row.assetcd)}`:str(row.sernum)?`serial:${norm(row.sernum)}:${str(row.docnum)}`:`row:${i}:${str(row.ORGID)}`}
function ensureSession(){const orgid=getUnit();if(!orgid)return null;let session=getSession();if(!session){session=state.sessions.filter(s=>s.orgid===orgid).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];if(!session){session={id:id(),orgid,name:`Inventory ${new Date().toLocaleDateString()}`,createdAt:stamp()};state.sessions.push(session)}state.prefs.session=session.id;persist()}return session}
function scanSummary(){const assets=assetsInUnit(),scans=scansForSession(),byBarcode=new Map(assets.filter(a=>norm(a.barcode)).map(a=>[norm(a.barcode),a])),verified=new Set(scans.filter(s=>s.assetKey&&s.result==='found').map(s=>s.assetKey));const unknown=scans.filter(s=>s.result==='unexpected');const latest=new Map();for(const e of scans){if(e.assetKey)latest.set(e.assetKey,e)}return {assets,scans,verified,unknown,latest,byBarcode,total:assets.length,found:assets.filter(a=>verified.has(a._key)).length,remaining:assets.filter(a=>!verified.has(a._key)).length}}
function refreshUnitDropdown(){const el=$('unitSelect'),units=unitIds();if(!units.includes(state.prefs.unit))state.prefs.unit=units[0]||'';el.innerHTML=units.length?units.map(u=>`<option value="${esc(u)}">${esc(nameForUnit(u))}</option>`).join(''):'<option value="">No equipment imported</option>';el.value=state.prefs.unit||''}
function refreshSessionDropdown(){const el=$('sessionSelect'),unit=getUnit();let sessions=state.sessions.filter(s=>s.orgid===unit).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));if(!sessions.some(s=>s.id===state.prefs.session))state.prefs.session=sessions[0]?.id||'';el.innerHTML=sessions.length?sessions.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''):'<option value="">No session yet</option>';el.value=state.prefs.session||''}
function render(){if(!state)return;refreshUnitDropdown();refreshSessionDropdown();renderDashboard();renderEquipment();renderSessions();renderMapping();renderSettings();}
function navigate(page){if(!state)return;activePage=page;for(const e of document.querySelectorAll('.page'))e.classList.toggle('active',e.id===`page-${page}`);for(const b of document.querySelectorAll('.bottomnav button'))b.classList.toggle('selected',b.dataset.go===page);if(page==='dashboard')renderDashboard();if(page==='equipment')renderEquipment();if(page==='sessions')renderSessions();if(page==='settings')renderSettings();if(page!=='scan')stopCamera();window.scrollTo(0,0)}
function activateApp(){$('authScreen').hidden=true;$('app').hidden=false;$('profileText').textContent=state.profile.name||'Local inventory officer';render();navigate('dashboard');notify('Encrypted local inventory unlocked.')}
function renderDashboard(){if(!state)return;const s=scanSummary(),ses=getSession();$('emptyNotice').hidden=state.assets.length!==0;$('dashboardSubtitle').textContent=`${nameForUnit(getUnit())} • ${ses?.name||'No session'} • ${s.total.toLocaleString()} assigned items`;
 $('statTotal').textContent=humanNumber(s.total);$('statFound').textContent=humanNumber(s.found);$('statRemaining').textContent=humanNumber(s.remaining);$('statUnexpected').textContent=humanNumber(s.unknown.length);const pct=s.total?Math.round(s.found/s.total*100):0;$('progressPct').textContent=`${pct}%`;$('progressBar').style.width=pct+'%';$('progressLabel').textContent=`${s.found.toLocaleString()} of ${s.total.toLocaleString()} items verified in this inventory. “Not scanned” does not necessarily mean lost.`;
 $('recentScans').innerHTML=s.scans.length?[...s.scans].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,8).map(e=>`<div class="record"><span class="badge ${e.result==='found'?'found':'unexpected'}">${e.result==='found'?'✓':'!'}</span><div class="record-body"><strong>${esc(e.barcode)}</strong><small>${esc(e.by?.name||'Unknown')} • ${esc(displayTime(e.at))}${e.photoId?' • 📷':''}</small></div></div>`).join(''):'<p class="empty-record">No scans for this session yet. Open Scan to begin.</p>'}
function createAssetRow(a,s){let last=s.latest.get(a._key);const found=s.verified.has(a._key);return `<button class="record" data-item="${esc(a._key)}"><span class="badge ${found?'found':'missing'}">${found?'Verified':'Not scanned'}</span><div class="record-body"><strong>${esc(a.noun||a.descrp||'Equipment')} ${a.make?`· ${esc(a.make)}`:''}</strong><small>${esc(a.barcode||'No barcode')} • ${esc(a.model||'No model')} • ${esc(a.sernum||'No serial')}</small><small>${esc(a.location||'No location')} ${last?' • '+esc(last.by?.name||''):''}</small></div><span class="right">›</span></button>`}
function renderEquipment(){if(!state)return;const s=scanSummary(),search=norm($('equipmentSearch').value),filter=equipmentFilter;let rows=s.assets;
 if(filter==='outstanding')rows=rows.filter(a=>!s.verified.has(a._key));else if(filter==='found')rows=rows.filter(a=>s.verified.has(a._key));else if(filter==='unexpected')rows=[];
 if(search)rows=rows.filter(a=>[a.barcode,a.assetcd,a.noun,a.descrp,a.make,a.model,a.sernum,a.location,a.PCN].some(v=>norm(v).includes(search)));
 rows=[...rows].sort((a,b)=>str(a.noun).localeCompare(str(b.noun))||str(a.barcode).localeCompare(str(b.barcode)));
 for(const btn of document.querySelectorAll('#equipmentFilters button'))btn.classList.toggle('selected',btn.dataset.filter===filter);
 $('equipmentCount').textContent=`${rows.length.toLocaleString()} item${rows.length===1?'':'s'} • ${filter==='outstanding'?'not yet scanned':filter==='found'?'verified':filter==='all'?'all assigned':'not in equipment list'}`;
 $('equipmentList').innerHTML=filter==='unexpected'?(()=>{let events=s.unknown;if(search)events=events.filter(e=>norm(e.barcode).includes(search));$('equipmentCount').textContent=`${events.length} unexpected scan(s)`;return events.map(e=>`<div class="record"><span class="badge unexpected">Unknown</span><div class="record-body"><strong>${esc(e.barcode)}</strong><small>${esc(e.by?.name||'Unknown')} · ${esc(displayTime(e.at))}</small></div><button class="btn subtle mini" data-unexpected="${esc(e.id)}">View</button><button class="btn subtle mini" data-delete-unexpected="${esc(e.id)}">Delete</button></div>`).join('')||'<p class="empty-record">No unexpected barcode scans for this session.</p>'})():rows.map(a=>createAssetRow(a,s)).join('')||'<p class="empty-record">No equipment in this view.</p>'}
function renderSessions(){if(!state)return;const sessions=state.sessions.filter(s=>s.orgid===getUnit()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));$('sessionsList').innerHTML=sessions.map(s=>{let hits=state.scans.filter(x=>x.sessionId===s.id&&x.result==='found').length;return `<button class="record" data-session-id="${esc(s.id)}"><span class="badge ${s.id===getSession()?.id?'found':''}">${s.id===getSession()?.id?'Active':'Session'}</span><span class="record-body"><strong>${esc(s.name)}</strong><small>${esc(displayTime(s.createdAt))} • ${hits} verification event(s)</small></span><span class="right">›</span></button>`}).join('')||'<p class="empty-record">No inventory yet. Create one above.</p>'}
function renderMapping(){if(!state)return;const orgs=unitIds();$('mappingList').innerHTML=orgs.length?orgs.map(o=>{const example=state.assets.find(a=>str(a.ORGID)===o);const desc=`${example?.region||'?'} / ${example?.wing||'?'} / ${example?.unit||'?'}`;return `<div class="mapping-row"><strong>${esc(o||'(blank)')}</strong><input data-mapping="${esc(o)}" placeholder="RMR-MT-001" value="${esc(state.orgMap[o]||'')}"><small>CAPWATCH region / wing / unit: ${esc(desc)}</small></div>`}).join(''):'<p class="empty-record">Import equipment first to see its ORGIDs.</p>'}
function renderSettings(){if(!state)return;$('importStatus').textContent=state.lastImport?`Last import: ${displayTime(state.lastImport.at)} • ${humanNumber(state.lastImport.assets)} items • ${humanNumber(state.lastImport.history)} history entries`:'No CAPWATCH equipment imported yet.';
 $('accountSummary').textContent=`Local operator: ${state.profile.name||'Unknown'}${state.profile.capid?' (CAPID '+state.profile.capid+')':''}. eServices passwords are never stored. Use your eServices password to unlock the encrypted inventory while offline.`;updateStorage()}
async function updateStorage(){if(!navigator.storage?.estimate)return;try{let e=await navigator.storage.estimate();$('storageStatus').textContent=`Device storage used by this origin: ${(e.usage/1048576).toFixed(1)} MB • Browser quota: ${(e.quota/1048576).toFixed(0)} MB. Photos and reports are encrypted locally.`}catch{}}
/* Robust RFC4180-ish CSV / TXT reader. No numeric conversion; blank values stay strings. */
function parseDelimited(text){const result=[];let row=[],cell='',quoted=false;const source=String(text||'').replace(/^\uFEFF/,'');for(let i=0;i<source.length;i++){
 const c=source[i];if(quoted){if(c==='"'&&source[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c;continue}
 if(c==='"'&&cell===''){quoted=true;continue}if(c===','){row.push(cell);cell='';continue}if(c==='\n'||c==='\r'){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(x=>x!==''))result.push(row);row=[];continue}cell+=c;
 }row.push(cell);if(row.some(x=>x!==''))result.push(row);return result}
function parseFileRows(text,canonical){const records=parseDelimited(text);if(!records.length)throw Error('The selected file is empty.');const normHead=s=>str(s).replace(/[^a-z0-9]/gi,'').toLowerCase();const wanted=new Set(canonical.map(normHead));const first=records[0].map(normHead),score=first.filter(v=>wanted.has(v)).length;const hasHeader=score>=3;const names=hasHeader?records.shift().map(x=>str(x)):canonical;
 return records.map(row=>{const item={};for(let i=0;i<names.length;i++)item[names[i]||`field${i+1}`]=String(row[i]??'');const ci={};for(const [k,v] of Object.entries(item))ci[k.toLowerCase()]=v;for(const c of canonical)item[c]=ci[c.toLowerCase()]??item[c]??'';return item})}
function findZipEntry(zip,name){const candidates=Object.values(zip.files).filter(f=>!f.dir&&f.name.split('/').at(-1).toLowerCase()===name.toLowerCase());return candidates[0]||null}
async function importCapwatch(files){const chosen=Array.from(files);if(!chosen.length)throw Error('Choose CAPWATCH ZIP or text files.');let equipmentText=null,histText=null;
 for(const f of chosen){const lower=f.name.toLowerCase();if(lower.endsWith('.zip')){let zip;try{zip=await JSZip.loadAsync(await f.arrayBuffer())}catch{throw Error(`${f.name} is not a valid ZIP file.`)}const e=findZipEntry(zip,'equipment.txt'),h=findZipEntry(zip,'equipment_hst.txt');if(e)equipmentText=await e.async('string');if(h)histText=await h.async('string')}else if(lower==='equipment.txt'||lower==='equipment.csv')equipmentText=await f.text();else if(lower==='equipment_hst.txt'||lower==='equipment_hst.csv')histText=await f.text()}
 if(!equipmentText)throw Error('equipment.txt was not found. Select a CAPWATCH ZIP containing equipment.txt or select that TXT file.');const assetRows=parseFileRows(equipmentText,ASSET_COLS),history=histText?parseFileRows(histText,HISTORY_COLS):[];
 if(assetRows.length===0)throw Error('equipment.txt has no equipment rows.');const index=new Map();let repeated=0;const assets=assetRows.map((row,i)=>{let k=keyForAsset(row,i);if(index.has(k)){repeated++;k+=`#${i}`}index.set(k,true);return {...row,_key:k}});
 state.assets=assets;state.history=history;
 // Recheck imported equipment against existing scans without discarding exceptions.
 for(const e of state.scans){const matched=findAsset(e.barcode,e.orgid);if(matched.result==='found'){e.assetKey=matched.asset._key;e.result='found'}else{e.assetKey=null;e.result='unexpected'}}
 state.lastImport={at:stamp(),assets:assets.length,history:history.length,repeated};if(!state.prefs)state.prefs={unit:'',session:''};for(const a of assets)if(!(str(a.ORGID)in state.orgMap))state.orgMap[str(a.ORGID)]='';await persist();render();notify(`Imported ${assets.length.toLocaleString()} equipment items and ${history.length.toLocaleString()} history entries.${repeated?` ${repeated} duplicate identifiers; review data.`:''}`,7500)}
/* Direct credentialed CAPWATCH download. Browser CORS policy cannot be bypassed by a static PWA.
 * Credentials are held only in this call, not saved to IndexedDB, URLs, or reports.
 * The API returns a ZIP into phone/computer memory, then existing local importer encrypts records. */
const IS_NATIVE_ANDROID=location.hostname==='appassets.androidplatform.net';
const CAPWATCH_API=IS_NATIVE_ANDROID ? location.origin+'/capwatch-api/cw' : 'https://www.capnhq.gov/CAP.CapWatchAPI.Web/api/cw';
async function refreshCapwatchDirect(capid,password,orgid='394',unitOnly='0'){
  if(!navigator.onLine)throw Error('An internet connection is required to refresh CAPWATCH. Existing inventory remains available offline.');
  if(!/^\d+$/.test(str(capid)))throw Error('Enter your numeric CAPID.');
  if(!password)throw Error('Enter your eServices password.');
  if(!/^\d+$/.test(str(orgid)))throw Error('CAPWATCH ORGID must contain only digits.');
  if(!['0','1'].includes(String(unitOnly)))throw Error('Unit only must be 0 or 1.');
  const url=new URL(CAPWATCH_API);
  url.searchParams.set('ORGID',str(orgid));
  url.searchParams.set('unitOnly',String(unitOnly));
  const authorization='Basic '+btoa(Array.from(new TextEncoder().encode(`${capid}:${password}`),c=>String.fromCharCode(c)).join(''));
  let response;
  try {
    response=await fetch(url.toString(),{method:'GET',mode:'cors',credentials:'omit',headers:{Authorization:authorization,Accept:'application/zip, application/octet-stream, */*'},cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
  }catch(e){
    throw Error(IS_NATIVE_ANDROID?'The direct CAPWATCH download failed on this device. Check your internet connection and try again. No intermediary server is used.':'The browser could not read the CAPWATCH response. CAPWATCH may block cross-origin requests (CORS), or the connection may have failed. A GitHub Pages PWA cannot bypass this; use the Android APK for native downloads. No data was sent to a proxy.');
  }
  if(response.status===401||response.status===403)throw Error('CAPWATCH rejected the CAPID/password or access to this ORGID.');
  if(!response.ok)throw Error(`CAPWATCH responded with HTTP ${response.status}.`);
  const binary=await response.arrayBuffer();
  if(binary.byteLength<4)throw Error('CAPWATCH returned an empty response.');
  const sig=new Uint8Array(binary.slice(0,4));
  if(sig[0]!==0x50||sig[1]!==0x4b)throw Error('CAPWATCH did not return a ZIP. Confirm your credentials and authorized scope.');
  await importCapwatch([new File([binary],'CAPWATCH.zip',{type:'application/zip'})]);
  return {bytes:binary.byteLength,count:state.assets.length,history:state.history.length};
}
async function runCapwatchForm(form, statusEl){
  const f=new FormData(form),btn=form.querySelector('button[type="submit"]');
  if(state?.profile?.capid && str(f.get('capid'))!==str(state.profile.capid)) {errorMessage(Error('CAPID does not match this device vault.'));return false;}
  if(btn)btn.disabled=true;
  if(statusEl)statusEl.textContent='Connecting directly to CAPWATCH and downloading ZIP…';
  try{
    const r=await refreshCapwatchDirect(String(f.get('capid')||''),String(f.get('cwpassword')||''),String(f.get('orgid')||'394'),String(f.get('unitOnly')||'0'));
    if(statusEl)statusEl.textContent=`Success: ${humanNumber(r.count)} equipment records and ${humanNumber(r.history)} history events encrypted on this device. ZIP received: ${(r.bytes/1048576).toFixed(1)} MB.`;
    form.querySelector('[name="cwpassword"]').value='';
    notify('CAPWATCH equipment refreshed directly on this device.',7000);
    return true;
  }catch(e){if(statusEl)statusEl.textContent=e.message;errorMessage(e);return false}
  finally{if(btn)btn.disabled=false;const pwd=form.querySelector('[name="cwpassword"]');if(pwd)pwd.value=''}
}
function findAsset(barcode,orgid=getUnit()){
 const code=tagKey(barcode);
 if(!code)return {asset:null,result:'unexpected'};
 const matched=state.assets.filter(a=>sameTag(a,code));
 const inUnit=matched.filter(a=>str(a.ORGID)===str(orgid));
 if(inUnit.length===1)return {asset:inUnit[0],result:'found',duplicates:1};
 if(inUnit.length>1)return {asset:null,result:'ambiguous',duplicates:inUnit.length};
 if(matched.length)return {asset:null,result:'other-unit',other:[...new Set(matched.map(a=>nameForUnit(a.ORGID)))]};
 return {asset:null,result:'unexpected'};
}
function reconcileScanMatches(){
 if(!state?.assets?.length)return false;
 let changed=false;
 for(const e of state.scans){
   const match=findAsset(e.barcode,e.orgid);
   if(match.result!=='found')continue;
   if(e.assetKey!==match.asset._key||e.result!=='found'){e.assetKey=match.asset._key;e.result='found';changed=true}
 }
 return changed;
}
async function recordScan(barcode,options={}){
 const code=norm(barcode);if(!code)throw Error('Barcode is required.');if(!getUnit())throw Error('Import equipment and select a unit before scanning.');const session=ensureSession(),match=findAsset(code);let photoId=null;
 if(options.imageBlob)try{photoId=await storePhoto(options.imageBlob)}catch(e){console.error(e);notify('Barcode read, but photo could not be saved. Check device storage.',7000)}
 if(match.result==='ambiguous')throw Error(`This identifier matches ${match.duplicates} equipment records in this unit. Resolve the duplicate CAPWATCH records before verifying.`);const actualResult=match.result==='found'?'found':'unexpected';const e={id:id(),sessionId:session.id,orgid:getUnit(),barcode:code,assetKey:match.asset?match.asset._key:null,result:actualResult,at:stamp(),method:options.method||'manual',photoId,by:{name:state.profile.name,capid:state.profile.capid,deviceId:state.profile.deviceId},note:match.result==='other-unit'?`Barcode assigned to another unit: ${match.other.join(', ')}`:''};
 state.scans.push(e);await persist();renderDashboard();if(activePage==='equipment')renderEquipment();if(activePage==='sessions')renderSessions();$('lastScanBox').hidden=false;$('lastScanBox').classList.toggle('error',actualResult!=='found');
 const previous=state.scans.some(x=>x.id!==e.id&&x.sessionId===session.id&&x.barcode===code&&x.result==='found');const label=match.asset?.noun||match.asset?.descrp||'Equipment';$('lastScanBox').innerHTML=actualResult==='found'?`<h2>✓ ${previous?'Already verified — rescanned':'Equipment verified'}</h2><p><b>${esc(code)}</b> • ${esc(label)}</p><p class="hint">${esc(match.asset?.make||'')} ${esc(match.asset?.model||'')} • Serial: ${esc(match.asset?.sernum||'N/A')} • ${photoId?'Photo saved':'No photo'}</p><button class="btn subtle mini" data-item="${esc(match.asset._key)}">View equipment →</button>`:`<h2>⚠ ${match.result==='other-unit'?'Assigned to another unit':'Barcode not found'}</h2><p><b>${esc(code)}</b></p><p class="hint">${esc(e.note||'This barcode is not in the imported equipment list for the selected unit. Logged as an exception.')}${photoId?' • Photo saved':''}</p>`;
 notify(actualResult==='found'?`${code} verified${photoId?' • tag photo saved':''}`:`${code} logged as an exception`,5500);if(navigator.vibrate)navigator.vibrate(actualResult==='found'?60:[80,70,80]);return e}
async function captureFrame(){
 if(!cameraStream)return null;
 const video=$('cameraVideo');if(video.readyState<2)return null;
 const c=document.createElement('canvas'),max=1600,scale=Math.min(1,max/Math.max(video.videoWidth,video.videoHeight));
 c.width=Math.round(video.videoWidth*scale);c.height=Math.round(video.videoHeight*scale);
 c.getContext('2d').drawImage(video,0,0,c.width,c.height);
 return await new Promise(r=>c.toBlob(r,'image/jpeg',.76));
}
function scannerFeedback(message='',phase='',duration=0){
 clearTimeout(scanFeedbackTimer);scanFeedbackTimer=null;
 const box=$('scanFeedback');if(!box)return;
 if(!message||!cameraStream){box.hidden=true;return}
 box.hidden=false;box.dataset.phase=phase;$('scanFeedbackText').textContent=message;
 if(duration>0)scanFeedbackTimer=setTimeout(()=>{if(cameraStream&&!scanBusy&&!pendingUnknown){box.hidden=true;$('scannerStatus').textContent='Ready for the next barcode.'}},duration);
}
function flashCapturedPhoto(){
 const overlay=$('captureFlash');if(!overlay||!cameraStream)return;
 overlay.classList.remove('visible');void overlay.offsetWidth;overlay.classList.add('visible');
}
// Unknown readings are NEVER stored until explicitly confirmed by the operator.
function showUnmatchedCandidate(code,reason){
 $('lastScanBox').hidden=false;$('lastScanBox').classList.add('error');
 $('lastScanBox').innerHTML=`<h2>Barcode needs review</h2><p><b>${esc(code)}</b></p><p class="hint">${esc(reason)} Nothing has been logged as an exception.</p><div class="button-row"><button class="btn primary" data-confirm-unexpected="1">Record as exception</button><button class="btn subtle" data-discard-unexpected="1">Discard reading</button></div>`;
 $('scannerStatus').textContent='Review this barcode below. Camera remains on; scanning resumes after you confirm or discard.';
 scannerFeedback(`Review ${code} below`,'review');
 notify('Barcode not verified. Review before recording an exception.',4000);
}
async function handleBarcodeFromCamera(code){
 const now=Date.now(),clean=norm(code);
 if(!clean||scanBusy||!cameraStream||clean===lastCode&&now-lastCodeAt<8500)return;
 const match=findAsset(clean);
 scanBusy=true;lastCode=clean;lastCodeAt=now;
 try{
   // Don't create duplicate verification events, photos, or exceptions for the same item.
   const prior=match.result==='found'&&scansForSession().some(s=>s.result==='found'&&s.assetKey===match.asset._key);
   if(prior){
     $('lastScanBox').hidden=false;$('lastScanBox').classList.remove('error');
     $('lastScanBox').innerHTML=`<h2>Already verified</h2><p><b>${esc(clean)}</b> was scanned earlier in this inventory.</p><p class="hint">No duplicate entry created. Point at the next item; camera stays on.</p>`;
     $('scannerStatus').textContent='Already verified. Point at next tag.';
     scannerFeedback(`Already verified: ${clean}`,'duplicate',1100);
     return;
   }
   $('scannerStatus').textContent=`${clean} read — capturing the tag image…`;
   scannerFeedback(`Barcode read: ${clean} · Capturing photo…`,'capture');
   const imageBlob=await captureFrame();
   // Flash ONLY after the photograph has actually been captured.
   if(imageBlob)flashCapturedPhoto();
   if(match.result!=='found'){
     pendingUnknown={code:clean,imageBlob};
     const reason=match.result==='other-unit'?`This tag belongs to ${match.other.join(', ')}.`:match.result==='ambiguous'?`This identifier matches ${match.duplicates} equipment records.`:'This identifier was not found in the selected unit. Reposition the label and scan again, or confirm an exception.';
     showUnmatchedCandidate(clean,reason);
     return;
   }
   $('scannerStatus').textContent=`${clean} identified — saving encrypted scan${imageBlob?' and photo':''}…`;
   scannerFeedback(`Saving ${clean}${imageBlob?' + photo':''}…`,'saving');
   await recordScan(clean,{method:'camera',imageBlob});
   $('scannerStatus').textContent=`✓ ${clean} verified. Move to the next tag — camera remains on.`;
   scannerFeedback(`✓ ${clean} verified · scan next item`,'success',1400);
 }catch(e){scannerFeedback('Could not save scan — check message','review',3000);errorMessage(e)}finally{scanBusy=false}
}
function candidateFromCamera(raw,source='native'){
 const code=norm(raw),now=Date.now();
 if(!code||scanBusy||!state?.assets?.length||!getUnit()||!cameraStream||pendingUnknown)return;
 if(code===lastCode&&now-lastCodeAt<8500)return;
 const possible=findAsset(code);
 // Unknown strings must resemble a CAP property tag and be confirmed by the user.
 if(possible.result!=='found'&&!/^CAP\d{7,9}$/.test(code))return;
 if(code!==scanCandidate||now-scanCandidateAt>1900){scanCandidate=code;scanCandidateCount=1}
 else scanCandidateCount++;
 scanCandidateAt=now;
 // An exact, unique match decoded by native ML Kit is strong enough on the FIRST hit.
 // For unknown values and fallback decoding, demand repeat optical reads.
 const required=source==='native'&&possible.result==='found'?1:source==='native'?2:possible.result==='found'?2:3;
 if(scanCandidateCount<required)return;
 scanCandidate='';scanCandidateCount=0;
 handleBarcodeFromCamera(code).catch(errorMessage);
}
window.onNativeBarcodeResult=raw=>candidateFromCamera(raw,'native');
async function startCamera(){
 if(cameraStream)return;
 if(!state?.assets?.length||!getUnit())throw Error('Download CAPWATCH equipment and select the inventory unit before starting the camera.');
 pendingUnknown=null;scanCandidate='';scanCandidateCount=0;lastCode='';lastCodeAt=0;
 const video=$('cameraVideo');
 if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is not available on this device.');
 try{
   cameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
   video.srcObject=cameraStream;await video.play();$('cameraPlaceholder').hidden=true;$('scanGuide').hidden=false;
   $('startCamera').disabled=true;$('stopCamera').disabled=false;
   nativeDetector=null;
   if(!window.NativeBarcode?.decodeFrame&&'BarcodeDetector'in window){try{const formats=await BarcodeDetector.getSupportedFormats();const use=['code_39','code_128'].filter(f=>formats.includes(f));if(use.length)nativeDetector=new BarcodeDetector({formats:use})}catch(e){console.warn('Native detector unavailable',e)}}
   $('scannerStatus').textContent=window.NativeBarcode?.decodeFrame?'Continuous ML Kit scanning active. Point at a label; keep moving to the next.':nativeDetector?'Continuous barcode scanning active. Point at a label.':'Continuous Code 39 fallback active. Hold tag straight.';
   scannerFeedback('Ready — point at a barcode','ready',1500);
   scanTimer=setInterval(scanFrame,290);
 }catch(e){stopCamera();throw e}
}
async function scanFrame(){
 if(scanBusy||frameBusy||!cameraStream||document.hidden||pendingUnknown)return;
 const video=$('cameraVideo');if(video.readyState<2)return;
 frameBusy=true;
 try{
   if(window.NativeBarcode?.decodeFrame){
     // ML Kit receives a smaller frame for faster decode. Save high-res photo separately upon recognition.
     const canvas=document.createElement('canvas'),max=1280,scale=Math.min(1,max/Math.max(video.videoWidth,video.videoHeight));
     canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
     canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
     window.NativeBarcode.decodeFrame(canvas.toDataURL('image/jpeg',0.72).split(',')[1]);
     return;
   }
   let code=null;
   if(nativeDetector){const detected=await nativeDetector.detect(video);code=detected.find(d=>d.rawValue)?.rawValue||null}
   if(!code){const canvas=document.createElement('canvas'),lim=1400,scale=Math.min(1,lim/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,0,0,canvas.width,canvas.height);code=Code39Fallback.decodeImageData(ctx.getImageData(0,0,canvas.width,canvas.height))}
   if(code)candidateFromCamera(code,'web');
 }catch(e){console.warn('Barcode frame error',e)}finally{frameBusy=false}
}
function stopCamera(){
 if(scanTimer){clearInterval(scanTimer);scanTimer=null}
 if(cameraStream)for(const t of cameraStream.getTracks())t.stop();
 cameraStream=null;frameBusy=false;nativeDetector=null;pendingUnknown=null;
 clearTimeout(scanFeedbackTimer);scanFeedbackTimer=null;
 $('scanFeedback').hidden=true;$('captureFlash').classList.remove('visible');
 $('cameraVideo').srcObject=null;$('cameraPlaceholder').hidden=false;$('scanGuide').hidden=true;
 $('startCamera').disabled=false;$('stopCamera').disabled=true;
 $('scannerStatus').textContent='Camera stopped. Barcode entry is also available manually.';
}
function historyFor(a){return state.history.filter(h=>norm(h.barcode)&&norm(h.barcode)===norm(a.barcode)||!norm(a.barcode)&&norm(a.sernum)&&norm(h.sernum)===norm(a.sernum))}
async function openAsset(key){const a=state.assets.find(x=>x._key===key);if(!a)return;clearPhotoUrls();const history=historyFor(a),scans=state.scans.filter(e=>e.assetKey===key||e.orgid===str(a.ORGID)&&norm(e.barcode)===norm(a.barcode)).sort((x,y)=>y.at.localeCompare(x.at));const found=scanSummary().verified.has(a._key);
 const fields=ASSET_COLS.filter(f=>str(a[f]));$('detailContent').innerHTML=`<div class="detail-section"><p class="eyebrow">${esc(nameForUnit(a.ORGID))}</p><h1>${esc(a.noun||a.descrp||'Equipment')}</h1><p>${esc(a.make)} ${esc(a.model)}</p><span class="badge ${found?'found':'missing'}">${found?'Verified in current session':'Not scanned in current session'}</span><p><b>${esc(a.barcode||'No barcode')}</b></p></div><div class="detail-section"><h2>CAPWATCH equipment record</h2><div class="detail-grid">${fields.map(f=>`<div class="field"><small>${esc(f)}</small><strong>${esc(a[f])}</strong></div>`).join('')}</div></div><div class="detail-section"><h2>Local inventory scan history (${scans.length})</h2><div id="assetScans">${scans.map(s=>`<div class="history-entry"><b>${esc(s.result==='found'?'Verified':'Exception')} • ${esc(displayTime(s.at))}</b><br>${esc(s.by?.name||'Unknown')} • ${esc(s.method)}${s.photoId?`<div data-photo-holder="${esc(s.photoId)}"><small>Loading encrypted tag photo…</small></div>`:''}</div>`).join('')||'<p class="hint">No inventory scans recorded yet.</p>'}</div></div><div class="detail-section"><h2>CAPWATCH equipment history (${history.length})</h2>${history.length?history.slice().reverse().map(h=>`<div class="history-entry"><b>${esc(h.trntyp||'Transaction')} • ${esc(h.trndtm||h.lstdtm||'Undated')}</b><br>${esc(h.trnusr||h.lstusr||'')} ${h.location?' • '+esc(h.location):''}${h.status?' • Status '+esc(h.status):''}${h.remarks?'<br>'+esc(h.remarks):''}<details><summary>All history fields</summary><div class="detail-grid">${HISTORY_COLS.filter(f=>str(h[f])).map(f=>`<div class="field"><small>${esc(f)}</small><strong>${esc(h[f])}</strong></div>`).join('')}</div></details></div>`).join(''):'<p class="hint">No matching history record in equipment_hst.txt.</p>'}</div>`;
 $('detailOverlay').hidden=false;for(const holder of $('detailContent').querySelectorAll('[data-photo-holder]')){const url=await photoUrl(holder.dataset.photoHolder);holder.innerHTML=url?`<img class="photo" src="${url}" alt="Captured equipment barcode label" loading="lazy">`:'<span class="hint">Photo missing or could not be decrypted.</span>'}}
async function deleteUnexpected(eventId){
 const event=state.scans.find(s=>s.id===eventId&&s.result==='unexpected'&&s.sessionId===getSession()?.id);
 if(!event)return;
 if(!confirm(`Remove the incorrect reading ${event.barcode} from this inventory?`))return;
 state.scans=state.scans.filter(s=>s.id!==eventId);
 if(event.photoId&&!state.scans.some(s=>s.photoId===event.photoId))await del('photos',event.photoId);
 await persist();render();notify('Incorrect scan removed.');
}
async function clearUnexpected(){
 const session=getSession();if(!session)return;
 const invalid=state.scans.filter(s=>s.sessionId===session.id&&s.result==='unexpected');
 if(!invalid.length){notify('No exceptions to remove in this inventory.');return}
 if(!confirm(`Remove ${invalid.length} unverified scan(s) from this inventory? Verified equipment will not be changed.`))return;
 const ids=new Set(invalid.map(x=>x.id));state.scans=state.scans.filter(s=>!ids.has(s.id));
 for(const event of invalid)if(event.photoId&&!state.scans.some(s=>s.photoId===event.photoId))await del('photos',event.photoId);
 await persist();render();notify(`${invalid.length} exceptions removed.`);
}
async function openUnexpected(eventId){const e=state.scans.find(x=>x.id===eventId);if(!e)return;clearPhotoUrls();const url=await photoUrl(e.photoId);$('detailContent').innerHTML=`<div class="detail-section"><h1>Unexpected barcode</h1><p class="badge unexpected">Not matched</p><h2>${esc(e.barcode)}</h2><p>${esc(e.note||'Not in assigned equipment list.')}</p><p class="muted">${esc(nameForUnit(e.orgid))}<br>${esc(displayTime(e.at))}<br>Recorded by ${esc(e.by?.name||'Unknown')}</p>${url?`<img class="photo" alt="Unexpected equipment barcode" src="${url}">`:'<p class="hint">No photograph saved.</p>'}</div>`;$('detailOverlay').hidden=false}
/* Encrypted export files: new independent passphrase, salted PBKDF2, AES-256-GCM. */
async function downloadFile(bytes,name,mime='application/octet-stream'){
 const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type:mime});
 if(window.NativeFile?.start && window.NativeFile?.write && window.NativeFile?.finish){
   const token=window.NativeFile.start(name,mime);
   if(!token)throw Error('Android could not start saving the export.');
   const buf=new Uint8Array(await blob.arrayBuffer());
   for(let pos=0;pos<buf.length;pos+=24576){
     if(!window.NativeFile.write(token,b64(buf.subarray(pos,pos+24576))))throw Error('Android could not write the export.');
   }
   if(!window.NativeFile.finish(token))throw Error('Android could not complete the export.');
   notify('Choose a location to save the file on your device.');return;
 }
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function encryptPackage(payload,password,kind){const salt=crypto.getRandomValues(new Uint8Array(16)),k=await deriveKey(password,salt),sealed=await seal(JSON.stringify(payload),k);return JSON.stringify({format:'CAP_INVENTORY_ENCRYPTED',version:1,kind,kdf:'PBKDF2-SHA256',iterations:KDF_ITERATIONS,salt:b64(salt),iv:b64(sealed.iv),cipher:b64(sealed.cipher)})}
async function decryptPackage(raw,password,requiredKind){let env;try{env=JSON.parse(raw)}catch{throw Error('Not a valid CAP inventory export file.')}if(env.format!=='CAP_INVENTORY_ENCRYPTED'||env.version!==1||env.kind!==requiredKind)throw Error(`This is not a CAP Inventory ${requiredKind} file.`);if(!Number.isInteger(env.iterations)||env.iterations<150000||env.iterations>1000000)throw Error('Unsupported export encryption settings.');
 const k=await deriveKey(password,unb64(env.salt),env.iterations);try{return JSON.parse(dec.decode(await unseal({iv:unb64(env.iv),cipher:unb64(env.cipher)},k)))}catch{throw Error('Incorrect report passphrase, or the file is damaged.')}}
async function collectPhotos(scanRecords){const ids=[...new Set(scanRecords.map(e=>e.photoId).filter(Boolean))],photos=[];for(const identifier of ids){const info=await loadPhotoData(identifier);if(info)photos.push({id:identifier,mime:info.mime,base64:b64(await info.blob.arrayBuffer())})}return photos}
async function saveRestoredPhotos(photos){let count=0;for(const p of photos||[]){if(!p.id||typeof p.base64!=='string')continue;if(await get('photos',p.id))continue;const sealed=await seal(unb64(p.base64));await put('photos',{id:p.id,...sealed,mime:p.mime||'image/jpeg',createdAt:stamp()});count++}return count}
async function askPassphrase(action){const pass=prompt(`${action}\n\nEnter a backup passphrase (at least 12 characters). You will need it to restore the backup. Do not reuse your eServices password.`);if(pass===null)return null;if(pass.length<12)throw Error('Export passphrase must contain at least 12 characters.');return pass}
async function exportBackup(){const pass=await askPassphrase('COMPLETE ENCRYPTED BACKUP');if(pass===null)return;const photos=await collectPhotos(state.scans);const payload={kind:'full-backup',version:1,exportedAt:stamp(),state:copy(state),photos};const data=await encryptPackage(payload,pass,'full-backup');await downloadFile(data,`CAP_Inventory_Backup_${new Date().toISOString().slice(0,10)}.capbackup`,'application/json');notify(`Backup exported: ${photos.length} encrypted tag photos`)}
async function restoreBackupFile(file){const pass=prompt('Enter the backup export passphrase:');if(pass===null)return;const packageData=await decryptPackage(await file.text(),pass,'full-backup');if(packageData.kind!=='full-backup'||!packageData.state||!Array.isArray(packageData.state.assets)||!Array.isArray(packageData.state.scans))throw Error('Backup content is incomplete.');if(!confirm('RESTORE BACKUP? This replaces the equipment, maps, inventory sessions and scans on THIS DEVICE. Your local operator profile will be preserved. Export a backup of current data first if needed.'))return;
 const originalProfile=copy(state.profile);const replacement=copy(packageData.state);replacement.profile=originalProfile;replacement.prefs=replacement.prefs||{unit:'',session:''};replacement.orgMap=replacement.orgMap||{};replacement.sessions=replacement.sessions||[];replacement.history=replacement.history||[];state=replacement;const count=await saveRestoredPhotos(packageData.photos);await persist();render();notify(`Backup restored. ${state.assets.length} items and ${count} photos restored.`,7900)}
function csvCell(value){let v=String(value??'');if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"'}
async function exportCsv(){const summary=scanSummary(),session=getSession(),header=['Charter','ORGID',...ASSET_COLS,'InventoryResult','LastScannedAt','LastScannedBy','InventoryName'];const records=summary.assets.map(a=>{let scan=summary.latest.get(a._key);return [nameForUnit(a.ORGID),a.ORGID,...ASSET_COLS.map(k=>a[k]),summary.verified.has(a._key)?'Verified':'Not scanned',scan?.at||'',scan?.by?.name||'',session?.name||'']});for(const e of summary.unknown)records.push([nameForUnit(e.orgid),e.orgid,...ASSET_COLS.map(k=>k==='barcode'?e.barcode:''),'Unexpected scan',e.at,e.by?.name||'',session?.name||'']);const csv='\uFEFF'+[header,...records].map(row=>row.map(csvCell).join(',')).join('\r\n');await downloadFile(csv,`CAP_Inventory_${filenameSafe(nameForUnit(getUnit()))}_${new Date().toISOString().slice(0,10)}.csv`,'text/csv;charset=utf-8');notify(`CSV exported: ${records.length} rows`)}
function startSession(name){if(!getUnit())throw Error('Import equipment and select a unit first.');const newName=str(name);if(!newName)throw Error('Give this inventory a name.');const same=state.sessions.find(s=>s.orgid===getUnit()&&s.name.toLowerCase()===newName.toLowerCase());if(same)throw Error('An inventory with that name already exists for this unit.');const session={id:id(),orgid:getUnit(),name:newName,createdAt:stamp()};state.sessions.push(session);state.prefs.session=session.id;persist();render();notify(`New inventory started: ${newName}`)}
function initListeners(){
 $('setupForm').addEventListener('submit',async ev=>{ev.preventDefault();const f=new FormData(ev.target),pass=String(f.get('cwpassword')||''),capid=String(f.get('capid')||'').trim();
   const btn=ev.target.querySelector('button[type="submit"]');btn.disabled=true;
   try{if(!pass||!/^[0-9]+$/.test(capid))throw Error('A valid CAPID and eServices password are required.');await createAccount(f.get('name'),capid,pass);const successful=await runCapwatchForm(ev.target,$('capwatchDownloadStatus'));if(!successful)navigate('settings');ev.target.reset()}catch(e){authError(e.message)}finally{btn.disabled=false;ev.target.querySelector('[name="cwpassword"]').value=''}});
 $('loginForm').addEventListener('submit',async ev=>{ev.preventDefault();const f=new FormData(ev.target);const capid=String(f.get('capid')||'').trim(),cwpassword=String(f.get('cwpassword')||'');
   const btn=ev.target.querySelector('button[type="submit"]');btn.disabled=true;
   try{if(!capid||!cwpassword)throw Error('Enter your CAPID and eServices password.');await unlock(cwpassword);
     if(str(state.profile.capid)!==capid){lock();throw Error('This encrypted inventory belongs to a different CAPID.');}
     if(navigator.onLine){const successful=await runCapwatchForm(ev.target,$('capwatchDownloadStatus'));if(!successful)navigate('settings');}
     else notify('Offline: existing encrypted inventory unlocked with your eServices password.');
     ev.target.reset();
   }catch(e){authError(e.message)}finally{btn.disabled=false;ev.target.querySelector('[name="cwpassword"]').value=''}});
 $('lockBtn').onclick=lock;$('signOutButton').onclick=lock;
 $('unitSelect').onchange=e=>{state.prefs.unit=e.target.value;state.prefs.session='';persist();render()};$('sessionSelect').onchange=e=>{state.prefs.session=e.target.value;persist();renderDashboard();renderEquipment();renderSessions()};
 document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.go)));
 $('outstandingButton').onclick=()=>{equipmentFilter='outstanding';navigate('equipment')};
 $('equipmentSearch').oninput=renderEquipment;$('equipmentFilters').onclick=e=>{const btn=e.target.closest('[data-filter]');if(!btn)return;equipmentFilter=btn.dataset.filter;renderEquipment()};
 $('equipmentList').onclick=e=>{const i=e.target.closest('[data-item]'),u=e.target.closest('[data-unexpected]');if(i)openAsset(i.dataset.item).catch(errorMessage);if(u)openUnexpected(u.dataset.unexpected).catch(errorMessage);const d=e.target.closest('[data-delete-unexpected]');if(d)deleteUnexpected(d.dataset.deleteUnexpected).catch(errorMessage)};
 $('lastScanBox').onclick=e=>{const btn=e.target.closest('[data-item]');if(btn)openAsset(btn.dataset.item).catch(errorMessage);if(e.target.closest('[data-discard-unexpected]')){pendingUnknown=null;$('lastScanBox').hidden=true;$('scannerStatus').textContent='Reading discarded. Point at next barcode.';scannerFeedback('Discarded · ready for next tag','ready',1100);notify('Unverified reading discarded. Nothing was logged.')}if(e.target.closest('[data-confirm-unexpected]')){const candidate=pendingUnknown;if(candidate&&!scanBusy){pendingUnknown=null;scanBusy=true;scannerFeedback(`Saving exception ${candidate.code}…`,'saving');recordScan(candidate.code,{method:'camera-reviewed',imageBlob:candidate.imageBlob}).then(()=>{scannerFeedback('Exception recorded · scan next item','success',1400);$('scannerStatus').textContent='Exception recorded. Camera is still on.'}).catch(errorMessage).finally(()=>{scanBusy=false})}}};
 $('detailOverlay').onclick=e=>{if(e.target===$('detailOverlay'))closeDetail()};$('closeDetail').onclick=closeDetail;
 $('startCamera').onclick=()=>startCamera().catch(errorMessage);$('stopCamera').onclick=stopCamera;
 $('manualScanForm').onsubmit=async e=>{e.preventDefault();try{await recordScan($('manualBarcode').value,{method:'manual'});$('manualBarcode').value=''}catch(err){errorMessage(err)}};
 $('newSessionForm').onsubmit=e=>{e.preventDefault();try{startSession(new FormData(e.target).get('name'));e.target.reset()}catch(err){errorMessage(err)}};
 $('newSessionTop').onclick=()=>{navigate('sessions');$('newSessionForm').querySelector('input').focus()};
 $('sessionsList').onclick=e=>{const btn=e.target.closest('[data-session-id]');if(btn){state.prefs.session=btn.dataset.sessionId;persist();render();navigate('dashboard')}};
 $('capwatchRefreshForm').addEventListener('submit',async ev=>{ev.preventDefault();await runCapwatchForm(ev.target,$('capwatchDownloadStatus'))});
 $('importCapwatch').onclick=async()=>{const files=$('capwatchFile').files;const btn=$('importCapwatch');btn.disabled=true;try{await importCapwatch(files);$('capwatchFile').value=''}catch(e){errorMessage(e)}finally{btn.disabled=false}};
 $('saveMapping').onclick=async()=>{for(const e of document.querySelectorAll('[data-mapping]')){const val=str(e.value).toUpperCase();if(val&&!/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/.test(val)){notify(`Charter ${val}: expected a format like RMR-MT-001.`);return}state.orgMap[e.dataset.mapping]=val}await persist();render();notify('Unit charter numbers saved.')};
 $('exportBackup').onclick=()=>exportBackup().catch(errorMessage);$('restoreBackup').onclick=()=>$('backupFile').click();$('backupFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{await restoreBackupFile(f)}catch(err){errorMessage(err)}e.target.value=''};
 $('exportCsv').onclick=()=>exportCsv().catch(errorMessage);$('clearUnexpected').onclick=()=>clearUnexpected().catch(errorMessage);
 $('persistStorage').onclick=async()=>{if(!navigator.storage?.persist){notify('Persistent storage is not supported on this browser. Export regular backups.');return}const success=await navigator.storage.persist();notify(success?'Persistent storage granted. Still export backups.':'Browser did not grant persistent storage. Export backups regularly.')};
 $('installButton').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null}else notify('Android Chrome: ⋮ → Install app. iPhone Safari: Share → Add to Home Screen.',8500)};
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e});window.addEventListener('appinstalled',()=>notify('CAP Inventory installed on your home screen.'));
 window.addEventListener('online',networkState);window.addEventListener('offline',networkState);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera()});
}
function networkState(){$('networkText').textContent=navigator.onLine?'OFFLINE READY':'OFFLINE'}
function closeDetail(){$('detailOverlay').hidden=true;clearPhotoUrls()}
function authError(msg){const e=$('authStatus');e.hidden=false;e.textContent=msg}
async function bootstrap(){try{if(!window.crypto?.subtle||!window.indexedDB)throw Error('This browser requires HTTPS, Web Crypto and IndexedDB. Use Chrome/Safari through GitHub Pages.');db=await openDb();const meta=await get('meta','config');$('setupForm').hidden=!!meta;$('loginForm').hidden=!meta;initListeners();networkState();if(!IS_NATIVE_ANDROID&&'serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(console.warn);if(IS_NATIVE_ANDROID){const hint=$('capwatchDownloadStatus');if(hint)hint.textContent='Android native CAPWATCH connection is ready. Credentials and ZIP travel directly between this device and CAPWATCH over HTTPS.';const btn=$('installButton');if(btn)btn.hidden=true;}}catch(e){authError(e.message)}}
document.addEventListener('DOMContentLoaded',bootstrap);
