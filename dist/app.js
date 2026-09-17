const $ = (id) => document.getElementById(id);
const file = $('file');
const drop = $('drop');
const editor = $('editor');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const controls = $('controls');
const save = $('save');
const status = $('status');
const count = $('count');
const loading = $('loading');

let shortDetectorPromise = null;
let fullDetectorPromise = null;
let image = null;
let faces = [];
let manual = [];
let showOriginal = false;
let manualMode = false;
let settings = {
  size: 1,
  length: 1,
  style: 'soft',
  pattern: 'auto',
};

const MP_VERSION = '0.10.32';
const MP_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/+esm`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const SHORT_FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const FULL_FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite';
let mediaPipeModulePromise = null;
let visionPromise = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const lengthOf = (v) => Math.hypot(v.x, v.y) || 1;
const normalize = (v) => {
  const len = lengthOf(v);
  return { x: v.x / len, y: v.y / len };
};
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (v, s) => ({ x: v.x * s, y: v.y * s });
const bezierPoint = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
};
const bezierTangent = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  return normalize({
    x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  });
};

function showLoading(message = '顔を探しています…') {
  loading.textContent = message;
  loading.hidden = false;
  loading.style.display = 'grid';
}

function hideLoading() {
  loading.hidden = true;
  loading.style.display = 'none';
}

async function mediaPipeModule() {
  return mediaPipeModulePromise ??= import(MP_MODULE);
}

async function visionFileset() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const { FilesetResolver } = await mediaPipeModule();
      return FilesetResolver.forVisionTasks(MP_WASM);
    })().catch((error) => {
      visionPromise = null;
      throw error;
    });
  }
  return visionPromise;
}

async function createDetector(modelUrl) {
  const [{ FaceDetector }, vision] = await Promise.all([mediaPipeModule(), visionFileset()]);
  const detector = await FaceDetector.createFromModelPath(vision, modelUrl);
  await detector.setOptions({
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.2,
    minSuppressionThreshold: 0.3,
  });
  return detector;
}

function shortDetector() {
  if (!shortDetectorPromise) {
    shortDetectorPromise = createDetector(SHORT_FACE_MODEL).catch((error) => {
      shortDetectorPromise = null;
      throw error;
    });
  }
  return shortDetectorPromise;
}

function fullDetector() {
  if (!fullDetectorPromise) {
    fullDetectorPromise = createDetector(FULL_FACE_MODEL).catch((error) => {
      fullDetectorPromise = null;
      throw error;
    });
  }
  return fullDetectorPromise;
}

function fitSize(w, h) {
  const max = 2200;
  const scale = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * scale), Math.round(h * scale)];
}

async function decodeImage(blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (error) {
      console.warn('createImageBitmap failed; falling back to img', error);
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    if (img.decode) await img.decode();
    else await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function estimatePose(keypoints, box, mouthX, mouthY) {
  const rightEye = keypoints[0];
  const leftEye = keypoints[1];
  const nose = keypoints[2];
  const mouth = keypoints[3];
  const rightEar = keypoints[4];
  const leftEar = keypoints[5];

  const rx = rightEye?.x * canvas.width;
  const ry = rightEye?.y * canvas.height;
  const lx = leftEye?.x * canvas.width;
  const ly = leftEye?.y * canvas.height;
  const nx = nose?.x * canvas.width;
  const ny = nose?.y * canvas.height;
  const mx = mouth?.x * canvas.width ?? mouthX;
  const my = mouth?.y * canvas.height ?? mouthY;

  const hasEyes = [rx, ry, lx, ly].every(Number.isFinite);
  const eyeDX = hasEyes ? lx - rx : 0;
  const eyeDY = hasEyes ? ly - ry : 0;
  const eyeDist = hasEyes ? Math.hypot(eyeDX, eyeDY) : Math.max(box.width || 0, 1) * 0.38;
  const roll = hasEyes ? Math.atan2(eyeDY, eyeDX) : 0;
  const eyeMidX = hasEyes ? (lx + rx) / 2 : mouthX;
  const eyeMidY = hasEyes ? (ly + ry) / 2 : mouthY - (box.height || 1) * 0.34;

  let yaw = 0;
  if (Number.isFinite(nx) && eyeDist > 0) {
    yaw = clamp((nx - eyeMidX) / (eyeDist * 0.34), -1, 1);
  } else if (rightEar && leftEar && nose) {
    const rightEarX = rightEar.x * canvas.width;
    const leftEarX = leftEar.x * canvas.width;
    const leftSpan = Math.abs(nx - leftEarX);
    const rightSpan = Math.abs(rightEarX - nx);
    yaw = clamp((leftSpan - rightSpan) / Math.max(leftSpan + rightSpan, 1), -1, 1);
  }

  let pitch = 0;
  if (Number.isFinite(ny) && Number.isFinite(my)) {
    const eyeToMouth = Math.max(Math.abs(my - eyeMidY), 1);
    const noseRatio = (ny - eyeMidY) / eyeToMouth;
    pitch = clamp((noseRatio - 0.52) / 0.22, -1, 1);
  }

  return { roll, yaw, pitch, eyeDist };
}

function normalizeDetections(result) {
  return (result?.detections || []).map((det, i) => {
    const box = det.boundingBox || {};
    const keypoints = det.keypoints || [];
    const mouth = keypoints[3];
    const mouthX = mouth?.x * canvas.width ?? ((box.originX || 0) + (box.width || 0) / 2);
    const mouthY = mouth?.y * canvas.height ?? ((box.originY || 0) + (box.height || 0) * 0.72);
    const pose = estimatePose(keypoints, box, mouthX, mouthY);
    const faceWidth = box.width || Math.max(pose.eyeDist * 2.05, Math.min(canvas.width, canvas.height) * 0.12);
    const faceHeight = box.height || faceWidth * 1.22;

    return {
      id: i,
      x: mouthX,
      y: mouthY,
      r: Math.max(14, faceWidth * 0.18),
      faceWidth,
      faceHeight,
      ...pose,
    };
  });
}

async function detectFaces() {
  const short = await shortDetector();
  let detected = normalizeDetections(short.detect(canvas));
  if (detected.length) return { faces: detected, model: 'short' };

  status.textContent = '別の顔検出モデルでも確認しています…';
  const full = await fullDetector();
  detected = normalizeDetections(full.detect(canvas));
  return { faces: detected, model: 'full' };
}

async function load(blob) {
  if (!blob) return;

  showLoading('画像を読み込んでいます…');
  drop.hidden = true;
  editor.hidden = false;
  controls.disabled = true;
  save.disabled = true;
  status.textContent = '画像を読み込んでいます…';

  try {
    const decoded = await decodeImage(blob);
    const iw = decoded.width || decoded.naturalWidth;
    const ih = decoded.height || decoded.naturalHeight;
    if (!iw || !ih) throw new Error('画像サイズを取得できませんでした');

    const [w, h] = fitSize(iw, ih);
    canvas.width = w;
    canvas.height = h;
    image = decoded;
    faces = [];
    manual = [];
    ctx.drawImage(image, 0, 0, w, h);

    showLoading('顔を探しています…');
    status.textContent = '顔検出モデルを準備しています…';

    try {
      const detection = await detectFaces();
      faces = detection.faces;
      count.textContent = `${faces.length}人を検出`;
      status.textContent = faces.length
        ? `顔向きを推定して全員に舌を合成しました（${detection.model === 'short' ? 'Short' : 'Full'} Range）。`
        : '顔検出モデルは正常に動作しましたが、この画像では顔を検出できませんでした。実写向けモデルなので、イラスト・3Dアバターは検出できない場合があります。';
    } catch (error) {
      console.error('face detector failed', error);
      faces = [];
      count.textContent = '顔検出モデルの初期化に失敗';
      const detail = error?.message ? ` (${String(error.message).slice(0, 180)})` : '';
      status.textContent = `写真は読み込めましたが、顔検出モデルを初期化できませんでした${detail}`;
    }

    controls.disabled = false;
    save.disabled = false;
    render();
  } catch (error) {
    console.error(error);
    drop.hidden = false;
    editor.hidden = true;
    controls.disabled = true;
    save.disabled = true;
    count.textContent = '画像を読み込めませんでした';
    status.textContent = '別のJPEG / PNG / WebP / HEIC画像を選んでください。';
    alert('この画像を読み込めませんでした。別の画像を選んでください。');
  } finally {
    hideLoading();
    file.value = '';
  }
}

function tonguePalette(c, root, tip, style) {
  if (style === 'pop') {
    return {
      fill: '#ff6f83',
      stroke: '#6d2431',
      groove: '#b33b56',
      highlight: 'rgba(255,255,255,.32)',
      rootShadow: 'rgba(83,21,36,.5)',
    };
  }

  const gradient = c.createLinearGradient(root.x, root.y, tip.x, tip.y);
  gradient.addColorStop(0, '#a94355');
  gradient.addColorStop(0.28, '#c75e6f');
  gradient.addColorStop(0.68, '#e47d88');
  gradient.addColorStop(1, '#f0a0a6');
  return {
    fill: gradient,
    stroke: '#8f394a',
    groove: 'rgba(126,42,62,.45)',
    highlight: 'rgba(255,255,255,.2)',
    rootShadow: 'rgba(67,18,30,.42)',
  };
}

function widthAt(t, halfWidth) {
  if (t < 0.12) return halfWidth * lerp(0.72, 1, t / 0.12);
  if (t < 0.72) return halfWidth * lerp(1, 0.82, (t - 0.12) / 0.6);
  return halfWidth * lerp(0.82, 0.06, (t - 0.72) / 0.28);
}

function drawRibbonTongue(c, face, options) {
  const { p0, p1, p2, p3, halfWidth } = options;
  const palette = tonguePalette(c, p0, p3, settings.style);
  const left = [];
  const right = [];
  const center = [];
  const steps = 28;

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const point = bezierPoint(p0, p1, p2, p3, t);
    const tangent = bezierTangent(p0, p1, p2, p3, t);
    const normal = { x: -tangent.y, y: tangent.x };
    const w = widthAt(t, halfWidth);
    center.push(point);
    left.push(add(point, mul(normal, w)));
    right.push(add(point, mul(normal, -w)));
  }

  c.save();

  const mouthAxis = { x: Math.cos(face.roll || 0), y: Math.sin(face.roll || 0) };
  const rootShadowHalf = halfWidth * 0.93;
  c.strokeStyle = palette.rootShadow;
  c.lineWidth = Math.max(2, halfWidth * 0.22);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(p0.x - mouthAxis.x * rootShadowHalf, p0.y - mouthAxis.y * rootShadowHalf);
  c.lineTo(p0.x + mouthAxis.x * rootShadowHalf, p0.y + mouthAxis.y * rootShadowHalf);
  c.stroke();

  c.fillStyle = palette.fill;
  c.strokeStyle = palette.stroke;
  c.lineWidth = Math.max(1.4, halfWidth * 0.09);
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i += 1) c.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i -= 1) c.lineTo(right[i].x, right[i].y);
  c.closePath();
  c.fill();
  c.stroke();

  c.strokeStyle = palette.groove;
  c.lineWidth = Math.max(1, halfWidth * 0.045);
  c.lineCap = 'round';
  c.beginPath();
  const grooveStart = Math.floor(steps * 0.2);
  const grooveEnd = Math.floor(steps * 0.78);
  c.moveTo(center[grooveStart].x, center[grooveStart].y);
  for (let i = grooveStart + 1; i <= grooveEnd; i += 1) c.lineTo(center[i].x, center[i].y);
  c.stroke();

  c.strokeStyle = palette.highlight;
  c.lineWidth = Math.max(1, halfWidth * 0.07);
  c.beginPath();
  const h0 = left[Math.floor(steps * 0.24)];
  const h1 = left[Math.floor(steps * 0.55)];
  c.moveTo(h0.x, h0.y);
  c.quadraticCurveTo((h0.x + h1.x) / 2 - 1, (h0.y + h1.y) / 2 - 2, h1.x, h1.y);
  c.stroke();

  c.restore();
}

function tongueGeometry(face, pattern) {
  const yaw = clamp(face.yaw || 0, -1, 1);
  const pitch = clamp(face.pitch || 0, -1, 1);
  const roll = face.roll || 0;
  const absYaw = Math.abs(yaw);
  const size = face.r * settings.size;
  const length = size * settings.length * (1.28 + Math.max(pitch, 0) * 0.1);
  const perspective = 1 - absYaw * 0.25;
  const halfWidth = size * 0.48 * perspective;

  const faceDown = normalize({ x: -Math.sin(roll), y: Math.cos(roll) });
  const faceSide = normalize({ x: Math.cos(roll), y: Math.sin(roll) });
  const gravity = { x: 0, y: 1 };
  const gravityWeight = 0.56 + Math.abs(roll) * 0.18;
  const down = normalize({
    x: faceDown.x * (1 - gravityWeight) + gravity.x * gravityWeight,
    y: faceDown.y * (1 - gravityWeight) + gravity.y * gravityWeight,
  });

  const root = {
    x: face.x + faceSide.x * yaw * size * 0.05,
    y: face.y + faceDown.y * size * 0.04,
  };

  if (pattern === 'peko') {
    const sideSign = absYaw > 0.12 ? Math.sign(yaw) : (face.id % 2 === 0 ? -1 : 1);
    const side = mul(faceSide, sideSign);
    const p1 = add(root, add(mul(down, length * 0.18), mul(side, length * 0.08)));
    const p2 = add(root, add(mul(down, length * 0.48), mul(side, length * (0.46 + absYaw * 0.12))));
    const p3 = add(root, add(mul(down, length * 0.62), mul(side, length * (0.72 + absYaw * 0.12))));
    return { p0: root, p1, p2, p3, halfWidth: halfWidth * 0.86 };
  }

  const sideDrift = yaw * length * 0.22;
  const gravitySag = length * (0.12 + Math.abs(roll) * 0.08);
  const p1 = add(root, add(mul(faceDown, length * 0.25), mul(faceSide, sideDrift * 0.12)));
  const p2 = add(root, add(mul(down, length * 0.68), mul(faceSide, sideDrift * 0.72)));
  const p3 = add(root, add(mul(down, length), add(mul(faceSide, sideDrift), mul(gravity, gravitySag))));
  return { p0: root, p1, p2, p3, halfWidth };
}

function tonguePattern(face) {
  if (settings.pattern === 'natural') return 'natural';
  if (settings.pattern === 'peko') return 'peko';
  return Math.abs(face.yaw || 0) > 0.5 ? 'peko' : 'natural';
}

function tongue(c, face) {
  const pattern = tonguePattern(face);
  drawRibbonTongue(c, face, tongueGeometry(face, pattern));
}

function render() {
  if (!image) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (showOriginal) return;
  [...faces, ...manual].forEach((face) => tongue(ctx, face));
}

file.addEventListener('change', () => {
  const selected = file.files?.[0];
  if (selected) load(selected);
});

drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    file.click();
  }
});

$('edited').onclick = () => {
  showOriginal = false;
  $('edited').classList.add('active');
  $('original').classList.remove('active');
  render();
};

$('original').onclick = () => {
  showOriginal = true;
  $('original').classList.add('active');
  $('edited').classList.remove('active');
  render();
};

$('size').oninput = (event) => {
  settings.size = Number(event.target.value) / 100;
  $('sizeOut').value = `${event.target.value}%`;
  render();
};

$('length').oninput = (event) => {
  settings.length = Number(event.target.value) / 100;
  $('lengthOut').value = `${event.target.value}%`;
  render();
};

document.querySelectorAll('[data-style]').forEach((button) => {
  button.onclick = () => {
    settings.style = button.dataset.style;
    document.querySelectorAll('[data-style]').forEach((item) => item.classList.toggle('active', item === button));
    render();
  };
});

document.querySelectorAll('[data-pattern]').forEach((button) => {
  button.onclick = () => {
    settings.pattern = button.dataset.pattern;
    document.querySelectorAll('[data-pattern]').forEach((item) => item.classList.toggle('active', item === button));
    render();
  };
});

$('add').onclick = () => {
  manualMode = !manualMode;
  canvas.classList.toggle('manual', manualMode);
  $('add').textContent = manualMode ? '口元を画像上でタップ' : '見つからない顔を手動で追加';
};

canvas.onclick = (event) => {
  if (!manualMode || !image) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  manual.push({
    id: faces.length + manual.length,
    x,
    y,
    r: Math.max(15, Math.min(canvas.width, canvas.height) * 0.035),
    roll: 0,
    yaw: 0,
    pitch: 0,
  });
  manualMode = false;
  canvas.classList.remove('manual');
  $('add').textContent = '見つからない顔を手動で追加';
  count.textContent = `${faces.length}人を検出 + ${manual.length}人を手動追加`;
  render();
};

$('clearManual').onclick = () => {
  manual = [];
  count.textContent = `${faces.length}人を検出`;
  render();
};

save.onclick = () => {
  if (!image) return;
  const previous = showOriginal;
  showOriginal = false;
  render();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'einstein-edited.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
  showOriginal = previous;
  setTimeout(render);
};

for (const eventName of ['dragenter', 'dragover']) {
  drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.add('drag');
  });
}

for (const eventName of ['dragleave', 'drop']) {
  drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.remove('drag');
  });
}

drop.addEventListener('drop', (event) => {
  const selected = event.dataTransfer?.files?.[0];
  if (selected) load(selected);
});

hideLoading();
