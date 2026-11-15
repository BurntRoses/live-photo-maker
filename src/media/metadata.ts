import * as exifr from 'exifr';
import type { MetadataTags } from 'mediabunny';
import type { PhotoMetadata } from '../core/types';

const enc = new TextEncoder();
export const textBytes = (s: string) => enc.encode(s);
export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
const xmlEscape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]!));

/** Keep wall-clock capture time and UTC offset separate, as EXIF requires. */
export function normalizePhotoMetadata(meta: PhotoMetadata): PhotoMetadata {
  const result = { ...meta };
  if (result.capturedAt) {
    const text = result.capturedAt.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T');
    const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/);
    if (!match) throw new Error('拍摄时间格式应为 YYYY-MM-DDTHH:mm:ss');
    const local = `${match[1]}T${match[2]}:${match[3] ?? '00'}`;
    const date = new Date(local + 'Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== local) throw new Error('拍摄日期或时间无效');
    result.capturedAt = local;
    if (!result.offsetTime && match[4]) result.offsetTime = match[4] === 'Z' ? '+00:00' : match[4];
  }
  if (result.offsetTime && !/^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/.test(result.offsetTime)) throw new Error('时区应为 -14:00—+14:00，例如 +08:00 或 -05:00');
  return result;
}

/** Parse originals and exported JPEG/HEIF images without modifying their bytes. */
export async function readPhotoMetadata(blob: Blob): Promise<PhotoMetadata> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let tags: Record<string, any> = {};
  try {
    tags = await exifr.parse(bytes, { tiff: true, exif: true, gps: true, xmp: true,
      translateValues: false, reviveValues: false, mergeOutput: true }) ?? {};
  } catch { /* A photograph with no readable metadata is a valid input. */ }
  const result: PhotoMetadata = {};
  const readText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value.replace(/\0+$/, '') || undefined;
    if (Array.isArray(value)) return value.map(readText).find(Boolean);
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      return readText(item.value ?? item['x-default']);
    }
    return undefined;
  };
  const assignText = (key: keyof PhotoMetadata, ...names: string[]) => {
    const value = names.map(n => readText(tags[n])).find(Boolean);
    if (value) (result as Record<string, unknown>)[key] = value;
  };
  assignText('make', 'Make'); assignText('model', 'Model'); assignText('lens', 'LensModel', 'Lens');
  assignText('artist', 'Artist', 'creator'); assignText('description', 'ImageDescription', 'description');
  assignText('copyright', 'Copyright', 'rights'); assignText('offsetTime', 'OffsetTimeOriginal', 'OffsetTime');
  const rawDate = tags.DateTimeOriginal ?? tags.DateTimeDigitized ?? tags.CreateDate ?? tags.ModifyDate;
  if (rawDate instanceof Date) result.capturedAt = rawDate.toISOString().slice(0, 19);
  else if (typeof rawDate === 'string') result.capturedAt = rawDate.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T');
  for (const [key, name] of Object.entries({ iso:'ISO', exposureTime:'ExposureTime', fNumber:'FNumber', focalLength:'FocalLength' })) {
    const v = Number(tags[name]); if (Number.isFinite(v) && v > 0) (result as Record<string, unknown>)[key] = v;
  }
  const lat = tags.latitude, lon = tags.longitude;
  if (Number.isFinite(lat) && Number.isFinite(lon)) { result.latitude = lat; result.longitude = lon; }
  const alt = Number(tags.GPSAltitude);
  if (Number.isFinite(alt) && tags.GPSAltitude !== undefined) result.altitude = (Number(tags.GPSAltitudeRef) === 1 ? -1 : 1) * alt;
  // UTF-8 XMP is authoritative for text fields (EXIF ASCII is inconsistent across viewers).
  // Our private, documented namespace also provides a lossless edit/read round trip.
  let own: RegExpMatchArray | null = null;
  // The app exports JPEG. Inspect bounded APP1 packets, not compressed pixels or
  // a Motion Photo's potentially large appended video, for our lossless XMP.
  if (bytes[0] === 255 && bytes[1] === 216) {
    for (let p = 2; p + 4 <= bytes.length;) {
      if (bytes[p] !== 255 || bytes[p + 1] === 0xda || bytes[p + 1] === 0xd9) break;
      const size = (bytes[p + 2] << 8) | bytes[p + 3]; if (size < 2 || p + 2 + size > bytes.length) break;
      if (bytes[p + 1] === 0xe1) {
        own = new TextDecoder().decode(bytes.subarray(p + 4, p + 2 + size)).match(/lps:PhotoMetadata="([^"]*)"/);
        if (own) break;
      }
      p += size + 2;
    }
  }
  if (own) {
    try {
      const decoded = own[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const stored = JSON.parse(decoded) as PhotoMetadata;
      for (const [key, value] of Object.entries(stored)) {
        if (key in METADATA_FIELDS && (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))))
          (result as Record<string, unknown>)[key] = value;
      }
    } catch { /* Standard EXIF remains available if an optional XMP value is malformed. */ }
  }
  try { return normalizePhotoMetadata(result); }
  catch { delete result.capturedAt; delete result.offsetTime; return result; }
}

export const METADATA_FIELDS: Record<keyof PhotoMetadata, string> = {
  make: '设备品牌', model: '设备型号', lens: '镜头型号', capturedAt: '拍摄时间', offsetTime: '时区',
  iso: 'ISO', exposureTime: '曝光时间', fNumber: '光圈', focalLength: '焦距', artist: '作者',
  description: '说明', copyright: '版权', latitude: '纬度', longitude: '经度', altitude: '海拔',
};

interface Entry { tag: number; type: number; count: number; data: Uint8Array; pointer?: string }
const ascii = (tag: number, value: string): Entry => ({ tag, type: 2, count: textBytes(value).length + 1, data: concatBytes(textBytes(value), new Uint8Array(1)) });
function uintEntry(tag: number, value: number, short = false): Entry {
  const data = new Uint8Array(short ? 2 : 4); const d = new DataView(data.buffer);
  if (short) d.setUint16(0, Math.round(value), true); else d.setUint32(0, Math.round(value), true);
  return { tag, type: short ? 3 : 4, count: 1, data };
}
function rationalEntry(tag: number, values: number[]): Entry {
  const data = new Uint8Array(values.length * 8); const d = new DataView(data.buffer);
  values.forEach((v, i) => {
    const denominator = v === 0 ? 1 : Math.min(1000000, Math.max(1, Math.floor(0xffffffff / Math.max(1, Math.abs(v)))));
    const numerator = Math.round(Math.abs(v) * denominator);
    if (!Number.isFinite(numerator) || numerator > 0xffffffff) throw new Error('摄影参数超出 EXIF 数值范围');
    d.setUint32(i * 8, numerator, true); d.setUint32(i * 8 + 4, denominator, true);
  });
  return { tag, type: 5, count: values.length, data };
}
function bytesEntry(tag: number, type: number, data: Uint8Array): Entry { return { tag, type, count: data.length, data }; }
const pointerEntry = (tag: number, pointer: string): Entry => ({ ...uintEntry(tag, 0), pointer });
function appleMakerNote(id: string): Uint8Array {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Live 资源标识必须是 UUID');
  // Apple iOS signature, version 1, big-endian maker-note-local IFD; tag 17 = UUID.
  const out = new Uint8Array(70); out.set(textBytes('Apple iOS\0'), 0); out.set([0, 1, 77, 77], 10);
  const d = new DataView(out.buffer); d.setUint16(14, 1); d.setUint16(16, 17); d.setUint16(18, 2);
  d.setUint32(20, 37); d.setUint32(24, 32); out.set(textBytes(id + '\0'), 32); return out;
}
const dms = (n: number) => { const v = Math.abs(n), degrees = Math.floor(v), minutes = Math.floor((v - degrees) * 60); return [degrees, minutes, ((v - degrees) * 60 - minutes) * 60]; };

function buildExif(meta: PhotoMetadata, width: number, height: number, assetId?: string): Uint8Array {
  const primary: Entry[] = [uintEntry(0x100, width), uintEntry(0x101, height), uintEntry(0x112, 1, true), ascii(0x131, 'Live Photo Studio')];
  const exif: Entry[] = [bytesEntry(0x9000, 7, textBytes('0232')), uintEntry(0xa001, 1, true), uintEntry(0xa002, width), uintEntry(0xa003, height)];
  const gps: Entry[] = [];
  for (const [key, tag] of Object.entries({make:0x10f, model:0x110, artist:0x13b, description:0x10e, copyright:0x8298})) {
    const value = meta[key as keyof PhotoMetadata]; if (typeof value === 'string' && value) primary.push(ascii(tag, value));
  }
  if (meta.lens) exif.push(ascii(0xa434, meta.lens));
  if (meta.capturedAt) {
    const raw = meta.capturedAt.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!raw) throw new Error('拍摄时间格式应为 YYYY-MM-DDTHH:mm:ss');
    const date = `${raw[1]}:${raw[2]}:${raw[3]} ${raw[4]}:${raw[5]}:${raw[6] ?? '00'}`;
    primary.push(ascii(0x132, date)); exif.push(ascii(0x9003, date), ascii(0x9004, date));
  }
  if (meta.offsetTime) {
    exif.push(ascii(0x9010, meta.offsetTime), ascii(0x9011, meta.offsetTime), ascii(0x9012, meta.offsetTime));
  }
  for (const [key, tag] of Object.entries({exposureTime:0x829a, fNumber:0x829d, focalLength:0x920a})) {
    const v = meta[key as keyof PhotoMetadata]; if (typeof v === 'number' && Number.isFinite(v) && v > 0) exif.push(rationalEntry(tag, [v]));
  }
  if (meta.iso !== undefined) { if (!Number.isInteger(meta.iso) || meta.iso < 1 || meta.iso > 65535) throw new Error('ISO 应为 1—65535 之间的整数'); exif.push(uintEntry(0x8827, meta.iso, true)); }
  if (assetId) exif.push(bytesEntry(0x927c, 7, appleMakerNote(assetId)));
  if (meta.latitude !== undefined || meta.longitude !== undefined || meta.altitude !== undefined) {
    gps.push(bytesEntry(0, 1, new Uint8Array([2, 3, 0, 0])));
    if (meta.latitude !== undefined || meta.longitude !== undefined) {
      if (!Number.isFinite(meta.latitude) || !Number.isFinite(meta.longitude) || Math.abs(meta.latitude!) > 90 || Math.abs(meta.longitude!) > 180) throw new Error('经纬度需同时填写，纬度范围 ±90，经度范围 ±180');
      gps.push(ascii(1, meta.latitude! < 0 ? 'S' : 'N'), rationalEntry(2, dms(meta.latitude!)), ascii(3, meta.longitude! < 0 ? 'W' : 'E'), rationalEntry(4, dms(meta.longitude!)));
    }
    if (meta.altitude !== undefined) {
      if (!Number.isFinite(meta.altitude)) throw new Error('海拔应为有效数值');
      gps.push(bytesEntry(5, 1, new Uint8Array([meta.altitude < 0 ? 1 : 0])), rationalEntry(6, [meta.altitude]));
    }
  }
  primary.push(pointerEntry(0x8769, 'exif')); if (gps.length) primary.push(pointerEntry(0x8825, 'gps'));
  const groups: [string, Entry[]][] = [['primary', primary], ['exif', exif], ...(gps.length ? [['gps', gps] as [string, Entry[]]] : [])];
  const offsets: Record<string, number> = {}; let offset = 8;
  for (const [name, entries] of groups) { entries.sort((a, b) => a.tag - b.tag); offsets[name] = offset; offset += 2 + entries.length * 12 + 4; }
  const ifdBytes = offset;
  for (const [, entries] of groups) for (const entry of entries) if (entry.data.length > 4) offset += entry.data.length + entry.data.length % 2;
  const tiff = new Uint8Array(offset); const d = new DataView(tiff.buffer); tiff.set([73, 73, 42, 0]); d.setUint32(4, 8, true); let extra = ifdBytes;
  for (const [name, entries] of groups) {
    let p = offsets[name]; d.setUint16(p, entries.length, true); p += 2;
    for (const entry of entries) {
      d.setUint16(p, entry.tag, true); d.setUint16(p + 2, entry.type, true); d.setUint32(p + 4, entry.count, true);
      if (entry.pointer) d.setUint32(p + 8, offsets[entry.pointer], true);
      else if (entry.data.length <= 4) tiff.set(entry.data, p + 8);
      else { d.setUint32(p + 8, extra, true); tiff.set(entry.data, extra); extra += entry.data.length + entry.data.length % 2; }
      p += 12;
    }
  }
  return jpegSegment(0xe1, concatBytes(textBytes('Exif\0\0'), tiff));
}

export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  if (payload.length + 2 > 65535) throw new Error('照片信息过长，超出 JPEG 元数据段容量');
  const header = new Uint8Array([255, marker, 0, 0]); new DataView(header.buffer).setUint16(2, payload.length + 2);
  return concatBytes(header, payload);
}

/** Insert a new APP1 without disturbing scan data. Optional EXIF/XMP removal is structural. */
export function replaceJpegMetadata(jpeg: Uint8Array, segments: Uint8Array[], removeExif = false, removeXmp = false): Uint8Array<ArrayBuffer> {
  if (jpeg[0] !== 255 || jpeg[1] !== 216) throw new Error('导出主图必须是有效 JPEG');
  const kept: Uint8Array[] = []; let p = 2;
  while (p + 2 <= jpeg.length) {
    if (jpeg[p] !== 255) throw new Error('JPEG 标记结构无效');
    const marker = jpeg[p + 1];
    if (marker === 0xda || marker === 0xd9) { kept.push(jpeg.subarray(p)); p = jpeg.length; break; }
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) { kept.push(jpeg.subarray(p, p + 2)); p += 2; continue; }
    if (p + 4 > jpeg.length) throw new Error('JPEG 元数据段不完整');
    const n = (jpeg[p + 2] << 8) | jpeg[p + 3]; if (n < 2 || p + n + 2 > jpeg.length) throw new Error('JPEG 元数据长度无效');
    const prefix = new TextDecoder().decode(jpeg.subarray(p + 4, Math.min(p + n + 2, p + 80)));
    const exif = marker === 0xe1 && prefix.startsWith('Exif\0\0');
    const xmp = marker === 0xe1 && prefix.startsWith('http://ns.adobe.com/xap/1.0/\0');
    if (!(removeExif && exif) && !(removeXmp && xmp)) kept.push(jpeg.subarray(p, p + n + 2));
    p += n + 2;
  }
  if (p < jpeg.length) throw new Error('JPEG 文件不完整');
  return concatBytes(jpeg.subarray(0, 2), ...segments, ...kept);
}

export function photoXmp(meta: PhotoMetadata): string {
  meta = normalizePhotoMetadata(meta);
  const attrs: string[] = ['xmlns:tiff="http://ns.adobe.com/tiff/1.0/"', 'xmlns:exif="http://ns.adobe.com/exif/1.0/"', 'xmlns:aux="http://ns.adobe.com/exif/1.0/aux/"', 'xmlns:xmp="http://ns.adobe.com/xap/1.0/"', 'xmlns:lps="https://burntroses.github.io/live-photo-studio/ns/1.0/"'];
  if (meta.make) attrs.push(`tiff:Make="${xmlEscape(meta.make)}"`); if (meta.model) attrs.push(`tiff:Model="${xmlEscape(meta.model)}"`);
  if (meta.lens) attrs.push(`aux:Lens="${xmlEscape(meta.lens)}"`);
  if (meta.capturedAt) attrs.push(`exif:DateTimeOriginal="${xmlEscape(meta.capturedAt + (meta.offsetTime ?? ''))}"`);
  attrs.push(`lps:PhotoMetadata="${xmlEscape(JSON.stringify(meta))}"`);
  let children = '';
  if (meta.artist) children += `<dc:creator><rdf:Seq><rdf:li>${xmlEscape(meta.artist)}</rdf:li></rdf:Seq></dc:creator>`;
  for (const [key, field] of [['description','description'], ['copyright','rights']] as const) if (meta[key]) children += `<dc:${field}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(meta[key])}</rdf:li></rdf:Alt></dc:${field}>`;
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" ${attrs.join(' ')}>${children}</rdf:Description></rdf:RDF></x:xmpmeta>`;
}

export function writePhotoMetadata(jpeg: Uint8Array, meta: PhotoMetadata, width: number, height: number, assetId?: string): Uint8Array<ArrayBuffer> {
  meta = normalizePhotoMetadata(meta);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('照片尺寸无效');
  const xmp = jpegSegment(0xe1, concatBytes(textBytes('http://ns.adobe.com/xap/1.0/\0'), textBytes(photoXmp(meta))));
  return replaceJpegMetadata(jpeg, [buildExif(meta, width, height, assetId), xmp], true, true);
}

/** Tags for Mediabunny's mdta metadata writer. */
export function quickTimeMetadata(meta: PhotoMetadata): Record<string, string> {
  meta = normalizePhotoMetadata(meta);
  const tags: Record<string, string> = { 'com.apple.quicktime.software': 'Live Photo Studio' };
  for (const [key, field] of [['make','make'], ['model','model'], ['artist','author'], ['description','description'], ['copyright','copyright']] as const) if (meta[key]) tags[`com.apple.quicktime.${field}`] = meta[key]!;
  if (meta.capturedAt) tags['com.apple.quicktime.creationdate'] = meta.capturedAt + (meta.offsetTime ?? '');
  if (Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude)) {
    const signed = (v: number, places: number, degrees: number) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(places).padStart(degrees + places + 1, '0');
    tags['com.apple.quicktime.location.ISO6709'] = signed(meta.latitude!, 6, 2) + signed(meta.longitude!, 6, 3) + (meta.altitude !== undefined ? signed(meta.altitude, 2, 1) : '') + '/';
  }
  return tags;
}

/** Prefer the original QuickTime wall clock and offset over a normalized Date,
 * which alone cannot preserve the camera's time zone. File creation time is
 * deliberately not substituted for capture time. */
export function readVideoMetadata(tags: MetadataTags): PhotoMetadata {
  const raw = tags.raw ?? {}, result: PhotoMetadata = {};
  const text = (...keys: string[]) => keys.map(key => raw[key]).find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const fields = {
    make: text('com.apple.quicktime.make', 'com.android.manufacturer', 'make'),
    model: text('com.apple.quicktime.model', 'com.android.model', 'model'),
    lens: text('com.apple.quicktime.camera.lens_model'),
    artist: text('com.apple.quicktime.author', 'com.apple.quicktime.artist', 'artist', '©ART') ?? tags.artist,
    description: text('com.apple.quicktime.description', 'description', '©des') ?? tags.description,
    copyright: text('com.apple.quicktime.copyright', 'copyright', 'cprt', '©cpy'),
  };
  for (const [key, value] of Object.entries(fields)) if (value) (result as Record<string, unknown>)[key] = value;
  const captured = text('com.apple.quicktime.creationdate', 'date', '©day');
  try {
    const date = captured?.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') ?? (tags.date && Number.isFinite(tags.date.getTime()) ? tags.date.toISOString() : undefined);
    if (date) Object.assign(result, normalizePhotoMetadata({ capturedAt: date }));
  } catch { /* A malformed optional date must not discard the camera fields. */ }
  const position = text('com.apple.quicktime.location.ISO6709', 'location');
  const match = position?.match(/^([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?\/$/);
  if (match) {
    const latitude = Number(match[1]), longitude = Number(match[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      result.latitude = latitude; result.longitude = longitude;
      if (match[3]) result.altitude = Number(match[3]);
    }
  }
  return result;
}
