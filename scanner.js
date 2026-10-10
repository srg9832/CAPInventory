/* Offline Code 39 scanner fallback for browsers without native BarcodeDetector.
   Reads alternating narrow/wide bars along horizontal and vertical frame sample-lines.
   Label should be held approximately straight within the viewfinder. */
(function(){
const CODE39={
 "0":"nnnWWnWnn",
 "1":"WnnWnnnnW",
 "2":"nnWWnnnnW",
 "3":"WnWWnnnnn",
 "4":"nnnWWnnnW",
 "5":"WnnWWnnnn",
 "6":"nnWWWnnnn",
 "7":"nnnWnnWnW",
 "8":"WnnWnnWnn",
 "9":"nnWWnnWnn",
 "A":"WnnnnWnnW",
 "B":"nnWnnWnnW",
 "C":"WnWnnWnnn",
 "D":"nnnnWWnnW",
 "E":"WnnnWWnnn",
 "F":"nnWnWWnnn",
 "G":"nnnnnWWnW",
 "H":"WnnnnWWnn",
 "I":"nnWnnWWnn",
 "J":"nnnnWWWnn",
 "K":"WnnnnnnWW",
 "L":"nnWnnnnWW",
 "M":"WnWnnnnWn",
 "N":"nnnnWnnWW",
 "O":"WnnnWnnWn",
 "P":"nnWnWnnWn",
 "Q":"nnnnnnWWW",
 "R":"WnnnnnWWn",
 "S":"nnWnnnWWn",
 "T":"nnnnWnWWn",
 "U":"WWnnnnnnW",
 "V":"nWWnnnnnW",
 "W":"WWWnnnnnn",
 "X":"nWnnWnnnW",
 "Y":"WWnnWnnnn",
 "Z":"nWWnWnnnn",
 "-":"nWnnnnWnW",
 ".":"WWnnnnWnn",
 " ":"nWWnnnWnn",
 "*":"nWnnWnWnn",
 "$":"nWnWnWnnn",
 "/":"nWnWnnnWn",
 "+":"nWnnnWnWn",
 "%":"nnnWnWnWn"};
const REVERSE={};for(const [symbol,pattern] of Object.entries(CODE39))REVERSE[pattern]=symbol;
function patternFromRuns(runs,at){
 const rs=runs.slice(at,at+9);if(rs.length<9)return null;
 const widths=rs.map(r=>r.len),sorted=[...widths].sort((a,b)=>a-b);
 if(sorted[6]<sorted[5]*1.25 || sorted[5]<1)return null;
 const cut=(sorted[5]+sorted[6])/2;
 return widths.map(n=>n>cut?'W':'n').join('');
}
function decodeBits(bits){
 let runs=[];for(let i=0;i<bits.length;i++){
   const dark=bits[i];let last=runs[runs.length-1];
   if(last&&last.dark===dark)last.len++;else runs.push({dark,len:1});
 }
 if(runs.length<30)return null;
 // A start/stop '*' is compulsory in Code 39. Try each potential start bar.
 for(let start=0;start<runs.length-9;start++){
   if(!runs[start].dark)continue;
   const p=patternFromRuns(runs,start);
   if(p!==CODE39['*'])continue;
   let j=start,decoded='',valid=true;
   for(let nc=0;nc<48;nc++){
     if(j+8>=runs.length){valid=false;break;}
     const pat=patternFromRuns(runs,j),ch=REVERSE[pat];
     if(!ch){valid=false;break;}
     decoded+=ch;j+=9;
     if(nc>0&&ch==='*')break;
     if(j>=runs.length||runs[j].dark){valid=false;break;}
     const narrow=runs.slice(j-9,j).map(r=>r.len).sort((a,b)=>a-b)[3];
     if(runs[j].len>narrow*2.0){valid=false;break;}
     j++;
   }
   if(valid&&decoded.length>=4&&decoded[0]==='*'&&decoded.endsWith('*')&&decoded.slice(1,-1).indexOf('*')<0){
      const payload=decoded.slice(1,-1);
      if(/^[A-Z0-9. $/+%-]{3,40}$/.test(payload))return payload;
   }
 }
 return null;
}
function decodeLuminance(values){
 if(values.length<90)return null;
 let sorted=[...values].sort((a,b)=>a-b);
 let black=sorted[Math.floor(sorted.length*.10)],white=sorted[Math.floor(sorted.length*.90)];
 if(white-black<45)return null;
 const mid=(black+white)/2;
 const bits=values.map(v=>v<mid);
 // Filter isolated hot pixels that would split thin bars.
 for(let i=1;i<bits.length-1;i++){if(bits[i-1]===bits[i+1]&&bits[i]!==bits[i-1])bits[i]=bits[i-1];}
 return decodeBits(bits)||decodeBits([...bits].reverse());
}
function decodeImageData(imageData){
 const {width:w,height:h,data}=imageData;
 const luminance=(x,y)=>{const i=(y*w+x)*4;return (data[i]*77+data[i+1]*150+data[i+2]*29)>>8;};
 for(const v of [.22,.3,.36,.42,.5,.58,.62,.66,.72,.78]){
   let row=[];const y=Math.floor(h*v);
   for(let x=0;x<w;x++)row.push(luminance(x,y));
   const result=decodeLuminance(row);if(result)return result;
   let col=[];const x=Math.floor(w*v);
   for(let y=0;y<h;y++)col.push(luminance(x,y));
   const colResult=decodeLuminance(col);if(colResult)return colResult;
 }
 return null;
}
window.Code39Fallback={decodeImageData,decodeLuminance,decodeBits,patterns:CODE39};
})();
