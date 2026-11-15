import FFmpegWorker from '@ffmpeg/ffmpeg/worker?worker&inline';
type Progress = (value: number, message: string) => void;
const BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/';
async function cachedDownload(url: string): Promise<Blob> {
  let cache: Cache | undefined;
  try { cache = await caches.open('live-photo-codecs-v1'); const saved = await cache.match(url); if (saved) return saved.blob(); } catch { /* file origins may not have CacheStorage */ }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`编码器下载失败（${response.status}），请联网后重试`);
  if (cache) { try { await cache.put(url, response.clone()); } catch { /* quota does not prevent this run */ } }
  return response.blob();
}
export class WasmCodec {
  private worker: Worker | null = null;
  private id = 0;
  private pending = new Map<number, { resolve: (data: any) => void; reject: (e: Error) => void }>();
  private loading?: Promise<void>;
  private urls: string[] = [];
  onProgress?: Progress;
  private call(type: string, data: any): Promise<any> {
    if (!this.worker) throw new Error('本地编码器尚未启动');
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker!.postMessage({ id, type, data }); });
  }
  async load(onProgress?: Progress) {
    this.onProgress = onProgress;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      onProgress?.(0, '首次加载兼容编码器（约 31 MB），素材不会上传');
      this.worker = new FFmpegWorker();
      this.worker.onmessage = ({ data: m }) => {
        if (m.type === 'PROGRESS') { this.onProgress?.(Math.min(.99, Math.max(0, m.data.progress)), '正在本机处理'); return; }
        const p = this.pending.get(m.id); if (!p) return;
        this.pending.delete(m.id); if (m.type === 'ERROR') p.reject(new Error(String(m.data))); else p.resolve(m.data);
      };
      this.worker.onerror = () => { this.cancel(new Error('浏览器无法启动兼容编码器，请使用 Chrome 或通过本地服务器打开')); };
      const [js, wasm] = await Promise.all([cachedDownload(BASE + 'ffmpeg-core.js'), cachedDownload(BASE + 'ffmpeg-core.wasm')]);
      const coreURL = URL.createObjectURL(new Blob([await js.text()], { type: 'text/javascript' })), wasmURL = URL.createObjectURL(wasm);
      this.urls.push(coreURL, wasmURL);
      await this.call('LOAD', { coreURL, wasmURL });
    })().catch(e => { this.cancel(); throw e; });
    return this.loading;
  }
  async write(path: string, data: Uint8Array) { await this.call('WRITE_FILE', { path, data }); }
  async read(path: string): Promise<Uint8Array> { return this.call('READ_FILE', { path }); }
  async remove(path: string) { await this.call('DELETE_FILE', { path }).catch(() => undefined); }
  async exec(args: string[]) { const code = await this.call('EXEC', { args }); if (code !== 0) throw new Error(`兼容编码未成功（${code}）。请缩小素材或更换浏览器重试。`); }
  async compatibleVideo(file: File): Promise<{ blob: Blob; originalDuration: number }> {
    await this.write('source', new Uint8Array(await file.arrayBuffer()));
    const code = await this.call('FFPROBE', { args: ['-v','error','-show_entries','format=duration','-of','json','-o','probe.json','source'] });
    if(code!==0) throw new Error('无法读取这段视频，请确认文件没有损坏');
    const info = JSON.parse(new TextDecoder().decode(await this.read('probe.json'))), duration = Number(info.format?.duration);
    if(!Number.isFinite(duration)||duration<=0) throw new Error('无法确认视频时长');
    await this.exec(['-ss', String(Math.max(0, (duration-5)/2)), '-i','source','-t','5','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart','compatible.mp4']);
    const data=await this.read('compatible.mp4'); await Promise.all(['source','probe.json','compatible.mp4'].map(x=>this.remove(x)));
    return { blob: new Blob([data as BlobPart], { type:'video/mp4' }), originalDuration:duration };
  }
  cancel(reason: string | Error='已取消处理') {
    this.worker?.terminate(); this.worker=null;this.loading=undefined;
    const error=typeof reason==='string'?new DOMException(reason,'AbortError'):reason;
    for(const p of this.pending.values()) p.reject(error);
    this.pending.clear();this.urls.forEach(URL.revokeObjectURL);this.urls=[];
  }
}
