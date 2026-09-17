const $=id=>document.getElementById(id);
const file=$('file'),drop=$('drop'),editor=$('editor'),canvas=$('canvas'),ctx=canvas.getContext('2d'),controls=$('controls'),save=$('save'),status=$('status'),count=$('count'),loading=$('loading');
let shortDetectorPromise=null,fullDetectorPromise=null,image=null,faces=[],manual=[],showOriginal=false,manualMode=false,settings={size:1,length:1,style:'soft'};

const MP_VERSION='0.10.32';
const MP_MODULE=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/+esm`;
const MP_WASM=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const SHORT_FACE_MODEL='https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const FULL_FACE_MODEL='https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite';
let mediaPipeModulePromise=null;
let visionPromise=null;

function showLoading(message='顔を探しています…'){
 loading.textContent=message;
 loading.hidden=false;
 loading.style.display='grid';
}
function hideLoading(){
 loading.hidden=true;
 loading.style.display='none';
}

async function mediaPipeModule(){
 return mediaPipeModulePromise??=import(MP_MODULE);
}
async function visionFileset(){
 if(!visionPromise){
  visionPromise=(async()=>{
   const {FilesetResolver}=await mediaPipeModule();
   return FilesetResolver.forVisionTasks(MP_WASM);
  })().catch(error=>{visionPromise=null;throw error;});
 }
 return visionPromise;
}
async function createDetector(modelUrl){
 const [{FaceDetector},vision]=await Promise.all([mediaPipeModule(),visionFileset()]);
 const detector=await FaceDetector.createFromModelPath(vision,modelUrl);
 await detector.setOptions({runningMode:'IMAGE',minDetectionConfidence:.2,minSuppressionThreshold:.3});
 return detector;
}
function shortDetector(){
 if(!shortDetectorPromise)shortDetectorPromise=createDetector(SHORT_FACE_MODEL).catch(error=>{shortDetectorPromise=null;throw error;});
 return shortDetectorPromise;
}
function fullDetector(){
 if(!fullDetectorPromise)fullDetectorPromise=createDetector(FULL_FACE_MODEL).catch(error=>{fullDetectorPromise=null;throw error;});
 return fullDetectorPromise;
}
function fitSize(w,h){const max=2200,s=Math.min(1,max/Math.max(w,h));return [Math.round(w*s),Math.round(h*s)]}

async function decodeImage(blob){
 if('createImageBitmap' in window){
  try{return await createImageBitmap(blob,{imageOrientation:'from-image'});}catch(e){console.warn('createImageBitmap failed; falling back to img',e);}
 }
 const url=URL.createObjectURL(blob);
 try{
  const img=new Image();
  img.decoding='async';
  img.src=url;
  if(img.decode) await img.decode();
  else await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;});
  return img;
 } finally {
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
}

function normalizeDetections(result){
 return (result?.detections||[]).map((det,i)=>{
  const box=det.boundingBox||{};const k=det.keypoints||[];const mouth=k[3];
  const cx=mouth?.x*canvas.width ?? ((box.originX||0)+(box.width||0)/2);
  const cy=mouth?.y*canvas.height ?? ((box.originY||0)+(box.height||0)*.72);
  return {id:i,x:cx,y:cy,r:Math.max(14,(box.width||Math.min(canvas.width,canvas.height)*.12)*.18)};
 });
}
async function detectFaces(){
 const short=await shortDetector();
 let detected=normalizeDetections(short.detect(canvas));
 if(detected.length)return {faces:detected,model:'short'};
 status.textContent='別の顔検出モデルでも確認しています…';
 const full=await fullDetector();
 detected=normalizeDetections(full.detect(canvas));
 return {faces:detected,model:'full'};
}

async function load(blob){
 if(!blob)return;
 showLoading('画像を読み込んでいます…');drop.hidden=true;editor.hidden=false;controls.disabled=true;save.disabled=true;status.textContent='画像を読み込んでいます…';
 try{
  const decoded=await decodeImage(blob);
  const iw=decoded.width||decoded.naturalWidth,ih=decoded.height||decoded.naturalHeight;
  if(!iw||!ih)throw new Error('画像サイズを取得できませんでした');
  const [w,h]=fitSize(iw,ih);canvas.width=w;canvas.height=h;image=decoded;faces=[];manual=[];
  ctx.drawImage(image,0,0,w,h);
  showLoading('顔を探しています…');
  status.textContent='顔検出モデルを準備しています…';
  try{
   const detection=await detectFaces();faces=detection.faces;
   count.textContent=`${faces.length}人を検出`;
   status.textContent=faces.length
    ?`検出した全員に合成しました（${detection.model==='short'?'Short':'Full'} Range）。漏れがあれば「手動で追加」。`
    :'顔検出モデルは正常に動作しましたが、この画像では顔を検出できませんでした。実写向けモデルなので、イラスト・3Dアバターは検出できない場合があります。';
  }catch(e){
   console.error('face detector failed',e);faces=[];count.textContent='顔検出モデルの初期化に失敗';
   const detail=e?.message?` (${String(e.message).slice(0,180)})`:'';
   status.textContent=`写真は読み込めましたが、顔検出モデルを初期化できませんでした${detail}`;
  }
  controls.disabled=false;save.disabled=false;render();
 }catch(e){
  console.error(e);drop.hidden=false;editor.hidden=true;controls.disabled=true;save.disabled=true;count.textContent='画像を読み込めませんでした';status.textContent='別のJPEG / PNG / WebP / HEIC画像を選んでください。';alert('この画像を読み込めませんでした。別の画像を選んでください。');
 }finally{hideLoading();file.value='';}
}

function tongue(c,f){
 const s=f.r*settings.size,l=f.r*1.45*settings.length;c.save();c.translate(f.x,f.y+s*.2);
 if(settings.style==='pop'){
  c.lineWidth=Math.max(2,s*.13);c.strokeStyle='#6d2431';c.fillStyle='#ff6f83';c.beginPath();c.moveTo(-s*.62,0);c.quadraticCurveTo(-s*.56,l*.92,0,l);c.quadraticCurveTo(s*.56,l*.92,s*.62,0);c.quadraticCurveTo(0,s*.28,-s*.62,0);c.closePath();c.fill();c.stroke();c.strokeStyle='#b33b56';c.lineWidth=Math.max(1,s*.07);c.beginPath();c.moveTo(0,l*.2);c.lineTo(0,l*.75);c.stroke();
 }else{
  const g=c.createLinearGradient(0,0,0,l);g.addColorStop(0,'#b74f5f');g.addColorStop(.45,'#e17a83');g.addColorStop(1,'#f19aa1');c.fillStyle=g;c.beginPath();c.moveTo(-s*.62,0);c.bezierCurveTo(-s*.7,l*.5,-s*.44,l,0,l);c.bezierCurveTo(s*.44,l,s*.7,l*.5,s*.62,0);c.quadraticCurveTo(0,s*.32,-s*.62,0);c.closePath();c.fill();c.strokeStyle='#983f50';c.globalAlpha=.45;c.lineWidth=Math.max(1,s*.05);c.beginPath();c.moveTo(0,l*.2);c.lineTo(0,l*.76);c.stroke();
 }c.restore();
}
function render(){if(!image)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);if(showOriginal)return;[...faces,...manual].forEach(f=>tongue(ctx,f));}

file.addEventListener('change',()=>{const selected=file.files?.[0];if(selected)load(selected);});
drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click();}});
$('edited').onclick=()=>{showOriginal=false;$('edited').classList.add('active');$('original').classList.remove('active');render()};
$('original').onclick=()=>{showOriginal=true;$('original').classList.add('active');$('edited').classList.remove('active');render()};
$('size').oninput=e=>{settings.size=+e.target.value/100;$('sizeOut').value=e.target.value+'%';render()};
$('length').oninput=e=>{settings.length=+e.target.value/100;$('lengthOut').value=e.target.value+'%';render()};
document.querySelectorAll('[data-style]').forEach(b=>b.onclick=()=>{settings.style=b.dataset.style;document.querySelectorAll('[data-style]').forEach(x=>x.classList.toggle('active',x===b));render()});
$('add').onclick=()=>{manualMode=!manualMode;canvas.classList.toggle('manual',manualMode);$('add').textContent=manualMode?'口元を画像上でタップ':'見つからない顔を手動で追加';};
canvas.onclick=e=>{if(!manualMode||!image)return;const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*canvas.width/r.width,y=(e.clientY-r.top)*canvas.height/r.height;manual.push({x,y,r:Math.max(15,Math.min(canvas.width,canvas.height)*.035)});manualMode=false;canvas.classList.remove('manual');$('add').textContent='見つからない顔を手動で追加';count.textContent=`${faces.length}人を検出 + ${manual.length}人を手動追加`;render();};
$('clearManual').onclick=()=>{manual=[];count.textContent=`${faces.length}人を検出`;render()};
save.onclick=()=>{if(!image)return;const prev=showOriginal;showOriginal=false;render();canvas.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='einstein-edited.png';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)},'image/png');showOriginal=prev;setTimeout(render)};
for(const ev of ['dragenter','dragover'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')});
for(const ev of ['dragleave','drop'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')});
drop.addEventListener('drop',e=>e.dataTransfer?.files?.[0]&&load(e.dataTransfer.files[0]));
hideLoading();