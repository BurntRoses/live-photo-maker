import type { EffectParams, SubjectBounds } from '../core/types';
export type { SubjectBounds } from '../core/types';
export interface SubjectProtection { params: Partial<EffectParams>; message: string; bounds?: SubjectBounds }
interface Landmark { x: number; y: number; visibility?: number }
interface PoseResult { landmarks: Landmark[][]; segmentationMasks?: { width: number; height: number; getAsFloat32Array(): Float32Array }[]; close?: () => void }
interface Detector { detect(image: HTMLCanvasElement): PoseResult }
interface FaceResult { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number } }[] }
interface FaceTask { detect(image: HTMLCanvasElement): FaceResult }
interface WasmFiles { wasmLoaderPath: string; wasmBinaryPath: string }
const VERSION = '0.10.32';
const MODELS = {
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  face: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
};
const CDNS = [
  `https://unpkg.com/@mediapipe/tasks-vision@${VERSION}/wasm/`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm/`,
];
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
let posePromise: Promise<Detector> | undefined;
let facePromise: Promise<FaceTask> | undefined;
let filesPromise: Promise<WasmFiles> | undefined;

/** Static resources only. The caller's pixels never leave this process. */
export async function resource(urls: string[]): Promise<Uint8Array<ArrayBuffer>> {
  let store: Cache | undefined;
  try { store = await caches.open('live-photo-subject-v1'); } catch { /* file:// storage may be unavailable */ }
  for (const url of urls) {
    try {
      const previous = await store?.match(url);
      if (previous) return new Uint8Array(await previous.arrayBuffer());
    } catch { /* a failed cache read can still use the network */ }
  }
  let last: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(18000) });
      if (!response.ok) throw new Error(`资源下载失败（${response.status}）`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (store) { try { await store.put(url, new Response(bytes, { headers: { 'Content-Type': url.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' } })); } catch { /* storage is optional */ } }
      return bytes;
    } catch (error) { last = error; }
  }
  throw last ?? new Error('主体识别资源不可用');
}

export async function visionFiles(): Promise<WasmFiles> {
  if (!filesPromise) filesPromise = (async () => {
    const { FilesetResolver } = await import('@mediapipe/tasks-vision');
    const spec = await FilesetResolver.forVisionTasks(CDNS[0]);
    const loaderName = spec.wasmLoaderPath.split('/').at(-1)!;
    const binaryName = spec.wasmBinaryPath.split('/').at(-1)!;
    const [loader, binary] = await Promise.all([
      resource(CDNS.map(base => base + loaderName)), resource(CDNS.map(base => base + binaryName)),
    ]);
    // These URLs are shared by pose and face tasks for the current page lifetime.
    return {
      wasmLoaderPath: URL.createObjectURL(new Blob([loader], { type: 'text/javascript' })),
      wasmBinaryPath: URL.createObjectURL(new Blob([binary], { type: 'application/wasm' })),
    };
  })().catch(error => { filesPromise = undefined; throw error; });
  return filesPromise;
}
export async function poseDetector(): Promise<Detector> {
  if (!posePromise) posePromise = (async () => {
    const [{ PoseLandmarker }, files, model] = await Promise.all([
      import('@mediapipe/tasks-vision'), visionFiles(), resource([MODELS.pose]),
    ]);
    return PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, runningMode: 'IMAGE',
      numPoses: 4, minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5,
      outputSegmentationMasks: true,
    });
  })().catch(error => { posePromise = undefined; throw error; });
  return posePromise;
}
async function faceDetector(): Promise<FaceTask> {
  if (!facePromise) facePromise = (async () => {
    const [{ FaceDetector }, files, model] = await Promise.all([
      import('@mediapipe/tasks-vision'), visionFiles(), resource([MODELS.face]),
    ]);
    return FaceDetector.createFromOptions(files, { baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: .65 });
  })().catch(error => { facePromise = undefined; throw error; });
  return facePromise;
}

/** Spatially credible body landmarks only; low visibility extrapolated feet are
 * excluded. Head padding accounts for hair above the facial pose keypoints. */
export function boundsFromPoses(poses: Landmark[][]): SubjectBounds | undefined {
  const bodies: SubjectBounds[] = [];
  for (const pose of poses) {
    const visible = (p: Landmark | undefined) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) >= .45 && p.x > -.1 && p.x < 1.1 && p.y > -.1 && p.y < 1.1;
    if (![11, 12, 23, 24].every(index => visible(pose[index]))) continue;
    const points = pose.filter(visible);
    if (points.length < 12) continue;
    const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
    const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
    const height = bottom - top;
    if (height < .12 || right - left < .025) continue;
    const head = pose.slice(0, 11).filter(visible);
    const headWidth = head.length > 1 ? Math.max(...head.map(p => p.x)) - Math.min(...head.map(p => p.x)) : 0;
    const headPad = Math.max(height * .065, headWidth * .45);
    bodies.push({ left: clamp(left - .018), top: clamp(top - headPad), right: clamp(right + .018), bottom: clamp(bottom + Math.max(.012, height * .018)) });
  }
  if (!bodies.length) return;
  return {
    left: Math.min(...bodies.map(b => b.left)), top: Math.min(...bodies.map(b => b.top)),
    right: Math.max(...bodies.map(b => b.right)), bottom: Math.max(...bodies.map(b => b.bottom)),
  };
}

/** The pose's anatomical toe/ankle keypoints are inside a shoe. Use the
 * silhouette from the same local pose model to include hair, clothing and shoes. */
export function boundsFromMask(values: Float32Array, width: number, height: number, body: SubjectBounds): SubjectBounds | undefined {
  let left = width, top = height, right = -1, bottom = -1, count = 0;
  const x0 = Math.max(0, Math.floor((body.left - .12) * width));
  const x1 = Math.min(width - 1, Math.ceil((body.right + .12) * width));
  const y0 = Math.max(0, Math.floor((body.top - .1) * height));
  const y1 = Math.min(height - 1, Math.ceil((body.bottom + .12) * height));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (values[y * width + x] >= .45) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); count++; }
  }
  if (count < width * height * .002 || right < left || bottom < top) return;
  return { left: clamp(left / width - .008), top: clamp(top / height - .008), right: clamp((right + 1) / width + .008), bottom: clamp((bottom + 1) / height + .008) };
}

export function validSubjectBounds(bounds: SubjectBounds): boolean {
  return Object.values(bounds).every(Number.isFinite) && bounds.left >= 0 && bounds.top >= 0 && bounds.right <= 1 && bounds.bottom <= 1 && bounds.right > bounds.left && bounds.bottom > bounds.top;
}

/** Retains the user's aspect ratio. If its static crop cannot contain the whole
 * subject even at minimum reserve, the caller must show the returned fit note. */
export function constrainSubject(params: EffectParams, bounds: SubjectBounds, iw: number, ih: number): EffectParams {
  if (!validSubjectBounds(bounds) || iw <= 0 || ih <= 0) return { ...params };
  const ratio = params.aspect === 'original' ? iw / ih : params.aspect === '3:4' ? .75 : 9 / 16;
  const baseWidth = Math.min(1, ratio / (iw / ih)), baseHeight = Math.min(1, (iw / ih) / ratio);
  const bw = bounds.right - bounds.left, bh = bounds.bottom - bounds.top;
  // Reduce only when needed; a reserve remains for the coverage solver.
  const maxMargin = Math.min((1 - bw / baseWidth) / 2, (1 - bh / baseHeight) / 2);
  const margin = clamp(Math.min(params.margin, maxMargin - .006), .01, .25);
  const vw = baseWidth * (1 - 2 * margin), vh = baseHeight * (1 - 2 * margin);
  const center = (start: number, end: number, visible: number, blurGuard: number) => {
    // A crop touching the source edge cannot cover even a stationary blurred
    // frame. Keep a source-space reserve for the renderer's three-sigma blur.
    const guard = Math.min(Math.max(.003, blurGuard * 1.25), (1 - visible) / 4);
    const imageLo = visible / 2 + guard, imageHi = 1 - visible / 2 - guard;
    const lo = Math.max(imageLo, end - visible / 2), hi = Math.min(imageHi, start + visible / 2);
    return lo <= hi ? clamp((start + end) / 2, lo, hi) : clamp((start + end) / 2, imageLo, imageHi);
  };
  const cropX = center(bounds.left, bounds.right, vw, params.focus * vw / (480 * ratio));
  const cropY = center(bounds.top, bounds.bottom, vh, params.focus * vh / 480);
  const gapX = Math.min(bounds.left - (cropX - vw / 2), (cropX + vw / 2) - bounds.right);
  const gapY = Math.min(bounds.top - (cropY - vh / 2), (cropY + vh / 2) - bounds.bottom);
  // Default measured displacement is <=1.203% of the output. Reserve a little
  // extra for interpolation; exact per-frame corner protection is the renderer's job.
  const gap = Math.max(0, Math.min(gapX / baseWidth, gapY / baseHeight));
  const strength = Math.min(params.strength, gap / .014);
  const rotation = Math.min(params.rotation, gap / .025);
  const zoomAmount = Math.min(params.zoomAmount, gap * 1.25);
  return { ...params, margin, cropX, cropY, strength, rotation, zoomAmount, zoomDirection: zoomAmount < .001 ? 0 : params.zoomDirection };
}

async function nativeFaceBounds(canvas: HTMLCanvasElement): Promise<SubjectBounds | undefined> {
  type NativeFaceDetector = new (options: { fastMode: boolean; maxDetectedFaces: number }) => { detect(source: HTMLCanvasElement): Promise<{ boundingBox: { x: number; y: number; width: number; height: number } }[]> };
  const constructor = (globalThis as unknown as { FaceDetector?: NativeFaceDetector }).FaceDetector;
  if (!constructor) return;
  const faces = await new constructor({ fastMode: false, maxDetectedFaces: 8 }).detect(canvas);
  if (!faces.length) return;
  return {
    left: clamp(Math.min(...faces.map(f => (f.boundingBox.x - f.boundingBox.width * .2) / canvas.width))),
    top: clamp(Math.min(...faces.map(f => (f.boundingBox.y - f.boundingBox.height * .35) / canvas.height))),
    right: clamp(Math.max(...faces.map(f => (f.boundingBox.x + f.boundingBox.width * 1.2) / canvas.width))),
    bottom: clamp(Math.max(...faces.map(f => (f.boundingBox.y + f.boundingBox.height * 1.2) / canvas.height))),
  };
}
async function fallbackFaceBounds(canvas: HTMLCanvasElement): Promise<SubjectBounds | undefined> {
  try { const native = await nativeFaceBounds(canvas); if (native) return native; } catch { /* use the same local MediaPipe runtime */ }
  const result = (await faceDetector()).detect(canvas);
  const faces = result.detections.map(d => d.boundingBox).filter((b): b is NonNullable<typeof b> => !!b);
  if (!faces.length) return;
  return {
    left: clamp(Math.min(...faces.map(b => (b.originX - b.width * .2) / canvas.width))),
    top: clamp(Math.min(...faces.map(b => (b.originY - b.height * .35) / canvas.height))),
    right: clamp(Math.max(...faces.map(b => (b.originX + b.width * 1.2) / canvas.width))),
    bottom: clamp(Math.max(...faces.map(b => (b.originY + b.height * 1.2) / canvas.height))),
  };
}

export async function protectSubject(poster: HTMLCanvasElement, params: EffectParams): Promise<SubjectProtection> {
  const unchanged = { params: {} };
  if (!poster.width || !poster.height) return { ...unchanged, message: '图片尚未准备好，可稍后重试主体保护。' };
  try {
    let bounds: SubjectBounds | undefined, faceOnly = false;
    let bodyFailure = false;
    try {
      const result = (await poseDetector()).detect(poster);
      bounds = boundsFromPoses(result.landmarks);
      if (bounds && result.segmentationMasks?.length) {
        const silhouettes = result.segmentationMasks.map(mask => boundsFromMask(mask.getAsFloat32Array(), mask.width, mask.height, bounds!)).filter((b): b is SubjectBounds => !!b);
        if (silhouettes.length) bounds = {
          left: Math.min(bounds.left, ...silhouettes.map(b => b.left)), top: Math.min(bounds.top, ...silhouettes.map(b => b.top)),
          right: Math.max(bounds.right, ...silhouettes.map(b => b.right)), bottom: Math.max(bounds.bottom, ...silhouettes.map(b => b.bottom)),
        };
      }
      result.close?.();
    } catch { bodyFailure = true; }
    if (!bounds) { bounds = await fallbackFaceBounds(poster); faceOnly = !!bounds; }
    if (!bounds) return { ...unchanged, message: bodyFailure ? '主体识别暂不可用，未自动调整构图；可手动移动画面或减小余量后重试。' : '未识别到可靠的人像，保留当前构图；可手动调整主体位置。' };
    const next = constrainSubject(params, bounds, poster.width, poster.height);
    const ratio = next.aspect === 'original' ? poster.width / poster.height : next.aspect === '3:4' ? .75 : 9 / 16;
    const vw = Math.min(1, ratio / (poster.width / poster.height)) * (1 - 2 * next.margin);
    const vh = Math.min(1, (poster.width / poster.height) / ratio) * (1 - 2 * next.margin);
    const fits = bounds.right - bounds.left <= vw + 1e-6 && bounds.bottom - bounds.top <= vh + 1e-6;
    const message = !fits ? '已找到主体，但当前画幅容不下全部范围；请改用原比例或手动调整构图。'
      : faceOnly ? '已按人脸保留头部空间；身体范围未识别，请检查边缘构图。'
      : next.strength < .05 ? '主体靠近原图边缘，已保留构图并收小运动；可增加原图留白获得更多动态。'
      : '已保留人像的头部与脚部空间，并按构图限制运动。';
    return { params: { margin: next.margin, cropX: next.cropX, cropY: next.cropY, strength: next.strength, rotation: next.rotation, zoomAmount: next.zoomAmount, zoomDirection: next.zoomDirection }, message, bounds };
  } catch {
    return { ...unchanged, message: '主体识别资源未能加载，未自动调整构图；联网后可重试，也可手动移动画面和减小余量。' };
  }
}
