import { DEFAULT_PARAMS, type EffectParams, type SceneEffect, type MotionFrame, type MotionTake } from './types';
import type { DepthLayers } from './depth';
import { createTake, motionAt } from './motion';
import { cameraRigAt, composeMotionFrames } from './camera-rig';

export interface SceneDrawOptions {
  params: EffectParams;
  /** Negative time renders the unaltered poster. */
  seconds: number;
  seed: number;
  layers?: DepthLayers;
  take?: MotionTake;
}
export interface SceneRect { x: number; y: number; width: number; height: number }
export interface DepthPose { frontX: number; frontY: number; backX: number; backY: number; frontScale: number; backScale: number }
export interface BackgroundCamera {
  foreground: MotionFrame;
  background: MotionFrame;
  shutter: [MotionFrame, MotionFrame, MotionFrame];
  blur: number;
}
const IDENTITY: MotionFrame = {x:0,y:0,rotation:0,zoom:1,blur:0,exposure:1};
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const smooth = (a: number, b: number, n: number) => { const t = clamp((n-a)/(b-a)); return t*t*(3-2*t); };

/** Depth returns to the capture; local material keeps moving through it. */
export function sceneEnvelope(seconds: number, duration: number, effect: SceneEffect = 'depth'): number {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(duration) || duration <= 0) return 0;
  if(effect==='steam'||effect==='candle')return 1;
  const distance = Math.abs(clamp(seconds / duration) - .5);
  return smooth(0, .09, distance);
}

/** Reconstructed boundaries must approach the exact capture continuously. Only
 * this short window around the middle is blended; playback keeps its hard end. */
export function captureBlend(seconds: number, duration: number): number {
  if(!Number.isFinite(seconds)||seconds<0||!Number.isFinite(duration)||duration<=0)return 0;
  return smooth(0,Math.min(.12,duration*.04),Math.abs(seconds-duration/2));
}

/** Shared photo camera plus bounded far-layer parallax. Kept as a compact
 * compatibility view for pose readers; rendering uses the same rig directly. */
export function backgroundCamera(frame: MotionFrame, scene: SceneDrawOptions, aspect = 1): BackgroundCamera {
  const rig=cameraRigAt(frame,scene,aspect);
  return {foreground:rig.global,background:composeMotionFrames(rig.global,rig.relativeBackground,aspect),
    shutter:rig.globalShutter.map((global,i)=>composeMotionFrames(global,rig.relativeShutter[i],aspect)) as BackgroundCamera['shutter'],blur:rig.blur};
}

/** Pose access in source-normalized output coordinates. */
export function depthPose(seconds: number, duration: number, amount: number): DepthPose {
  const params={...DEFAULT_PARAMS,duration,sceneAmount:amount},take=createTake(0);
  const c=backgroundCamera(motionAt(clamp(seconds/Math.max(.001,duration)),take,params),{params,seconds,seed:0,take});
  return {frontX:c.foreground.x,frontY:c.foreground.y,frontScale:c.foreground.zoom,backX:c.background.x,backY:c.background.y,backScale:c.background.zoom};
}

/** Plume coordinates stay attached to the photograph when the camera moves. */
export function sceneRect(p: EffectParams): SceneRect {
  const width = clamp(p.sceneWidth, .004, 1), height = clamp(p.sceneHeight, .01, 1);
  if (p.sceneEffect === 'candle') return { x:p.sceneX-width*2.5, y:p.sceneY-height*1.15, width:width*5, height:height*1.5 };
  return { x:p.sceneX-width*1.2, y:p.sceneY-height*1.04, width:width*2.4, height:height*1.08 };
}

// A fixed random lattice gives a continuous material field. Advecting it upwards
// produces wisps, rather than independent dots or clouds appearing/disappearing.
const lattice = new Float32Array(128*128);
for (let i=0;i<lattice.length;i++) { let h=Math.imul(i+193,374761393); h=Math.imul(h^(h>>>13),1274126177); lattice[i]=((h^(h>>>16))>>>0)/4294967296; }
function noise(x: number, y: number): number {
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  const at=(a:number,b:number)=>lattice[((b&127)<<7)+(a&127)];
  const a=at(ix,iy)*(1-u)+at(ix+1,iy)*u,b=at(ix,iy+1)*(1-u)+at(ix+1,iy+1)*u;
  return a*(1-v)+b*v;
}

/** A bounded translucent, turbulent density field in emitter coordinates. */
export function steamDensity(x: number, y: number, seconds: number, seed: number, wind: number): number {
  if (y <= 0 || y >= 1 || Math.abs(x)>1.2) return 0;
  const phase=((seed>>>0)%997)/157, t=seconds*.62;
  const warp=(noise(x*3.8+phase,y*7-t)-.5)*(.08+.28*y);
  const drift=(noise(y*4-t*.35,phase)-.5)*y*.45+Math.sin(y*6.8-t*1.1+phase)*y*.06+clamp(wind,-1,1)*y*.7;
  let density=0;
  for(let strand=0;strand<3;strand++) {
    const center=drift+(strand-1)*(.1+y*.09)+warp+(noise(y*5-t*.6,phase+strand*5)-.5)*y*.2;
    const width=(.045+y*.105)*(.65+noise(y*6-t*.8,strand*7+phase)*.7);
    const dx=(x-center)/width;
    density+=Math.exp(-dx*dx*1.6)*( .12+.88*noise(x*7+phase+strand*9,y*11-t*1.3) );
  }
  const broad=(x-drift-warp*.5)/(.15+y*.2);
  const diffuse=Math.exp(-broad*broad*1.5)*Math.pow(noise(x*8+phase,y*9-t*1.2),1.6);
  return clamp((density*.6+diffuse*.55)*smooth(0,.045,y)*(1-smooth(.48,1,y))*.23);
}

export class SceneOverlay {
  readonly canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private pixels: ImageData;
  private lastKey='';
  constructor() {
    this.canvas=document.createElement('canvas');this.canvas.width=160;this.canvas.height=256;
    this.context=this.canvas.getContext('2d')!;
    this.pixels=this.context.createImageData(160,256);
  }
  render(scene: SceneDrawOptions): SceneRect | undefined {
    const p=scene.params,envelope=sceneEnvelope(scene.seconds,p.duration,p.sceneEffect),amount=clamp(p.sceneAmount)*envelope;
    if (!amount || (p.sceneEffect!=='steam' && p.sceneEffect!=='candle')) return;
    const rect=sceneRect(p),key=[scene.seconds,scene.seed,p.sceneEffect,p.sceneAmount,p.sceneWidth,p.sceneHeight,p.sceneWind,p.duration].join('/');
    if(key===this.lastKey)return rect;
    this.lastKey=key;
    const {width,height}=this.canvas,d=this.pixels.data;
    const phase=(scene.seed>>>0)%997*.013;
    const flicker=1+.045*Math.sin(scene.seconds*17+phase)+.025*Math.sin(scene.seconds*29+phase*.7);
    for(let py=0;py<height;py++)for(let px=0;px<width;px++) {
      const i=(py*width+px)*4;
      let alpha=0,r=235,g=237,b=231;
      if(p.sceneEffect==='steam') {
        const x=(px/(width-1)*2-1)*1.2,y=1.04-py/(height-1)*1.08;
        alpha=steamDensity(x,y,scene.seconds,scene.seed,p.sceneWind)*amount;
      } else {
        const x=(px/(width-1)*5-2.5),y=1.15-py/(height-1)*1.5;
        const lean=(Math.sin(scene.seconds*5.2+phase)*.12+Math.sin(scene.seconds*9.1+phase)*.045)*Math.max(0,y);
        const fy=y/flicker,flameWidth=.24*Math.sin(Math.PI*clamp(fy))+.016;
        const flame=Math.exp(-Math.pow((x-lean)/flameWidth,2)*2.5)*smooth(-.015,.06,fy)*(1-smooth(.64,1,fy));
        const core=Math.exp(-Math.pow((x-lean)/(.12+Math.max(0,fy)*.06),2)*3)*smooth(0,.08,fy)*(1-smooth(.25,.65,fy));
        const glow=Math.exp(-(x*x*.65+(y-.28)*(y-.28)*3.4)*2.8)*.075;
        alpha=clamp(flame*.48+core*.28+glow)*amount;
        r=255;g=160+core*80;b=51+core*130;
      }
      d[i]=r;d[i+1]=g;d[i+2]=b;d[i+3]=Math.round(clamp(alpha)*255);
    }
    this.context.putImageData(this.pixels,0,0);
    return rect;
  }
}
