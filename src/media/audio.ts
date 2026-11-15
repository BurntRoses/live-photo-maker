import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import type { AudioSettings } from '../core/types';

/** CC0 field recordings. */
export const AMBIENCES = [
  { id: 'room', label: '安静室内', url: 'room.mp3' },
  { id: 'wind', label: '轻风', url: 'wind.mp3' },
  { id: 'street', label: '街道', url: 'street.mp3' },
  { id: 'cafe', label: '咖啡馆人声', url: 'cafe.mp3' },
  { id: 'rain', label: '细雨', url: 'rain.mp3' },
  { id: 'ocean', label: '海浪', url: 'ocean.mp3' },
  { id: 'forest', label: '森林鸟鸣', url: 'forest.mp3' },
  { id: 'traffic', label: '城市车流', url: 'traffic.mp3' },
  { id: 'night', label: '夜晚虫鸣', url: 'night.mp3' },
  { id: 'library', label: '图书馆', url: 'library.mp3' },
  { id: 'subway', label: '地铁车厢', url: 'subway.mp3' },
];

const VERSION = '1.0.0';
const PUBLIC_AUDIO = 'https://burntroses.github.io/live-photo-maker/audio/';
const RATE = 48_000;
let assetBase = typeof location !== 'undefined' && location.protocol !== 'file:'
  ? new URL('audio/', location.href).href
  : 'https://burntroses.github.io/live-photo-maker/audio/';

export function setAssetBaseURL(base: string): void {
  assetBase = base.endsWith('/') ? base : `${base}/`;
}

const downloaded = new Map<string, ArrayBuffer>();
let cacheDb: Promise<IDBDatabase | null> | undefined;

function openCache(): Promise<IDBDatabase | null> {
  if (!cacheDb) cacheDb = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const timeout = setTimeout(() => resolve(null), 1800);
    const finish = (value: IDBDatabase | null) => { clearTimeout(timeout); resolve(value); };
    try {
      const request = indexedDB.open('live-photo-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('recordings');
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
  return cacheDb;
}

async function cachedBytes(url: string): Promise<ArrayBuffer> {
  const present = downloaded.get(url);
  if (present) return present;
  const database = await openCache();
  if (database) {
    const saved = await new Promise<ArrayBuffer | null>((resolve) => {
      try {
        const query = database.transaction('recordings').objectStore('recordings').get(url);
        query.onsuccess = () => resolve(query.result instanceof ArrayBuffer ? query.result : null);
        query.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    if (saved) { downloaded.set(url, saved); return saved; }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok && typeof location!=='undefined' && location.hostname!=='burntroses.github.io') {
      const filename = new URL(url).pathname.split('/').pop();
      if (filename && /^[a-z]+\.mp3$/.test(filename)) response=await fetch(PUBLIC_AUDIO+filename,{signal:controller.signal,credentials:'omit'});
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.headers.get('Content-Type')?.includes('text/html')) throw new Error('服务器返回网页而不是声音文件');
    const data = await response.arrayBuffer();
    if (data.byteLength < 100) throw new Error('音频文件不完整');
    downloaded.set(url, data);
    if (database) {
      try {
        const save = database.transaction('recordings', 'readwrite').objectStore('recordings').put(data, url);
        save.onerror = () => { /* Private/file browsing may not permit disk caches. */ };
      } catch { /* In-memory caching still works. */ }
    }
    return data;
  } catch (error) {
    throw new Error(`声音下载失败：${error instanceof Error ? error.message : String(error)}。首次使用需要联网，请检查网络后重试；也可以选择无背景音或自带音频。`);
  } finally { clearTimeout(timeout); }
}

export interface PcmAudio {
  sampleRate: number;
  channels: readonly Float32Array[];
}

/** Place a timestamped decoder chunk on one integer output sample grid.
 *
 * AAC timestamps such as 7168 / 48000 are not exact binary floats. Using ceil
 * independently for starts and ends can omit one sample at each chunk edge.
 * Round each boundary to the nearest output frame, then copy continuously.
 */
export function placePcmChunk(
  output: Float32Array[], source: PcmAudio, relativeStartSeconds: number, sampleRate = RATE,
): number {
  const frame = (seconds: number) => Math.round(seconds * sampleRate + 1e-7);
  const origin = frame(relativeStartSeconds);
  const first = Math.max(0, origin);
  const inputLength = source.channels[0]?.length ?? 0;
  const last = Math.min(output[0]?.length ?? 0, frame(relativeStartSeconds + inputLength / source.sampleRate));
  if (last <= first) return Math.max(0, last);
  output.forEach((target, channel) => {
    const input = source.channels[Math.min(channel, source.channels.length - 1)];
    if (!input?.length) return;
    if (source.sampleRate === sampleRate) {
      target.set(input.subarray(first - origin, last - origin), first);
      return;
    }
    for (let index = first; index < last; index++) {
      const position = Math.max(0, Math.min(input.length - 1, (index - origin) * source.sampleRate / sampleRate));
      const low = Math.floor(position);
      const fraction = position - low;
      target[index] = input[low] * (1 - fraction) + (input[low + 1] ?? input[low]) * fraction;
    }
  });
  return last;
}

/** Copy, resample and trim PCM without repeating short audio. */
export function copyPcmClip(
  source: PcmAudio, duration: number, start = 0, sampleRate = RATE,
): { sampleRate: number; channels: Float32Array[] } {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const channels = Array.from({ length: Math.max(1, Math.min(2, source.channels.length)) }, () => new Float32Array(length));
  channels.forEach((output, channel) => {
    const input = source.channels[channel] ?? source.channels[0];
    if (!input) return;
    for (let i = 0; i < length; i++) {
      const sourceIndex = (start + i / sampleRate) * source.sampleRate;
      const index = Math.floor(sourceIndex);
      if (index < 0 || index >= input.length) continue;
      const fraction = sourceIndex - index;
      output[i] = input[index] * (1 - fraction) + (input[index + 1] ?? input[index]) * fraction;
    }
  });
  return { sampleRate, channels };
}

/** The exact same mix is used for preview and every export target. */
export function composePcm(
  settings: AudioSettings, duration: number, background: PcmAudio | null,
  shutter: PcmAudio | null, sampleRate = RATE,
): { sampleRate: number; channels: Float32Array[] } | null {
  const volume = Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : 0;
  if (settings.muted || volume === 0) return null;
  const useBackground = settings.source !== 'none' && background !== null;
  const useShutter = settings.shutter && shutter !== null;
  if (!useBackground && !useShutter) return null;
  const length = Math.max(1, Math.round(duration * sampleRate));
  const channels = [new Float32Array(length), new Float32Array(length)];
  const bg = useBackground ? copyPcmClip(background!, duration, 0, sampleRate) : null;
  const backgroundFrames = useBackground ? Math.min(length, Math.round((background!.channels[0]?.length ?? 0) / background!.sampleRate * sampleRate)) : 0;
  const shutterDuration = useShutter ? (shutter!.channels[0]?.length ?? 0) / shutter!.sampleRate : 0;
  const click = useShutter && shutterDuration > 0 ? copyPcmClip(shutter!, shutterDuration, 0, sampleRate) : null;
  const shutterStart = Math.round(duration / 2 * sampleRate);
  const fadeFrames = Math.max(1, Math.round(.01 * sampleRate));
  for (let channel = 0; channel < channels.length; channel++) {
    const target = channels[channel];
    const ambient = bg?.channels[channel] ?? bg?.channels[0];
    const mechanical = click?.channels[channel] ?? click?.channels[0];
    for (let i = 0; i < length; i++) {
      let value = ambient?.[i] ?? 0;
      if (backgroundFrames < length) value *= Math.max(0, Math.min(1, (backgroundFrames - 1 - i) / fadeFrames));
      const clickIndex = i - shutterStart;
      if (mechanical && clickIndex >= 0 && clickIndex < mechanical.length) value += mechanical[clickIndex] * .72;
      // Tiny de-click fades, not a scene fade or a looping crossfade.
      const edge = Math.max(0, Math.min(1, i / fadeFrames, (length - 1 - i) / fadeFrames));
      target[i] = Math.max(-1, Math.min(1, value * volume * edge));
    }
  }
  return { sampleRate, channels };
}

function pcm(buffer: AudioBuffer): PcmAudio {
  return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)) };
}

function toBuffer(context: AudioContext, data: PcmAudio): AudioBuffer {
  const buffer = context.createBuffer(data.channels.length, data.channels[0].length, data.sampleRate);
  data.channels.forEach((channel, index) => buffer.copyToChannel(new Float32Array(channel), index));
  return buffer;
}

export class AudioEngine {
  private context?: AudioContext;
  private currentSource?: AudioBufferSourceNode;
  private version = 0;
  private custom?: AudioBuffer;
  private customLabel = '';
  private customVersion = 0;
  private recordings = new Map<string, Promise<AudioBuffer>>();
  private originalClips = new WeakMap<File, Map<string, Promise<AudioBuffer>>>();
  /** performance.now() at the start of the latest playback, for the visual clock. */
  playbackStartedAt = 0;

  get customName(): string { return this.customLabel; }

  private getContext(): AudioContext {
    if (!this.context) {
      const Ctor = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('当前浏览器不支持声音处理，请使用新版 Chrome、Edge 或 Safari。');
      this.context = new Ctor({ sampleRate: RATE });
    }
    return this.context;
  }

  private async recording(id: string): Promise<AudioBuffer> {
    const name = id === 'shutter' ? 'shutter.mp3' : AMBIENCES.find((item) => item.id === id)?.url;
    if (!name) throw new Error('未找到所选声音，请重新选择。');
    const url = `${new URL(name, assetBase).href}?v=${VERSION}`;
    let pending = this.recordings.get(url);
    if (!pending) {
      pending = cachedBytes(url).then(async (bytes) => {
        try { return await this.getContext().decodeAudioData(bytes.slice(0)); }
        catch {
          downloaded.delete(url);
          const database = await openCache();
          try { database?.transaction('recordings', 'readwrite').objectStore('recordings').delete(url); } catch { /* Cache is optional. */ }
          throw new Error('声音文件无法解码，已清除这段声音的缓存。请重新播放以下载，也可以改选自带音频。');
        }
      });
      this.recordings.set(url, pending);
      pending.catch(() => this.recordings.delete(url));
    }
    return pending;
  }

  private async mediaClip(file: File, start: number, duration: number): Promise<AudioBuffer> {
    const context = this.getContext();
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    let mediaError: unknown;
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error('此素材没有音轨');
      if (!await track.canDecode()) throw new Error('浏览器不支持这段音频的编码');
      const output = [new Float32Array(Math.max(1, Math.round(duration * RATE))), new Float32Array(Math.max(1, Math.round(duration * RATE)))];
      const sink = new AudioBufferSink(track);
      let decoded = false;
      let decodedEnd = 0;
      for await (const chunk of sink.buffers(start, start + duration)) {
        const last = placePcmChunk(output, pcm(chunk.buffer), chunk.timestamp - start, RATE);
        decodedEnd = Math.max(decodedEnd, last);
        decoded = true;
      }
      if (!decoded) throw new Error('所选时间范围内没有声音');
      return toBuffer(context, { sampleRate: RATE, channels: output.map((channel) => channel.slice(0, Math.max(1, decodedEnd))) });
    } catch (error) { mediaError = error; }
    finally { input.dispose(); }
    // Web Audio can handle some codecs on Safari that WebCodecs does not expose.
    // Bound the fallback allocation; normal extraction above only decodes 2–5 s.
    if (file.size <= 64 * 1024 * 1024) {
      try {
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        const available = Math.min(duration, decoded.duration - start);
        if (available <= 0) throw new Error('所选时间范围内没有声音');
        return toBuffer(context, copyPcmClip(pcm(decoded), available, start));
      } catch { /* Keep the actionable original failure. */ }
    }
    throw new Error(`无法读取所选声音：${mediaError instanceof Error ? mediaError.message : String(mediaError)}。可改用 MP3/WAV 音频，或关闭原声后重试。`);
  }

  async setCustom(file: File): Promise<void> {
    const version = ++this.customVersion;
    const context = this.getContext();
    void context.resume().catch(() => {});
    // The application supports at most five seconds; do not decode hours of music.
    const loaded = await this.mediaClip(file, 0, 5);
    if (version !== this.customVersion) return;
    this.custom = loaded;
    this.customLabel = file.name;
  }

  private background(settings: AudioSettings, originalFile?: File, clipStart = 0, duration = 3): Promise<AudioBuffer | null> {
    if (settings.source === 'none') return Promise.resolve(null);
    if (settings.source === 'custom') {
      if (!this.custom) return Promise.reject(new Error('请先添加自己的音频文件。'));
      return Promise.resolve(this.custom);
    }
    if (settings.source === 'original') {
      if (!originalFile) return Promise.reject(new Error('当前照片没有视频原声，请选择环境声或自带音频。'));
      let clips = this.originalClips.get(originalFile);
      if (!clips) { clips = new Map(); this.originalClips.set(originalFile, clips); }
      const key = `${clipStart.toFixed(6)}:${duration.toFixed(6)}`;
      let clip = clips.get(key);
      if (!clip) {
        clip = this.mediaClip(originalFile, clipStart, duration);
        clips.set(key, clip);
        clip.catch(() => clips!.delete(key));
      }
      return clip;
    }
    return this.recording(settings.source);
  }

  async prepare(settings: AudioSettings, originalFile?: File, clipStart = 0, duration = 3): Promise<void> {
    if (settings.muted || settings.volume <= 0 || (settings.source === 'none' && !settings.shutter)) return;
    void this.getContext().resume().catch(() => {});
    await Promise.all([
      this.background(settings, originalFile, clipStart, duration),
      settings.shutter ? this.recording('shutter') : Promise.resolve(null),
    ]);
  }

  async render(settings: AudioSettings, duration: number, originalFile?: File, clipStart = 0): Promise<AudioBuffer | null> {
    settings = { ...settings };
    if (!Number.isFinite(duration) || duration <= 0 || duration > 10) throw new Error('声音时长应在 0–10 秒范围内。');
    if (settings.muted || settings.volume <= 0 || (settings.source === 'none' && !settings.shutter)) return null;
    const [background, shutter] = await Promise.all([
      this.background(settings, originalFile, clipStart, duration),
      settings.shutter ? this.recording('shutter') : Promise.resolve(null),
    ]);
    const mixed = composePcm(settings, duration, background ? pcm(background) : null, shutter ? pcm(shutter) : null);
    return mixed ? toBuffer(this.getContext(), mixed) : null;
  }

  async play(settings: AudioSettings, duration: number, originalFile?: File, clipStart = 0, visualStartedAt?: number): Promise<void> {
    settings = { ...settings };
    this.stop();
    const version = this.version;
    const audible = !settings.muted && settings.volume > 0 && (settings.source !== 'none' || settings.shutter);
    const resume = audible ? this.getContext().resume() : Promise.resolve();
    const buffer = await this.render(settings, duration, originalFile, clipStart);
    await resume;
    if (version !== this.version) return;
    this.playbackStartedAt = visualStartedAt ?? performance.now();
    const elapsed = Math.max(0, (performance.now() - this.playbackStartedAt) / 1000);
    if(elapsed >= duration)return;
    if (!buffer) return;
    const source = this.getContext().createBufferSource();
    source.buffer = buffer;
    source.connect(this.getContext().destination);
    this.currentSource = source;
    source.onended = () => {
      source.disconnect();
      if (this.currentSource === source) this.currentSource = undefined;
    };
    source.start(0,elapsed);
  }

  stop(): void {
    this.version++;
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* Already ended. */ }
      this.currentSource.disconnect();
      this.currentSource = undefined;
    }
  }
}
