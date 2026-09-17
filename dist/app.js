import { FaceDetector, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm';
const $=id=>document.getElementById(id);
const file=$('file'),drop=$('drop'),editor=$('editor'),canvas=$('canvas'),ctx=canvas.getContext('2d'),controls=$('controls'),save=$('save'),status=$('status'),count=$('count'),loading=$('loading');
let detectorPromise=null,image=null,faces=[],manual=[],showOriginal=false,manualMode=false,settings={size:1,length:1,style:'soft'};
function detector(){return detectorPromise??=initDetector();}
async function initDetector(){
 const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
 return FaceDetector.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',delegate:'CPU'},runningMode:'IMAGE',minDetectionConfidence:.35,minSuppressionThreshold:.3});
}
function fitSize(w,h){const max=2200,s=Math.min(1,max/Math.max(w,h));return [Math.round(w*s),Math.round(h*s)]}
async function load(blob){
 loading.hidden=false;drop.hidden=true;editor.hidden=false;controls.disabled=true;save.disabled=true;status.textContent='顔検出モデルを準備しています…';
 try{
  const bmp=await createImageBitmap(blob,{imageOrientation:'from-image'});const [w,h]=fitSize(bmp.width,bmp.height);canvas.width=w;canvas.height=h;image=bmp;faces=[];manual=[];
  const d=await detector();ctx.drawImage(image,0,0,w,h);const result=d.detect(canvas);
  faces=(result.detections||[]).map((det,i)=>{
    const box=det.boundingBox||{};const k=det.keypoints||[];const mouth=k[3];
    const cx=mouth?.x*w ?? ((box.originX||0)+(box.width||0)/2);const cy=mouth?.y*h ?? ((box.originY||0)+(box.height||0)*.72);
    return {id:i,x:cx,y:cy,r:Math.max(14,(box.width||Math.min(w,h)*.12)*.18)};
  });
  controls.disabled=false;save.disabled=false;count.textContent=`${faces.length}人を検出`;status.textContent=faces.length?'検出した全員に合成しました。漏れがあれば「手動で追加」。':'顔を検出できませんでした。口元を手動で追加できます。';render();
 }catch(e){console.error(e);controls.disabled=false;save.disabled=false;count.textContent='自動検出を利用できません';status.textContent='口元を手動で追加して編集できます。';render();}
 finally{loading.hidden=true;}
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
drop.onclick=()=>file.click();$('replace').onclick=()=>file.click();file.onchange=()=>file.files?.[0]&&load(file.files[0]);
$('edited').onclick=()=>{showOriginal=false;$('edited').classList.add('active');$('original').classList.remove('active');render()};$('original').onclick=()=>{showOriginal=true;$('original').classList.add('active');$('edited').classList.remove('active');render()};
$('size').oninput=e=>{settings.size=+e.target.value/100;$('sizeOut').value=e.target.value+'%';render()};$('length').oninput=e=>{settings.length=+e.target.value/100;$('lengthOut').value=e.target.value+'%';render()};
document.querySelectorAll('[data-style]').forEach(b=>b.onclick=()=>{settings.style=b.dataset.style;document.querySelectorAll('[data-style]').forEach(x=>x.classList.toggle('active',x===b));render()});
$('add').onclick=()=>{manualMode=!manualMode;canvas.classList.toggle('manual',manualMode);$('add').textContent=manualMode?'口元を画像上でタップ':'見つからない顔を手動で追加';};
canvas.onclick=e=>{if(!manualMode||!image)return;const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*canvas.width/r.width,y=(e.clientY-r.top)*canvas.height/r.height;manual.push({x,y,r:Math.max(15,Math.min(canvas.width,canvas.height)*.035)});manualMode=false;canvas.classList.remove('manual');$('add').textContent='見つからない顔を手動で追加';count.textContent=`${faces.length}人を検出 + ${manual.length}人を手動追加`;render();};
$('clearManual').onclick=()=>{manual=[];count.textContent=`${faces.length}人を検出`;render()};
save.onclick=()=>{if(!image)return;const prev=showOriginal;showOriginal=false;render();canvas.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='einstein-edited.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)},'image/png');showOriginal=prev;setTimeout(render)};
for(const ev of ['dragenter','dragover'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')});for(const ev of ['dragleave','drop'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')});drop.addEventListener('drop',e=>e.dataTransfer?.files?.[0]&&load(e.dataTransfer.files[0]));
