import { AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, ALL_FORMATS, MovOutputFormat, Mp4OutputFormat, Output, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { zipSync, strToU8 } from 'fflate';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { ExportTarget, ProjectState } from '../core/types';
import { createGeometry, outputSize } from '../core/geometry';
import { motionAt } from '../core/motion';
import { FrameRenderer, STILL_FRAME, quantizedProgress, videoAppearance } from '../core/renderer';
import { writePhotoMetadata, quickTimeMetadata } from './metadata';
import { buildAndroidMotionPhoto, buildHuaweiMotionPhoto, buildAppleLiveMov, trimMovieDuration } from './containers';
import { seekVideo } from './import';
import type { AudioEngine } from './audio';
import { WasmCodec } from './wasm';

export interface ExportResult { blob: Blob; filename: string; width: number; height: number; duration: number; backend: string }
export const effectiveDuration = (state: ProjectState) => state.asset?.kind === 'video' ? Math.min(state.params.duration, state.asset.duration) : state.params.duration;
export const clipStart = (state: ProjectState) => state.asset?.kind === 'video' ? Math.max(0, (state.asset.duration - effectiveDuration(state)) / 2) : 0;
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消导出', 'AbortError'); };
const pause = () => new Promise<void>(r => setTimeout(r, 0));
const blobBytes = async (canvas: HTMLCanvasElement, type='image/jpeg', quality=.98) => new Uint8Array(await (await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('无法生成图片')),type,quality))).arrayBuffer());
export function fileStem(name: string) { return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,75) || '我的照片'; }

export async function exportProject(state: ProjectState, target: ExportTarget, audio: AudioEngine, signal: AbortSignal, report: (progress:number,message:string)=>void): Promise<ExportResult> {
  const asset=state.asset;if(!asset)throw new Error('请先导入一张照片或一段视频');
  if(asset.kind==='photo'&&!asset.depthLayers)throw new Error('请先锁定主体或圈选动态背景，再生成 Live');
  const p={...state.params},take={...state.take},meta={...state.metadata},audioSettings={...state.audio},subject=asset.subjectBounds?{...asset.subjectBounds}:undefined,duration=effectiveDuration(state),start=clipStart(state);
  const dimensions=outputSize(asset.width,asset.height,p.aspect,target==='gif'?640:1440);
  const {width,height}=dimensions,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const renderer=new FrameRenderer(canvas);
  const frames=asset.kind==='photo'?Array.from({length:301},(_,i)=>motionAt(i/300,take,p)):[];
  const g=createGeometry(asset.width,asset.height,width,height,p,frames,subject);
  let input:Input|undefined, sink:CanvasSink|undefined;
  let codec:WasmCodec|undefined;
  const cleanupCodec=()=>codec?.cancel();signal.addEventListener('abort',cleanupCodec,{once:true});
  try {
    checkAbort(signal);report(.01,'准备当前选定效果');
    if(asset.kind==='video'){
      input=new Input({source:new BlobSource(asset.file),formats:ALL_FORMATS});
      try{const track=await input.getPrimaryVideoTrack();if(track&&await track.canDecode())sink=new CanvasSink(track,{width:asset.width,height:asset.height,poolSize:2});}catch{/* use the same native media decoder as preview */}
    }
    async function drawAt(t:number,terminal=false){
      checkAbort(signal);
      let source:TexImageSource=asset!.poster;
      if(asset!.kind==='video'&&!terminal){
        if(sink){const frame=await sink.getCanvas(start+t);if(!frame)throw new Error('未能读取这一帧视频');source=frame.canvas;}
        else{await seekVideo(asset!.element as HTMLVideoElement,start+t);source=asset!.element;}
      }
      const progress=quantizedProgress(t,duration,p.fps);
      const frame=terminal?STILL_FRAME:asset!.kind==='photo'?motionAt(progress,take,p):videoAppearance(progress,p);
      renderer.draw(source,g,frame,source===asset!.poster,asset!.kind==='video'?undefined:{params:p,seconds:terminal?duration/2:progress*duration,seed:take.seed,take,layers:asset!.depthLayers});
    }
    if(target==='gif') {
      const fps=15,count=Math.max(2,Math.round(duration*fps/2)*2),gif=GIFEncoder();
      const readback=document.createElement('canvas');readback.width=width;readback.height=height;const ctx=readback.getContext('2d',{willReadFrequently:true})!;
      for(let i=0;i<count;i++){
        await drawAt(i*duration/count,i===count-1||i===count/2);ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,width,height).data;
        const palette=quantize(pixels,256),index=applyPalette(pixels,palette);
        gif.writeFrame(index,width,height,{palette,repeat:-1,delay:(Math.round((i+1)*duration*100/count)-Math.round(i*duration*100/count))*10});
        report(.05+.9*(i+1)/count,`正在生成动图 ${i+1}/${count} 帧`);await pause();
      }
      gif.finish();return{blob:new Blob([gif.bytes() as BlobPart],{type:'image/gif'}),filename:`${fileStem(asset.name)}_Live_单次播放.gif`,width,height,duration,backend:'GIF'};
    }
    report(.03,'准备声音（素材留在本机）');
    const sound=await audio.render(audioSettings,duration,asset.kind==='video'?asset.file:undefined,start);checkAbort(signal);
    const native=await canEncodeVideo('avc',{width,height,frameRate:30})&&(!sound||await canEncodeAudio('aac',{sampleRate:sound.sampleRate,numberOfChannels:sound.numberOfChannels}));
    let movie:Uint8Array,backend:string;
    const count=Math.max(2,Math.round(duration*30/2)*2),frameDuration=duration/count;
    if(native){
      const format=target==='apple'?new MovOutputFormat({fastStart:'in-memory',metadataFormat:'mdta'}):new Mp4OutputFormat({fastStart:'in-memory',metadataFormat:'mdta'});
      const out=new Output({format,target:new BufferTarget()});
      const video=new CanvasSource(canvas,{codec:'avc',bitrate:Math.max(6e6,width*height*7),keyFrameInterval:.5});
      out.addVideoTrack(video,{frameRate:30});
      const soundSource=sound?new AudioBufferSource({codec:'aac',bitrate:192000}):undefined;if(soundSource)out.addAudioTrack(soundSource);
      const raw=quickTimeMetadata(meta);
      out.setMetadataTags({title:`${fileStem(asset.name)} · Live`,artist:meta.artist,description:meta.description,creationTime:meta.capturedAt?new Date(meta.capturedAt+(meta.offsetTime||'')):undefined,raw});
      const abortOutput=()=>{void out.cancel();};signal.addEventListener('abort',abortOutput,{once:true});
      try{
        await out.start();if(soundSource&&sound)await soundSource.add(sound);
        for(let i=0;i<count;i++){await drawAt(i*frameDuration,i===count-1||i===count/2);await video.add(i*frameDuration,frameDuration);report(.08+.78*(i+1)/count,`正在生成 ${i+1}/${count} 帧`);if(i%5===0)await pause();}
        video.close();soundSource?.close();await out.finalize();movie=new Uint8Array(out.target.buffer!);backend='WebCodecs';
      }catch(e){await out.cancel().catch(()=>{});throw e;}finally{signal.removeEventListener('abort',abortOutput);}
    }else{
      codec=new WasmCodec();await codec.load((n,m)=>report(.06+n*.04,m));checkAbort(signal);
      for(let i=0;i<count;i++){await drawAt(i*frameDuration,i===count-1||i===count/2);await codec.write(`frame${String(i).padStart(4,'0')}.jpg`,await blobBytes(canvas));report(.1+.45*(i+1)/count,`准备兼容编码 ${i+1}/${count} 帧`);}
      if(sound)await codec.write('audio.wav',audioBufferWav(sound));
      const filename=target==='apple'?'result.mov':'result.mp4';
      codec.onProgress=(n)=>report(.55+n*.3,'正在本机兼容编码');
      const tags=Object.entries(quickTimeMetadata(meta)).flatMap(([k,v])=>['-metadata',`${k}=${v}`]);
      await codec.exec(['-framerate',String(count/duration),'-i','frame%04d.jpg',...(sound?['-i','audio.wav']:[]),'-c:v','libx264','-preset','ultrafast','-crf','17','-pix_fmt','yuv420p',...(sound?['-c:a','aac','-b:a','192k']:[]),'-t',String(duration),'-movflags','+faststart+use_metadata_tags',...tags,filename]);
      movie=await codec.read(filename);backend='FFmpeg WASM';
    }
    movie=trimMovieDuration(movie,duration);
    checkAbort(signal);report(.9,'写入主图、照片信息和设备封装');
    const randomBytes=crypto.getRandomValues(new Uint8Array(16));randomBytes[6]=(randomBytes[6]&15)|64;randomBytes[8]=(randomBytes[8]&63)|128;
    const hex=Array.from(randomBytes,b=>b.toString(16).padStart(2,'0')).join('');
    const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    const stillSize=outputSize(asset.width,asset.height,p.aspect,4096),stillCanvas=document.createElement('canvas');
    stillCanvas.width=stillSize.width;stillCanvas.height=stillSize.height;
    const stillRenderer=new FrameRenderer(stillCanvas);
    stillRenderer.draw(asset.poster,createGeometry(asset.width,asset.height,stillSize.width,stillSize.height,p,[],subject),STILL_FRAME,true,asset.kind==='photo'?{params:p,seconds:duration/2,seed:take.seed,take,layers:asset.depthLayers}:undefined);
    let jpeg=await blobBytes(stillCanvas);stillRenderer.dispose();
    jpeg=writePhotoMetadata(jpeg,meta,stillSize.width,stillSize.height,target==='apple'?id:undefined);
    const stem=`${fileStem(asset.name)}_Live`;
    let blob:Blob,filename:string;
    if(target==='android'){blob=new Blob([buildAndroidMotionPhoto(jpeg,movie,duration/2) as BlobPart],{type:'image/jpeg'});filename=`${stem}_Android_MP.jpg`;}
    else if(target==='huawei'){blob=new Blob([buildHuaweiMotionPhoto(jpeg,movie,Math.round(count/2),count) as BlobPart],{type:'image/jpeg'});filename=`${stem}_Huawei.jpg`;}
    else if(target==='apple'){
      const mov=buildAppleLiveMov(movie,id,duration/2,duration);
      const readme=`苹果 Live Photo 导入\n\n1. 将此压缩包解压，JPG 与 MOV 必须保留在同一文件夹。\n2. 使用项目附带的 Mac 导入工具，选择解压后的文件夹。\n3. 在 macOS 照片中确认 LIVE 标识与声音，再通过照片图库同步或从照片 App 分享到 iPhone。\n4. 在 iPhone 照片中确认 LIVE 标识并按住播放。\n\n浏览器直接分别保存 JPG 和 MOV 不等同于创建 Live Photo。\n工具下载：https://github.com/BurntRoses/live-photo-maker/releases\n`;
      const bytes=zipSync({[`${stem}.jpg`]:jpeg,[`${stem}.mov`]:mov,'导入说明.txt':strToU8(readme),'作品信息.json':strToU8(JSON.stringify({version:1,posterTime:duration/2,duration,metadata:meta,take,params:p},null,2))},{level:0});
      blob=new Blob([bytes as BlobPart],{type:'application/zip'});filename=`${stem}_Apple.zip`;
    }else{blob=new Blob([movie as BlobPart],{type:'video/mp4'});filename=`${stem}_视频.mp4`;}
    report(1,'导出完成');return{blob,filename,width,height,duration,backend};
  } finally {input?.dispose();renderer.dispose();codec?.cancel();signal.removeEventListener('abort',cleanupCodec);if(asset.kind==='video')await seekVideo(asset.element as HTMLVideoElement,asset.duration/2).catch(()=>{});}
}
export function audioBufferWav(buffer: AudioBuffer): Uint8Array {
  const channels=buffer.numberOfChannels,length=buffer.length,bytes=new Uint8Array(44+length*channels*2),v=new DataView(bytes.buffer);
  const text=(p:number,t:string)=>{for(let i=0;i<t.length;i++)v.setUint8(p+i,t.charCodeAt(i));};
  text(0,'RIFF');v.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,bytes.length-44,true);
  const data=Array.from({length:channels},(_,c)=>buffer.getChannelData(c));let p=44;
  for(let i=0;i<length;i++)for(let c=0;c<channels;c++){const n=Math.max(-1,Math.min(1,data[c][i]));v.setInt16(p,Math.round(n*(n<0?32768:32767)),true);p+=2;}return bytes;
}
