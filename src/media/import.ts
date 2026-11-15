import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { MediaAsset, PhotoMetadata } from '../core/types';
import { readPhotoMetadata, readVideoMetadata } from './metadata';
import { WasmCodec } from './wasm';
import { convertHeic } from './heic';

export async function seekVideo(video: HTMLVideoElement, time: number) {
  const at = Math.max(0, Math.min(time, video.duration - .001));
  if (Math.abs(video.currentTime - at) < .00001 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('读取视频画面超时，请重试或更换视频')); }, 15000);
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', error); };
    const done = () => { cleanup(); resolve(); }; const error = () => { cleanup(); reject(new Error('无法解码视频画面')); };
    video.addEventListener('seeked', done, { once: true }); video.addEventListener('error', error, { once: true }); video.currentTime = at;
  });
}
async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob), img = new Image(); img.src=url;
  try { await img.decode(); return img; } catch { URL.revokeObjectURL(url); throw new Error('无法读取照片。支持 JPG、PNG、WebP 和 HEIC。'); }
}
async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';
  await new Promise<void>((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('读取视频超时')),20000);v.onloadeddata=()=>{clearTimeout(timer);resolve();};v.onerror=()=>{clearTimeout(timer);reject(new Error('浏览器不支持这个视频格式'));};v.src=url;v.load(); });
  return v;
}
export async function importMedia(file: File, report: (message:string)=>void): Promise<MediaAsset> {
  if(!file.size) throw new Error('这个文件是空的，请重新选择');
  const kind=file.type.startsWith('video/')||/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)?'video':'photo';
  const originalMetadata=kind==='photo'?await readPhotoMetadata(file).catch(()=>({} as PhotoMetadata)):{} as PhotoMetadata;
  if(kind==='photo') {
    let img:HTMLImageElement;
    try{img=await loadImage(file);}catch(e){if(!/\.(heic|heif)$/i.test(file.name)&&!/hei[cf]/i.test(file.type))throw e;report('正在本机解码 HEIC 照片');img=await loadImage(await convertHeic(file));}
    const poster=document.createElement('canvas');poster.width=img.naturalWidth;poster.height=img.naturalHeight;const pc=poster.getContext('2d',{alpha:false})!;pc.fillStyle='#fff';pc.fillRect(0,0,poster.width,poster.height);pc.drawImage(img,0,0);
    return {file,kind,name:file.name,width:poster.width,height:poster.height,duration:0,element:img,poster,originalMetadata,hasAudio:false,url:img.src};
  }
  // Inspect the original container before an optional compatibility transcode
  // can replace or discard its camera metadata.
  let hasAudio=false;
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  try { hasAudio=!!(await input.getPrimaryAudioTrack()); Object.assign(originalMetadata,readVideoMetadata(await input.getMetadataTags()));
  }catch{/* native playback remains valid when the container has unknown auxiliary tracks */}finally{input.dispose();}
  let url=URL.createObjectURL(file),v:HTMLVideoElement;
  try{v=await loadVideo(url);}catch{
    URL.revokeObjectURL(url);const codec=new WasmCodec();
    try{await codec.load((_n,m)=>report(m));const converted=await codec.compatibleVideo(file);file=new File([converted.blob],file.name,{type:'video/mp4'});url=URL.createObjectURL(file);v=await loadVideo(url);if(!hasAudio){const convertedInput=new Input({source:new BlobSource(file),formats:ALL_FORMATS});try{hasAudio=!!(await convertedInput.getPrimaryAudioTrack());}finally{convertedInput.dispose();}}report(`已在本机兼容处理原视频的中间 ${Math.min(5,converted.originalDuration).toFixed(1)} 秒（原长 ${converted.originalDuration.toFixed(1)} 秒）`);}finally{codec.cancel();}
  }
  if(!Number.isFinite(v.duration)||v.duration<=0)throw new Error('无法确定视频时长，请换一个完整的视频文件');
  await seekVideo(v,v.duration/2);
  const poster=document.createElement('canvas');poster.width=v.videoWidth;poster.height=v.videoHeight;poster.getContext('2d')!.drawImage(v,0,0);
  return {file,kind,name:file.name,width:poster.width,height:poster.height,duration:v.duration,element:v,poster,originalMetadata,hasAudio,url};
}
export function releaseMedia(asset: MediaAsset) { if(asset.kind==='video'){const v=asset.element as HTMLVideoElement;v.pause();v.removeAttribute('src');v.load();}URL.revokeObjectURL(asset.url); }
