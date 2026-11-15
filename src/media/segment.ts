import type { InteractiveSegmenter } from '@mediapipe/tasks-vision';
import { buildDepthLayersFromMask, type DepthLayers } from '../core/depth';
import { boundsFromPoses, poseDetector, resource, visionFiles } from './subject';

/** MagicTouch v1 requires the InteractiveSegmenterGraph API in MediaPipe 0.10.21.
 * Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf
 * Model licence: Apache-2.0. Only static model/WASM resources are downloaded.
 */
export const INTERACTIVE_MODEL = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';
export interface SegmentSeed { x: number; y: number }
export interface ConfidenceMask { values: Float32Array; width: number; height: number }
let segmenterPromise: Promise<InteractiveSegmenter> | undefined;

async function segmenter(): Promise<InteractiveSegmenter> {
  if (!segmenterPromise) segmenterPromise = (async () => {
    const [{ InteractiveSegmenter }, files, model] = await Promise.all([
      import('@mediapipe/tasks-vision'), visionFiles(), resource([INTERACTIVE_MODEL]),
    ]);
    return InteractiveSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: model, delegate: 'CPU' },
      outputConfidenceMasks: true, outputCategoryMask: false,
    });
  })().catch(error => { segmenterPromise = undefined; throw error; });
  return segmenterPromise;
}

/** Select the output class containing the positive point instead of assuming
 * the model always returns its foreground class at a particular array index. */
export function selectForegroundMask(masks: readonly ConfidenceMask[], seed: SegmentSeed): ConfidenceMask {
  let selected: ConfidenceMask | undefined, best = -Infinity;
  for (const mask of masks) {
    if (mask.width < 1 || mask.height < 1 || mask.values.length !== mask.width * mask.height) continue;
    const sx = Math.min(mask.width - 1, Math.max(0, Math.round(seed.x * (mask.width - 1))));
    const sy = Math.min(mask.height - 1, Math.max(0, Math.round(seed.y * (mask.height - 1))));
    let score = 0, count = 0;
    for (let y = Math.max(0, sy - 1); y <= Math.min(mask.height - 1, sy + 1); y++) for (let x = Math.max(0, sx - 1); x <= Math.min(mask.width - 1, sx + 1); x++) { score += mask.values[y * mask.width + x]; count++; }
    score /= count;
    if (score > best) { selected = mask; best = score; }
  }
  if (!selected || best < .55) throw new Error('物体边界不够明确，请点选物体内部后重试');
  // MediaPipe callback data expires as soon as the callback returns.
  return { width: selected.width, height: selected.height, values: selected.values.slice() };
}

/** Retain only the connected object containing the point. Small detached model
 * specks otherwise become floating cut-outs during background motion. */
export function foregroundAlpha(mask: ConfidenceMask, seed: SegmentSeed): Uint8ClampedArray {
  const { width: w, height: h, values } = mask;
  if (w < 1 || h < 1 || values.length !== w * h) throw new Error('主体识别返回了无效遮罩');
  const sx = Math.min(w - 1, Math.max(0, Math.round(seed.x * (w - 1)))), sy = Math.min(h - 1, Math.max(0, Math.round(seed.y * (h - 1))));
  const start = sy * w + sx;
  if (!Number.isFinite(values[start]) || values[start] < .42) throw new Error('选中的位置不在明确物体内，请重新点选');
  const visited = new Uint8Array(w * h), queue = new Uint32Array(w * h); let head = 0, tail = 1, solid = 0;
  queue[0] = start; visited[start] = 1;
  while (head < tail) {
    const i = queue[head++], x = i % w, y = Math.floor(i / w);
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !visited[j] && Number.isFinite(values[j]) && values[j] >= .38) { visited[j] = 1; queue[tail++] = j; }
    }
  }
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < visited.length; i++) if (visited[i]) {
    const t = Math.max(0, Math.min(1, (values[i] - .38) / .24)); alpha[i] = Math.round(t * t * (3 - 2 * t) * 255); if (alpha[i] >= 128) solid++;
  }
  if (solid < w * h * .001) throw new Error('识别到的物体太小，请点选主要物体后重试');
  if (solid > w * h * .93) throw new Error('识别范围几乎覆盖画面，请点选更明确的物体');
  return alpha;
}

/** A point on clothing can select that garment rather than a whole person.
 * Use the pose model's full silhouette when credible body landmarks exist.
 * Each accepted pose contributes its own aligned mask, including group photos.
 */
export function fullPersonConfidence(poses: Array<Array<{ x: number; y: number; visibility?: number }>>, masks: readonly ConfidenceMask[]): ConfidenceMask | undefined {
  const credible = poses.map((pose, index) => boundsFromPoses([pose]) ? masks[index] : undefined)
    .filter((mask): mask is ConfidenceMask => !!mask && mask.width > 0 && mask.height > 0 && mask.values.length === mask.width * mask.height);
  if (!credible.length) return;
  const { width, height } = credible[0], values = new Float32Array(width * height);
  for (const mask of credible) {
    if (mask.width !== width || mask.height !== height) continue;
    for (let i = 0; i < values.length; i++) if (Number.isFinite(mask.values[i])) values[i] = Math.max(values[i], Math.min(1, Math.max(0, mask.values[i])));
  }
  return { width, height, values };
}

function maskCanvas(confidence: ConfidenceMask, seed?: SegmentSeed): HTMLCanvasElement {
  const alpha = seed ? foregroundAlpha(confidence, seed) : confidence.values.map(value => {
    const t = Math.max(0, Math.min(1, (value - .38) / .24)); return Math.round(t * t * (3 - 2 * t) * 255);
  });
  const mask = document.createElement('canvas'); mask.width = confidence.width; mask.height = confidence.height;
  const mc = mask.getContext('2d'); if (!mc) throw new Error('浏览器无法创建主体遮罩');
  const pixels = mc.createImageData(mask.width, mask.height);
  for (let i = 0; i < alpha.length; i++) { pixels.data[i * 4] = 255; pixels.data[i * 4 + 1] = 255; pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = alpha[i]; }
  mc.putImageData(pixels, 0, 0); return mask;
}

/** One local positive point selects an object without a hand-drawn polygon.
 * The optional retry point is useful when the default centre lands on scenery.
 */
export async function automaticLayers(source: HTMLCanvasElement, seed?: SegmentSeed, onProgress?: (message: string) => void): Promise<DepthLayers> {
  if (!source.width || !source.height) throw new Error('照片尚未准备好');
  const point = seed ?? { x: .5, y: .58 };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error('请在照片内选择前景物体');
  const input = document.createElement('canvas'), scale = Math.min(1, 1200 / Math.max(source.width, source.height));
  input.width = Math.max(1, Math.round(source.width * scale)); input.height = Math.max(1, Math.round(source.height * scale));
  const ic = input.getContext('2d'); if (!ic) throw new Error('浏览器无法创建主体识别画布');
  ic.drawImage(source, 0, 0, input.width, input.height);
  onProgress?.('正在识别完整人像…');
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  let people: ConfidenceMask | undefined;
  try {
    const result = (await poseDetector()).detect(input);
    try {
      people = fullPersonConfidence(result.landmarks, (result.segmentationMasks ?? []).map(mask => ({ width: mask.width, height: mask.height, values: mask.getAsFloat32Array() })));
    } finally { result.close?.(); }
  } catch { /* A missing pose model must not prevent general object selection. */ }
  if (people) {
    const x = Math.min(people.width - 1, Math.round(point.x * (people.width - 1))), y = Math.min(people.height - 1, Math.round(point.y * (people.height - 1)));
    if (!seed || people.values[y * people.width + x] >= .42) return buildDepthLayersFromMask(source, source.width, source.height, maskCanvas(people), onProgress);
  }
  onProgress?.('正在加载本机物体分离模型…');
  let task: InteractiveSegmenter;
  try { task = await segmenter(); } catch { throw new Error('主体分离模型未能加载，请联网后重试'); }
  onProgress?.('正在识别前景与背景…');
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  let confidence: ConfidenceMask;
  const result = task.segment(input, { keypoint: point });
  try {
    confidence = selectForegroundMask((result.confidenceMasks ?? []).map(mask => ({ width: mask.width, height: mask.height, values: mask.getAsFloat32Array() })), point);
  } finally { result.close(); }
  return buildDepthLayersFromMask(source, source.width, source.height, maskCanvas(confidence, point), onProgress);
}
