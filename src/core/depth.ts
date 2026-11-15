/** Local foreground separation for small depth-parallax movements.
 * The hidden background uses surrounding edge colours. This is deliberately a
 * small-reveal reconstruction, not a generative reconstruction of hidden objects.
 */
export interface DepthPoint { x: number; y: number }
export interface DepthLayers {
  background: HTMLCanvasElement;
  foreground: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  width: number;
  height: number;
}

export function depthPolygon(points: readonly DepthPoint[]): DepthPoint[] {
  return normalizedOutline(points, false);
}

function normalizedOutline(points: readonly DepthPoint[], allowFullFrame: boolean): DepthPoint[] {
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('前景轮廓包含无效坐标');
  const clean = points.map(p => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }))
    .filter((p, i, list) => i === 0 || Math.hypot(p.x - list[i - 1].x, p.y - list[i - 1].y) > .0001);
  if (clean.length > 1 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) < .0001) clean.pop();
  if (clean.length < 3) throw new Error('沿前景边缘至少点选三个位置，再完成分层');
  const area = Math.abs(clean.reduce((sum, p, i) => { const q = clean[(i + 1) % clean.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
  if (area < .00015) throw new Error('前景范围太小，请沿物体外轮廓重新点选');
  if (!allowFullFrame && area > .9) throw new Error('请留出一部分背景，让前后图层产生视差');
  return clean;
}

/** Rasterize the union of moving polygons, subtract the protected subject and
 * return its complement: 255 is static, 0 is allowed to move. Scanlines avoid
 * per-pixel polygon walks and make overlapping selections independent of order.
 */
export function backgroundSelectionAlpha(width: number, height: number, movingPolygons: ReadonlyArray<ReadonlyArray<DepthPoint>>, protectedPolygon?: ReadonlyArray<DepthPoint>): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('背景选区尺寸无效');
  if (!movingPolygons.length) throw new Error('请先选择需要移动的背景区域');
  const moving = movingPolygons.map(points => normalizedOutline(points, true));
  const protectedPoints = protectedPolygon?.length ? normalizedOutline(protectedPolygon, true) : undefined;
  const alpha = new Uint8ClampedArray(width * height).fill(255);
  const fill = (polygon: DepthPoint[], value: number) => {
    const low = Math.max(0, Math.ceil(Math.min(...polygon.map(p => p.y)) * height - .5));
    const high = Math.min(height - 1, Math.floor(Math.max(...polygon.map(p => p.y)) * height - .5));
    for (let y = low; y <= high; y++) {
      const py = (y + .5) / height, intersections: number[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        if ((a.y <= py && b.y > py) || (b.y <= py && a.y > py)) intersections.push((a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y)) * width);
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const start = Math.max(0, Math.ceil(intersections[i] - .5)), end = Math.min(width, Math.ceil(intersections[i + 1] - .5));
        if (start < end) alpha.fill(value, y * width + start, y * width + end);
      }
    }
  };
  moving.forEach(polygon => fill(polygon, 0));
  if (protectedPoints) fill(protectedPoints, 255);
  const staticCount = alpha.reduce((sum, value) => sum + (value >= 128 ? 1 : 0), 0);
  validateDepthMaskArea(staticCount, alpha.length, 'background-selection');
  return alpha;
}

type DepthMaskPurpose = 'foreground' | 'background-selection';
export function validateDepthMaskArea(staticCount: number, total: number, purpose: DepthMaskPurpose = 'foreground'): void {
  if (purpose === 'background-selection') {
    if (total - staticCount < Math.max(4, total * .001)) throw new Error('可移动背景范围太小，或已被保护物体完全覆盖');
    if (staticCount < Math.max(4, total * .001)) throw new Error('请保留一部分静态画面或指定要保护的物体');
  } else {
    if (staticCount < total * .001) throw new Error('没有找到可靠前景，请点选物体中心后重试');
    if (staticCount > total * .93) throw new Error('前景几乎覆盖画面，请点选更明确的物体');
  }
}

interface PyramidLevel { width: number; height: number; rgb: Float32Array; known: Float32Array }

/** Pure pixel reconstruction; fixed pixels remain byte-identical. */
export function inpaintDepthBackground(source: Uint8ClampedArray, hole: Uint8Array, width: number, height: number): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || source.length !== width * height * 4 || hole.length !== width * height) throw new Error('分层像素尺寸不匹配');
  const base: PyramidLevel = { width, height, rgb: new Float32Array(width * height * 3), known: new Float32Array(width * height) };
  let knownCount = 0;
  for (let i = 0; i < hole.length; i++) if (!hole[i]) {
    base.known[i] = 1; knownCount++;
    for (let c = 0; c < 3; c++) base.rgb[i * 3 + c] = source[i * 4 + c];
  }
  if (!knownCount) throw new Error('轮廓覆盖了整个画面，请保留可见背景');
  if (knownCount === hole.length) return new Uint8ClampedArray(source);
  const levels = [base];
  while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1) {
    const previous = levels[levels.length - 1];
    const w = Math.ceil(previous.width / 2), h = Math.ceil(previous.height / 2);
    const level: PyramidLevel = { width: w, height: h, rgb: new Float32Array(w * h * 3), known: new Float32Array(w * h) };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let weight = 0, count = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = x * 2 + dx, sy = y * 2 + dy;
        if (sx >= previous.width || sy >= previous.height) continue;
        const si = sy * previous.width + sx, k = previous.known[si]; weight += k; count++;
        for (let c = 0; c < 3; c++) level.rgb[i * 3 + c] += previous.rgb[si * 3 + c] * k;
      }
      level.known[i] = weight / count;
      if (weight) for (let c = 0; c < 3; c++) level.rgb[i * 3 + c] /= weight;
    }
    levels.push(level);
  }
  // Pull coarse estimates down through the hole, then relax only missing pixels.
  // Preserving known neighbours at every level keeps the visible reveal tied to
  // the actual object's surroundings rather than a global average wash.
  for (let n = levels.length - 2; n >= 0; n--) {
    const current = levels[n], coarse = levels[n + 1], { width: w, height: h } = current;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (current.known[i]) continue;
      const px = Math.max(0, (x + .5) / 2 - .5), py = Math.max(0, (y + .5) / 2 - .5);
      const x0 = Math.min(coarse.width - 1, Math.floor(px)), y0 = Math.min(coarse.height - 1, Math.floor(py));
      const x1 = Math.min(coarse.width - 1, x0 + 1), y1 = Math.min(coarse.height - 1, y0 + 1), fx = px - x0, fy = py - y0;
      for (let c = 0; c < 3; c++) current.rgb[i * 3 + c] =
        (coarse.rgb[(y0 * coarse.width + x0) * 3 + c] * (1 - fx) + coarse.rgb[(y0 * coarse.width + x1) * 3 + c] * fx) * (1 - fy) +
        (coarse.rgb[(y1 * coarse.width + x0) * 3 + c] * (1 - fx) + coarse.rgb[(y1 * coarse.width + x1) * 3 + c] * fx) * fy;
    }
    let next: Float32Array = new Float32Array(current.rgb.length);
    for (let iteration = 0; iteration < 16; iteration++) {
      next.set(current.rgb);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (current.known[i]) continue;
        const left = y * w + Math.max(0, x - 1), right = y * w + Math.min(w - 1, x + 1);
        const top = Math.max(0, y - 1) * w + x, bottom = Math.min(h - 1, y + 1) * w + x;
        for (let c = 0; c < 3; c++) next[i * 3 + c] = (current.rgb[left * 3 + c] + current.rgb[right * 3 + c] + current.rgb[top * 3 + c] + current.rgb[bottom * 3 + c]) / 4;
      }
      const old = current.rgb; current.rgb = next; next = old;
    }
  }
  const result = new Uint8ClampedArray(source);
  for (let i = 0; i < hole.length; i++) if (hole[i]) {
    for (let c = 0; c < 3; c++) result[i * 4 + c] = base.rgb[i * 3 + c];
    result[i * 4 + 3] = 255;
  }
  return result;
}

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}
function context(canvas: HTMLCanvasElement, read = false): CanvasRenderingContext2D {
  const result = canvas.getContext('2d', { willReadFrequently: read });
  if (!result) throw new Error('浏览器无法创建分层画布');
  return result;
}
function trace(c: CanvasRenderingContext2D, polygon: DepthPoint[], width: number, height: number) {
  c.beginPath(); polygon.forEach((p, i) => i ? c.lineTo(p.x * width, p.y * height) : c.moveTo(p.x * width, p.y * height)); c.closePath();
}

export async function buildDepthLayers(source: CanvasImageSource, width: number, height: number, points: Array<DepthPoint>, onProgress?: (message: string) => void): Promise<DepthLayers> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('照片尺寸无效');
  const polygon = depthPolygon(points), scale = Math.min(1, 1600 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const hardMask = makeCanvas(w, h), hc = context(hardMask);
  hc.fillStyle = '#fff'; trace(hc, polygon, w, h); hc.fill();
  return buildDepthLayersFromMask(source, width, height, hardMask, onProgress);
}

/** Linear-time binary dilation keeps foreground pixels out of the reconstructed
 * background, including the narrow antialiased edge of a model mask. */
export function dilateDepthMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (mask.length !== width * height || width < 1 || height < 1) throw new Error('分层遮罩尺寸不匹配');
  const r = Math.max(0, Math.round(radius)), horizontal = new Uint8Array(mask.length), result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let sum = 0; for (let x = 0; x <= Math.min(width - 1, r); x++) sum += mask[y * width + x] ? 1 : 0;
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum > 0 ? 1 : 0;
      if (x - r >= 0) sum -= mask[y * width + x - r] ? 1 : 0;
      if (x + r + 1 < width) sum += mask[y * width + x + r + 1] ? 1 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0; for (let y = 0; y <= Math.min(height - 1, r); y++) sum += horizontal[y * width + x];
    for (let y = 0; y < height; y++) {
      result[y * width + x] = sum > 0 ? 1 : 0;
      if (y - r >= 0) sum -= horizontal[(y - r) * width + x];
      if (y + r + 1 < height) sum += horizontal[(y + r + 1) * width + x];
    }
  }
  return result;
}

/** Keep the full static silhouette opaque, including its antialiased fringe.
 * Two source pixels protect the silhouette during crop/texture resampling. A
 * one-pixel feather is added only outside that guard; static pixels never mix
 * with a different background frame, so their outline cannot shimmer.
 */
export function staticProtectionAlpha(silhouette: Uint8Array, width: number, height: number, padding = 2): Uint8ClampedArray {
  const solid = dilateDepthMask(silhouette, width, height, padding), alpha = new Uint8ClampedArray(solid.length);
  const horizontal = new Uint16Array(solid.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    horizontal[i] = solid[y * width + Math.max(0, x - 1)] + solid[i] * 2 + solid[y * width + Math.min(width - 1, x + 1)];
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    alpha[i] = solid[i] ? 255 : Math.round((horizontal[Math.max(0, y - 1) * width + x] + horizontal[i] * 2 + horizontal[Math.min(height - 1, y + 1) * width + x]) * 255 / 16);
  }
  return alpha;
}

/** Accepts a white-on-transparent alpha mask, including local model output. */
export async function buildDepthLayersFromMask(source: CanvasImageSource, width: number, height: number, sourceMask: HTMLCanvasElement, onProgress?: (message: string) => void): Promise<DepthLayers> {
  return layersFromMask(source, width, height, sourceMask, onProgress, 'foreground');
}

/** Only the selected background can move. Everything else, including the
 * protected subject inside a selection, belongs to the static foreground.
 * Keep the original subject polygon separately for crop/subject bounds.
 */
export async function buildDepthLayersForBackground(source: CanvasImageSource, width: number, height: number, movingPolygons: Array<Array<DepthPoint>>, protectedPolygon?: Array<DepthPoint>, onProgress?: (message: string) => void): Promise<DepthLayers> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('照片尺寸无效');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const alpha = backgroundSelectionAlpha(w, h, movingPolygons, protectedPolygon);
  const sourceMask = makeCanvas(w, h), c = context(sourceMask), pixels = c.createImageData(w, h);
  for (let i = 0; i < alpha.length; i++) { pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = alpha[i]; }
  c.putImageData(pixels, 0, 0);
  return layersFromMask(source, width, height, sourceMask, onProgress, 'background-selection');
}

async function layersFromMask(source: CanvasImageSource, width: number, height: number, sourceMask: HTMLCanvasElement, onProgress: ((message: string) => void) | undefined, purpose: DepthMaskPurpose): Promise<DepthLayers> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !sourceMask.width || !sourceMask.height) throw new Error('照片或分层遮罩尺寸无效');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const original = makeCanvas(w, h), oc = context(original);
  oc.fillStyle = '#f6f4ee'; oc.fillRect(0, 0, w, h); oc.drawImage(source, 0, 0, w, h);
  onProgress?.('正在分离前景轮廓…'); await pause();
  const hardMask = makeCanvas(w, h), hc = context(hardMask, true); hc.drawImage(sourceMask, 0, 0, w, h);
  const values = hc.getImageData(0, 0, w, h), binary = new Uint8Array(w * h), silhouette = new Uint8Array(w * h); let count = 0;
  for (let i = 0; i < binary.length; i++) {
    const alpha = values.data[i * 4 + 3];
    binary[i] = alpha > 12 ? 1 : 0;
    silhouette[i] = alpha > 0 ? 1 : 0;
    if (alpha >= 128) count++;
  }
  validateDepthMaskArea(count, w * h, purpose);
  const mask = makeCanvas(w, h), mc = context(mask);
  const protection = staticProtectionAlpha(silhouette, w, h), protectionImage = mc.createImageData(w, h);
  for (let i = 0; i < protection.length; i++) {
    protectionImage.data[i * 4] = protectionImage.data[i * 4 + 1] = protectionImage.data[i * 4 + 2] = 255;
    protectionImage.data[i * 4 + 3] = protection[i];
  }
  mc.putImageData(protectionImage, 0, 0);
  const foreground = makeCanvas(w, h), fc = context(foreground);
  fc.drawImage(original, 0, 0); fc.globalCompositeOperation = 'destination-in'; fc.drawImage(mask, 0, 0); fc.globalCompositeOperation = 'source-over';
  const holeCanvas = makeCanvas(w, h), holeContext = context(holeCanvas);
  let dilated = dilateDepthMask(binary, w, h, Math.max(2, Math.min(w, h) * .003));
  // A narrow user-selected window can disappear during expansion. In that case
  // retain its actual known pixels rather than fabricating an empty background.
  if (purpose === 'background-selection' && !dilated.includes(0)) dilated = binary;
  const holeImage = holeContext.createImageData(w, h);
  for (let i = 0; i < dilated.length; i++) if (dilated[i]) { holeImage.data[i * 4] = 255; holeImage.data[i * 4 + 1] = 255; holeImage.data[i * 4 + 2] = 255; holeImage.data[i * 4 + 3] = 255; }
  holeContext.putImageData(holeImage, 0, 0);
  // Reconstruct at modest resolution; retain full-resolution untouched pixels
  // outside the selected object so the background texture stays photographic.
  const workScale = Math.min(1, 512 / Math.max(w, h)), sw = Math.max(1, Math.round(w * workScale)), sh = Math.max(1, Math.round(h * workScale));
  const work = makeCanvas(sw, sh), wc = context(work, true); wc.drawImage(original, 0, 0, sw, sh);
  const sourcePixels = wc.getImageData(0, 0, sw, sh);
  wc.clearRect(0, 0, sw, sh); wc.drawImage(holeCanvas, 0, 0, sw, sh);
  const holePixels = wc.getImageData(0, 0, sw, sh), hole = new Uint8Array(sw * sh);
  for (let i = 0; i < hole.length; i++) hole[i] = holePixels.data[i * 4 + 3] > (purpose === 'background-selection' ? 127 : 8) ? 1 : 0;
  onProgress?.('正在延展遮挡处的背景…'); await pause();
  const repaired = inpaintDepthBackground(sourcePixels.data, hole, sw, sh);
  sourcePixels.data.set(repaired); wc.putImageData(sourcePixels, 0, 0);
  const patch = makeCanvas(w, h), pc = context(patch);
  pc.imageSmoothingEnabled = true; pc.imageSmoothingQuality = 'high'; pc.drawImage(work, 0, 0, w, h);
  pc.globalCompositeOperation = 'destination-in'; pc.drawImage(holeCanvas, 0, 0); pc.globalCompositeOperation = 'source-over';
  const background = makeCanvas(w, h), bc = context(background);
  bc.drawImage(original, 0, 0); bc.drawImage(patch, 0, 0);
  onProgress?.('前后图层已就绪');
  return { background, foreground, mask, width: w, height: h };
}
