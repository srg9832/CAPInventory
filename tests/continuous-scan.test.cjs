const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(__dirname+'/../site/app.js','utf8');
const nodes=new Map();const node=(id)=>{if(!nodes.has(id))nodes.set(id,{hidden:false,dataset:{},classList:{add(){},remove(){}},style:{},textContent:'',innerHTML:'',offsetWidth:100});return nodes.get(id)};
const ctx={TextEncoder,TextDecoder,crypto:require('crypto').webcrypto,console,Uint8Array,Intl,atob,btoa,setTimeout,clearTimeout,setInterval,clearInterval,document:{getElementById:node,addEventListener(){}},window:{},location:{hostname:'appassets.androidplatform.net',origin:'https://appassets.androidplatform.net'},navigator:{vibrate:()=>{}},Date};vm.createContext(ctx);vm.runInContext(s,ctx);
const seed=`state={assets:[{_key:'b:2031344',barcode:'2031344',assetcd:'000001',ORGID:'394'}],scans:[],history:[],profile:{name:'Operator',capid:'123'},prefs:{unit:'394',session:'s'},sessions:[{id:'s',orgid:'394'}],orgMap:{}};cameraStream={getTracks(){return []}};captureFrame=async()=>({fakeImage:true});notify=()=>{};renderDashboard=()=>{};renderEquipment=()=>{};renderSessions=()=>{};persist=async()=>{};storePhoto=async()=>('p1');recordScan=async function(code){state.scans.push({barcode:code,result:'found',assetKey:'b:2031344',sessionId:'s'});await new Promise(r=>setTimeout(r,10))};`;
vm.runInContext(seed,ctx);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 vm.runInContext(`window.onNativeBarcodeResult('CAP2031344')`,ctx); // one ML Kit read should suffice
 await sleep(50);
 assert.equal(vm.runInContext('state.scans.length',ctx),1,'native unique match accepted first read');
 assert.equal(vm.runInContext('!!cameraStream',ctx),true,'camera remains open');
 assert.equal(node('scanFeedback').dataset.phase,'success','display success state');
 assert.equal(node('captureFlash').classList!==undefined,true);
 vm.runInContext(`window.onNativeBarcodeResult('CAP2031344')`,ctx);
 await sleep(20);
 assert.equal(vm.runInContext('state.scans.length',ctx),1,'repeated barcode not re-recorded');
 vm.runInContext(`lastCode='';lastCodeAt=0;window.onNativeBarcodeResult('CAP9999999')`,ctx);
 await sleep(20);
 assert.equal(vm.runInContext('state.scans.length',ctx),1,'unknown not auto-logged');
 vm.runInContext(`window.onNativeBarcodeResult('CAP9999999')`,ctx);
 await sleep(20);
 assert.equal(vm.runInContext('pendingUnknown?.code',ctx),'CAP9999999','unknown requires two readings and review');
 assert.equal(vm.runInContext('!!cameraStream',ctx),true,'camera still live during review');
 vm.runInContext('stopCamera()',ctx);
 assert.equal(vm.runInContext('cameraStream',ctx),null);
 console.log('PASS continuous scanner: first read confirms known item, camera stays on, cooldown prevents duplicates, unknowns held for review, camera can stop.');
})().catch(e=>{console.error(e);process.exitCode=1});
