import { concatBytes, jpegSegment, replaceJpegMetadata, textBytes } from './metadata';

const dec = new TextDecoder();
const u32 = (value: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value); return b; };
const i32 = (value: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, value); return b; };
const u16 = (value: number) => new Uint8Array([(value >> 8) & 255, value & 255]);
const zeros = (n: number) => new Uint8Array(n);
const atom = (type: string | number, ...data: Uint8Array[]) => {
  const body = concatBytes(...data); return concatBytes(u32(body.length + 8), typeof type === 'number' ? u32(type) : textBytes(type), body);
};
const full = (type: string, ...data: Uint8Array[]) => atom(type, zeros(4), ...data);
const read32 = (b: Uint8Array, p: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(p);

function sourceXmp(jpeg: Uint8Array): string | undefined {
  for (let p = 2; p + 4 < jpeg.length;) {
    const marker = jpeg[p + 1]; if (marker === 0xda || marker === 0xd9) return;
    const size = (jpeg[p + 2] << 8) | jpeg[p + 3]; if (size < 2 || p + size + 2 > jpeg.length) return;
    const data = jpeg.subarray(p + 4, p + 2 + size), prefix = 'http://ns.adobe.com/xap/1.0/\0';
    if (marker === 0xe1 && dec.decode(data.subarray(0, prefix.length)) === prefix) return dec.decode(data.subarray(prefix.length));
    p += 2 + size;
  }
}

/** Android Motion Photo v1, with legacy MicroVideo fields for older Gallery readers. */
export function buildAndroidMotionPhoto(jpeg: Uint8Array, mp4: Uint8Array, posterTimeSeconds: number): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(posterTimeSeconds) || posterTimeSeconds < 0) throw new Error('主图时间无效');
  assertMovie(mp4);
  const timestamp = Math.round(posterTimeSeconds * 1e6);
  const description = `<rdf:Description rdf:about="" xmlns:Camera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1" Camera:MotionPhotoPresentationTimestampUs="${timestamp}" Camera:MicroVideo="1" Camera:MicroVideoVersion="1" Camera:MicroVideoOffset="${mp4.length}" Camera:MicroVideoPresentationTimestampUs="${timestamp}"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${mp4.length}" Item:Padding="0"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description>`;
  const old = sourceXmp(jpeg);
  const xml = old?.includes('</rdf:RDF>') ? old.replace('</rdf:RDF>', description + '</rdf:RDF>') : `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${description}</rdf:RDF></x:xmpmeta>`;
  const segment = jpegSegment(0xe1, concatBytes(textBytes('http://ns.adobe.com/xap/1.0/\0'), textBytes(xml)));
  return concatBytes(replaceJpegMetadata(jpeg, [segment], false, true), mp4);
}

/** Huawei/compatibility-Honor single-file Moving Photo (v6, JPEG + MP4 + 60B tail).
 * Tail layout follows GPL-3.0 LivePhotoBox HuaweiMovingPhotoProtocol.cs.
 * Native device recognition is verified separately from byte-format correctness.
 */
export function buildHuaweiMotionPhoto(jpeg: Uint8Array, mp4: Uint8Array, coverFrame: number, totalFrames: number): Uint8Array<ArrayBuffer> {
  assertMovie(mp4);
  if (!Number.isInteger(coverFrame) || coverFrame < 0 || coverFrame > 99 || !Number.isInteger(totalFrames) || totalFrames <= coverFrame) throw new Error('华为格式要求主图帧在 0—99 之间且位于视频内；请使用 30 fps 导出');
  const tail = new Uint8Array(60).fill(32);
  tail.set(textBytes('v6_f' + coverFrame), 0);
  tail.set(textBytes(`${coverFrame}:${totalFrames}`).subarray(0, 8), 20);
  const marker = textBytes('LIVE_' + (mp4.length + 20));
  if (marker.length > 20) throw new Error('视频超出华为尾标容量');
  tail.set(marker, 40);
  return concatBytes(jpeg, mp4, tail);
}

export interface MovieBox { type: string; start: number; size: number; header: number; dataStart: number; end: number }
/** Strict 32/64-bit ISO box iterator; exported for binary tests and export diagnostics. */
export function movieBoxes(bytes: Uint8Array, start = 0, end = bytes.length): MovieBox[] {
  const rows: MovieBox[] = []; let p = start;
  while (p < end) {
    if (p + 8 > end) throw new Error('视频容器有不完整的 box');
    let size = read32(bytes, p), header = 8;
    if (size === 1) { if (p + 16 > end) throw new Error('视频 64 位 box 不完整'); const n = new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(p + 8); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('视频过大'); size = Number(n); header = 16; }
    if (size === 0) size = end - p;
    if (size < header || p + size > end) throw new Error('视频容器 box 长度无效');
    rows.push({ type: dec.decode(bytes.subarray(p + 4, p + 8)), start: p, size, header, dataStart: p + header, end: p + size }); p += size;
  }
  return rows;
}
function assertMovie(bytes: Uint8Array) {
  const boxes = movieBoxes(bytes); if (!boxes.some(b => b.type === 'ftyp') || !boxes.some(b => b.type === 'mdat') || !boxes.some(b => b.type === 'moov')) throw new Error('视频缺少完整的 ftyp、moov 或 mdat');
}
const rawBox = (b: Uint8Array, box: MovieBox) => b.slice(box.start, box.end);
function child(b: Uint8Array, box: MovieBox, type: string) { return movieBoxes(b, box.dataStart, box.end).find(c => c.type === type); }
const matrix = () => concatBytes(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
function handler(type: string, name: string, quickTime = false): Uint8Array {
  return full('hdlr', quickTime ? textBytes('mhlr') : zeros(4), textBytes(type), zeros(12), textBytes(name + '\0'));
}

function identifierMeta(id: string, old?: Uint8Array): Uint8Array {
  const key = textBytes('com.apple.quicktime.content.identifier');
  const data = atom('data', u32(1), u32(0), textBytes(id));
  if (old) {
    const children = movieBoxes(old, read32(old, 8) === 0 ? 12 : 8);
    const keys = children.find(c => c.type === 'keys'), ilst = children.find(c => c.type === 'ilst');
    const hdlr = children.find(c => c.type === 'hdlr');
    if (!keys || !ilst || !hdlr || dec.decode(old.subarray(hdlr.dataStart + 8, hdlr.dataStart + 12)) !== 'mdta') throw new Error('MOV 含有无法合并的文件级元数据');
    const entries = movieBoxes(old, keys.dataStart + 8, keys.end), count = read32(old, keys.dataStart + 4);
    if (entries.length !== count) throw new Error('MOV 元数据键表不完整');
    let index = entries.findIndex(e => e.type === 'mdta' && dec.decode(old.subarray(e.dataStart, e.end)) === dec.decode(key));
    const items = movieBoxes(old, ilst.dataStart, ilst.end).filter(e => read32(old, e.start + 4) !== index + 1).map(e => rawBox(old, e));
    const newEntries = entries.map(e => rawBox(old, e));
    if (index < 0) { index = entries.length; newEntries.push(atom('mdta', key)); }
    return atom('meta', handler('mdta', ''), full('keys', u32(newEntries.length), ...newEntries), atom('ilst', ...items, atom(index + 1, data)), ...children.filter(c => !['hdlr','keys','ilst'].includes(c.type)).map(c => rawBox(old, c)));
  }
  return atom('meta', handler('mdta', ''), full('keys', u32(1), u32(key.length + 8), textBytes('mdta'), key), atom('ilst', atom(1, data)));
}

function isMdtaMeta(bytes: Uint8Array, entry: MovieBox): boolean {
  if (entry.type !== 'meta') return false;
  try {
    const start = entry.dataStart + (read32(bytes, entry.dataStart) === 0 ? 4 : 0);
    const hdlr = movieBoxes(bytes, start, entry.end).find(c => c.type === 'hdlr');
    return !!hdlr && dec.decode(bytes.subarray(hdlr.dataStart + 8, hdlr.dataStart + 12)) === 'mdta';
  } catch { return false; }
}

/** Clip the movie presentation timeline, preserving encoded AAC priming edits.
 * AAC frames can extend beyond the requested duration. Edit lists bound their
 * presentation without falsifying sample-table or media-header durations.
 */
export function trimMovieDuration(movie: Uint8Array, durationSeconds: number): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('视频播放时长无效');
  assertMovie(movie);
  const top = movieBoxes(movie), moov = top.find(b => b.type === 'moov')!;
  if (top.some(b => b.type === 'moof')) throw new Error('时长限定需要非分片视频');
  const children = movieBoxes(movie, moov.dataStart, moov.end), mvhd = children.find(b => b.type === 'mvhd');
  if (!mvhd) throw new Error('视频缺少 movie header');
  const scale = read32(movie, mvhd.dataStart + (movie[mvhd.dataStart] === 1 ? 20 : 12));
  if (!scale) throw new Error('视频时基无效');
  const limit = Math.max(1, Math.round(durationSeconds * scale));
  const durationOf = (box: MovieBox, track: boolean) => {
    const v1 = movie[box.dataStart] === 1, p = box.dataStart + (track ? (v1 ? 28 : 20) : (v1 ? 24 : 16));
    return v1 ? Number(new DataView(movie.buffer, movie.byteOffset).getBigUint64(p)) : read32(movie, p);
  };
  const clippedHeader = (box: MovieBox, track: boolean, value: number) => {
    const bytes = rawBox(movie, box), v1 = bytes[box.header] === 1, p = box.header + (track ? (v1 ? 28 : 20) : (v1 ? 24 : 16));
    const view = new DataView(bytes.buffer); if (v1) view.setBigUint64(p, BigInt(value)); else view.setUint32(p, value); return bytes;
  };
  const tracks = children.map(entry => {
    if (entry.type === 'mvhd') return clippedHeader(entry, false, Math.min(durationOf(entry, false) || limit, limit));
    if (entry.type !== 'trak') return rawBox(movie, entry);
    const parts = movieBoxes(movie, entry.dataStart, entry.end), tkhd = parts.find(p => p.type === 'tkhd');
    if (!tkhd) throw new Error('视频轨道缺少 track header');
    const trackDuration = Math.min(durationOf(tkhd, true) || limit, limit), edts = parts.find(p => p.type === 'edts');
    const elst = edts ? movieBoxes(movie, edts.dataStart, edts.end).find(p => p.type === 'elst') : undefined;
    let editList: Uint8Array;
    if (elst) {
      const version = movie[elst.dataStart], width = version === 1 ? 20 : 12;
      const count = read32(movie, elst.dataStart + 4), edits: Uint8Array[] = []; let remaining = trackDuration;
      if (elst.dataStart + 8 + count * width > elst.end) throw new Error('视频轨道 edit list 不完整');
      for (let i = 0; i < count && remaining > 0; i++) {
        const p = elst.dataStart + 8 + i * width, original = version === 1 ? Number(new DataView(movie.buffer, movie.byteOffset).getBigUint64(p)) : read32(movie, p);
        const duration = Math.min(original, remaining); if (!duration) continue;
        const bytes = movie.slice(p, p + width), view = new DataView(bytes.buffer);
        if (version === 1) view.setBigUint64(0, BigInt(duration)); else view.setUint32(0, duration);
        edits.push(bytes); remaining -= duration;
      }
      editList = atom('elst', movie.slice(elst.dataStart, elst.dataStart + 4), u32(edits.length), ...edits);
    } else editList = full('elst', u32(1), u32(trackDuration), i32(0), u16(1), u16(0));
    const newEdts = atom('edts', ...(edts ? movieBoxes(movie, edts.dataStart, edts.end).filter(p => p.type !== 'elst').map(p => rawBox(movie, p)) : []), editList);
    return atom('trak', ...parts.filter(p => p.type !== 'edts').map(p => p.type === 'tkhd' ? clippedHeader(p, true, trackDuration) : rawBox(movie, p)), newEdts);
  });
  const old = movie.slice(); old.set(textBytes('free'), moov.start + 4);
  const terminal = top[top.length - 1]; if (read32(old, terminal.start) === 0) old.set(u32(terminal.size), terminal.start);
  return concatBytes(old, atom('moov', ...tracks));
}

function metadataTrack(trackId: number, movieScale: number, posterSeconds: number, videoTrackId: number, dataOffset: number): Uint8Array {
  const mediaScale = 600, sampleTicks = 20;
  const lead = Math.round(posterSeconds * movieScale), sampleMovieTicks = Math.max(1, Math.round(movieScale / 30));
  const tkhd = atom('tkhd', u32(7), u32(0), u32(0), u32(trackId), u32(0), u32(lead + sampleMovieTicks), zeros(8), u16(0), u16(0), u16(0), u16(0), matrix(), u32(0), u32(0));
  const edits = lead > 0
    ? full('elst', u32(2), u32(lead), i32(-1), u16(1), u16(0), u32(sampleMovieTicks), i32(0), u16(1), u16(0))
    : full('elst', u32(1), u32(sampleMovieTicks), i32(0), u16(1), u16(0));
  // mebx local keys: key ID 1, signed 8-bit data type 65. Sample payload is -1.
  const keyed = atom(1, atom('keyd', textBytes('mdta'), textBytes('com.apple.quicktime.still-image-time')), atom('dtyp', u32(0), u32(65)));
  const entry = atom('mebx', zeros(6), u16(1), atom('keys', keyed));
  const stbl = atom('stbl', full('stsd', u32(1), entry), full('stts', u32(1), u32(1), u32(sampleTicks)), full('stsc', u32(1), u32(1), u32(1), u32(1)), full('stsz', u32(9), u32(1)), full('stco', u32(1), u32(dataOffset)));
  const gmhd = atom('gmhd', atom('gmin', u32(0), u16(0x40), u16(0x8000), u16(0x8000), u16(0x8000), u16(0), u16(0)));
  const minf = atom('minf', gmhd, atom('dinf', full('dref', u32(1), atom('url ', u32(1)))), stbl);
  const mdhd = full('mdhd', u32(0), u32(0), u32(mediaScale), u32(sampleTicks), u16(0x55c4), u16(0));
  return atom('trak', tkhd, atom('edts', edits), atom('tref', atom('cdsc', u32(videoTrackId))), atom('mdia', mdhd, handler('meta', 'Core Media Metadata', true), minf));
}

/** Add a real still-image-time track and resource identifier without re-encoding.
 * The previous moov becomes an equal-sized free box, keeping every existing chunk
 * offset unchanged. A new metadata mdat and new moov are appended at EOF.
 */
export function buildAppleLiveMov(baseMov: Uint8Array, assetId: string, posterTimeSeconds: number, durationSeconds: number): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) throw new Error('Live 资源标识必须是 UUID');
  if (!Number.isFinite(posterTimeSeconds) || posterTimeSeconds < 0 || posterTimeSeconds >= durationSeconds) throw new Error('Live 主图时间必须位于视频内');
  assertMovie(baseMov);
  const boxes = movieBoxes(baseMov), moovs = boxes.filter(b => b.type === 'moov');
  if (moovs.length !== 1 || boxes.some(b => b.type === 'moof')) throw new Error('苹果 Live 导出需要非分片 MOV');
  const moov = moovs[0], children = movieBoxes(baseMov, moov.dataStart, moov.end), mvhd = children.find(b => b.type === 'mvhd');
  if (!mvhd) throw new Error('MOV 缺少 movie header');
  const version = baseMov[mvhd.dataStart], movieScale = read32(baseMov, mvhd.dataStart + (version === 1 ? 20 : 12));
  let maxId = 0, videoId = 0;
  for (const track of children.filter(b => b.type === 'trak')) {
    const tkhd = child(baseMov, track, 'tkhd'), mdia = child(baseMov, track, 'mdia');
    if (!tkhd || !mdia) continue;
    const id = read32(baseMov, tkhd.dataStart + (baseMov[tkhd.dataStart] === 1 ? 20 : 12)); maxId = Math.max(maxId, id);
    const hdlr = child(baseMov, mdia, 'hdlr'); if (hdlr && dec.decode(baseMov.subarray(hdlr.dataStart + 8, hdlr.dataStart + 12)) === 'vide') videoId = id;
  }
  if (!movieScale || !videoId || maxId >= 0xfffffffe) throw new Error('MOV 视频轨道或时基无效');
  const sample = concatBytes(u32(9), u32(1), new Uint8Array([255]));
  const old = baseMov.slice(); old.set(textBytes('free'), moov.start + 4);
  // Change a terminal size=0 mdat into its explicit length before appending boxes.
  const terminal = boxes[boxes.length - 1]; if (read32(old, terminal.start) === 0) old.set(u32(terminal.size), terminal.start);
  const header = rawBox(baseMov, mvhd); new DataView(header.buffer).setUint32(header.length - 4, maxId + 2);
  // Mediabunny writes file-level mdta inside udta. Apple's readers prefer a
  // top-level moov/meta; lift its fields into that same dictionary as the UUID
  // so device, date and location remain visible through AVFoundation/Photos.
  let existingMeta = children.find(b => isMdtaMeta(baseMov, b));
  if (!existingMeta) {
    for (const udta of children.filter(b => b.type === 'udta')) {
      existingMeta = movieBoxes(baseMov, udta.dataStart, udta.end).find(b => isMdtaMeta(baseMov, b));
      if (existingMeta) break;
    }
  }
  const retained = children.filter(b => b.type !== 'mvhd' && b.start !== existingMeta?.start).map(b => {
    if (b.type !== 'udta' || !existingMeta || existingMeta.start < b.dataStart || existingMeta.end > b.end) return rawBox(baseMov, b);
    const other = movieBoxes(baseMov, b.dataStart, b.end).filter(c => c.start !== existingMeta!.start).map(c => rawBox(baseMov, c));
    return other.length ? atom('udta', ...other) : zeros(0);
  });
  const track = metadataTrack(maxId + 1, movieScale, posterTimeSeconds, videoId, baseMov.length + 8);
  return concatBytes(old, atom('mdat', sample), atom('moov', header, ...retained, identifierMeta(assetId, existingMeta ? rawBox(baseMov, existingMeta) : undefined), track));
}
