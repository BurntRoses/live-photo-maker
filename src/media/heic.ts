/** Unmodified LGPL-3.0 decoder, downloaded only after native HEIC decoding fails.
 * Sources and the exact libheif/libde265 build are in THIRD_PARTY_NOTICES.md. */
const VERSION = '1.23.5';
const RESOURCES = [
  `https://cdn.jsdelivr.net/npm/libheif-js@${VERSION}/libheif-wasm/libheif-bundle.mjs`,
  `https://unpkg.com/libheif-js@${VERSION}/libheif-wasm/libheif-bundle.mjs`,
];
const CACHE = `live-photo-heic-${VERSION}`;
let modulePromise: Promise<string> | undefined;

async function moduleAddress(bytes: ArrayBuffer): Promise<string> {
  const blob = new Blob([bytes], { type: 'text/javascript' });
  if (location.protocol !== 'file:') return URL.createObjectURL(blob);
  // file:// has an opaque origin in Chrome. Data URLs let the downloaded,
  // self-contained module load in a worker when the HTML is double-clicked.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('HEIC 解码器读取失败，请重新导入重试'));
    reader.readAsDataURL(blob);
  });
}

async function decoderModule(): Promise<string> {
  modulePromise ??= (async () => {
    let cache: Cache | undefined;
    try { cache = await caches.open(CACHE); } catch { /* file:// may have no CacheStorage */ }
    for (const url of RESOURCES) {
      try {
        const saved = await cache?.match(url);
        if (saved) return moduleAddress(await saved.arrayBuffer());
      } catch { /* a cache failure can still use the network */ }
    }
    for (const url of RESOURCES) {
      try {
        const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(18000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (cache) {
          try { await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'text/javascript' } })); } catch { /* quota is optional */ }
        }
        return moduleAddress(bytes);
      } catch { /* try the other fixed-version CDN */ }
    }
    throw new Error('HEIC 解码器下载失败，请联网后重新导入重试');
  })().catch(error => { modulePromise = undefined; throw error; });
  return modulePromise;
}

// A separate worker releases all decoder memory when this photo has finished.
// Its only input is a local copy of the file bytes; it performs no fetches.
const WORKER = `self.onmessage = async ({ data }) => {
  let images;
  try {
    const { default: createDecoder } = await import(data.moduleURL);
    const lib = await createDecoder();
    images = new lib.HeifDecoder().decode(new Uint8Array(data.bytes));
    if (!images.length) throw new Error('HEIC 文件中没有可读取的照片');
    const image = images.find(item => item.is_primary()) || images[0];
    const width = image.get_width(), height = image.get_height();
    if (!(width > 0 && height > 0)) throw new Error('HEIC 照片尺寸无效');
    const pixels = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    const result = await new Promise(resolve => image.display(pixels, resolve));
    if (!result) throw new Error('无法解码这张 HEIC 照片，请换一个完整的文件重试');
    self.postMessage({ width, height, pixels: result.data }, [result.data.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (images) for (const image of images) image.free();
  }
};`;

interface DecodedImage { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer>; error?: string }

/** Produce a local JPEG preview without altering the original File or metadata. */
export async function convertHeic(file: File): Promise<Blob> {
  const moduleURL = await decoderModule();
  const bytes = await file.arrayBuffer();
  const workerURL = location.protocol === 'file:' ? `data:text/javascript,${encodeURIComponent(WORKER)}` : URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(workerURL, { type: 'module' });
    const image = await new Promise<DecodedImage>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('HEIC 解码超时，请重新导入或换一张照片重试')), 60000);
      worker!.onmessage = ({ data }: MessageEvent<DecodedImage>) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker!.onerror = () => reject(new Error('浏览器无法启动 HEIC 解码器，请使用最新版 Chrome、Edge、Firefox 或 Safari 重试'));
      worker!.postMessage({ moduleURL, bytes }, [bytes]);
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建照片画布，请重新导入重试');
    context.putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('HEIC 预览生成失败，请重新导入重试')), 'image/jpeg', .98));
  } finally {
    clearTimeout(timer);
    worker?.terminate();
    URL.revokeObjectURL(workerURL);
  }
}
