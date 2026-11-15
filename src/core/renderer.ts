import type { EffectParams, MotionFrame } from './types';
import { adjustedFrame, frameCovered, inverseTransform, safeGain, type Geometry } from './geometry';
import { SceneOverlay, captureBlend, type SceneDrawOptions, type SceneRect } from './scene';
import { createPerspectiveCamera, unprojectPoint, curveJacobian, PERSPECTIVE_GLSL, type CurveCamera } from './perspective';
import { drawPerspectiveCanvas } from './perspective-canvas';
import { cameraRigAt, composeMotionFrames } from './camera-rig';
export type { SceneDrawOptions } from './scene';
export const STILL_FRAME: MotionFrame = { x: 0, y: 0, rotation: 0, zoom: 1, blur: 0, exposure: 1 };
/** A photo camera needs a subject mask. Supplementary steam/light switches do
 * not control subject protection, and a missing mask never moves the subject. */
export function photoRenderState(frame: MotionFrame, scene?: SceneDrawOptions) {
  if(!scene)return {frame,layers:undefined,overlayActive:false};
  const active=scene.seconds>=0,capture=Math.abs(scene.seconds/Math.max(.001,scene.params.duration)-.5)<1e-8;
  const layers=active&&!capture?scene.layers:undefined;
  return {frame:layers?frame:STILL_FRAME,layers,overlayActive:active&&(scene.params.sceneEffect==='steam'||scene.params.sceneEffect==='candle')};
}
export interface BackgroundSamplingPlan {
  geometry: Geometry;
  gain: number;
  samples: [MotionFrame, MotionFrame, MotionFrame];
  sourceRadii: [number, number, number];
  cameras: [CurveCamera, CurveCamera, CurveCamera];
  curvature: number;
  foregroundSamples?: [MotionFrame, MotionFrame, MotionFrame];
}
/** The shutter and its blur kernel must fit the same available source pixels.
 * Reducing camera motion without reducing the sampled radius can expose edges. */
export function backgroundSamplingPlan(geometry: Geometry, shutter: [MotionFrame, MotionFrame, MotionFrame], blur: number, perspective = 0, curvature = 0, rig?: {foregroundShutter: [MotionFrame, MotionFrame, MotionFrame]; perspectiveShutter: [MotionFrame, MotionFrame, MotionFrame]}): BackgroundSamplingPlan {
  const g={...geometry,subject:undefined,gain:1},radius=Number.isFinite(blur)?Math.max(0,blur):0;
  const requested=shutter.map(frame=>({...frame,blur:radius}));
  const amount=Number.isFinite(perspective)?Math.max(0,Math.min(1,perspective)):0;
  const curve=Number.isFinite(curvature)?Math.max(-.45,Math.min(1.5,curvature)):0;
  const unit=Math.min(g.sourceWidth,g.sourceHeight),aspect=g.width/g.height;
  const projectFrames=rig?.perspectiveShutter??shutter;
  const foregroundAt=(value:number)=>rig?.foregroundShutter.map(frame=>adjustedFrame(frame,value)) as BackgroundSamplingPlan['foregroundSamples'];
  const samplesAt=(value:number)=>requested.map((raw,i)=>rig?
    {...composeMotionFrames(adjustedFrame(rig.foregroundShutter[i],value),adjustedFrame(projectFrames[i],value),aspect),blur:radius*value}:
    adjustedFrame(raw,value)) as BackgroundSamplingPlan['samples'];
  const camerasAt=(value:number)=>projectFrames.map(frame=>createPerspectiveCamera(adjustedFrame(frame,value),amount)) as BackgroundSamplingPlan['cameras'];
  const covered=(value:number)=>{
    const foreground=foregroundAt(value);
    if(foreground&&!foreground.every(frame=>frameCovered(geometry,frame,1)))return false;
    const cameras=camerasAt(value);
    return samplesAt(value).every((frame,i)=>{
      if(!frameCovered(g,frame,1))return false;
      if(!amount)return true;
      const camera=cameras[i],m=inverseTransform(g,frame,1),padding=frame.blur*g.height/1440/(g.scale*frame.zoom)*3;
      for(let y=0;y<=8;y++)for(let x=0;x<=8;x++){
        const px=x*g.width/8,py=y*g.height/8;
        const sx=m[0]*px+m[3]*py+m[6],sy=m[1]*px+m[4]*py+m[7];
        const point=unprojectPoint((sx-g.centerX)/unit,(sy-g.centerY)/unit,camera,curve);
        if(!point)return false;
        const j=curveJacobian(point.x,point.y,camera,curve);
        if(!Number.isFinite(j.det)||j.det<.25||j.det>4)return false;
        const sourceX=point.x*unit+g.centerX,sourceY=point.y*unit+g.centerY;
        if(sourceX<padding-1e-6||sourceY<padding-1e-6||sourceX>g.sourceWidth-padding+1e-6||sourceY>g.sourceHeight-padding+1e-6)return false;
      }
      return true;
    });
  };
  let gain=1;
  if(!covered(gain)){
    let lo=0,hi=1;
    for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(covered(mid))lo=mid;else hi=mid;}
    gain=lo*.998;
  }
  const samples=samplesAt(gain),cameras=camerasAt(gain);
  const sourceRadii=samples.map(frame=>frame.blur*g.height/1440/(g.scale*frame.zoom)) as BackgroundSamplingPlan['sourceRadii'];
  return {geometry:g,gain,samples,sourceRadii,cameras,curvature:curve,foregroundSamples:foregroundAt(gain)};
}
const vertex = `#version 300 es
in vec2 aPosition; out vec2 uv; void main(){uv=vec2(aPosition.x*.5+.5,.5-aPosition.y*.5);gl_Position=vec4(aPosition,0,1);}`;
const fragment = `#version 300 es
precision highp float; in vec2 uv; out vec4 color;
uniform sampler2D image; uniform sampler2D background; uniform sampler2D protectionMask; uniform sampler2D overlay;
uniform mat3 inverse; uniform mat3 foregroundInverse[3]; uniform mat3 backgroundInverse[3];
uniform vec2 outputSize; uniform vec2 sourceSize; uniform float softness; uniform vec3 backgroundSoftness; uniform float exposure; uniform float sceneBlend;
uniform bool depthActive; uniform bool overlayActive; uniform vec4 overlayRect;
uniform vec3 curvePose[3]; uniform vec2 curveShift[3]; uniform vec3 curveOptics; uniform float curvature;
${PERSPECTIVE_GLSL}
vec2 curveSource(vec2 source,vec3 pose,vec2 shift){
  vec3 ray=curveUnproject((source-curveOptics.xy)/curveOptics.z,pose,shift,curvature);
  return (ray.xy*curveOptics.z+curveOptics.xy)/sourceSize;
}
vec3 addOverlay(vec3 c,vec2 p){
  if(overlayActive){vec2 q=(p-overlayRect.xy)/overlayRect.zw;float inside=step(0.,q.x)*step(q.x,1.)*step(0.,q.y)*step(q.y,1.);vec4 fx=texture(overlay,q);return mix(c,fx.rgb,fx.a*inside*sceneBlend);}return c;
}
vec3 photograph(vec2 p){return addOverlay(texture(image,p).rgb,p);}
vec3 softBackground(vec2 p,float radius){vec2 d=vec2(radius)/sourceSize;vec3 c=texture(background,p).rgb*.4;
  c+=texture(background,p+vec2(d.x,0)).rgb*.15;c+=texture(background,p-vec2(d.x,0)).rgb*.15;c+=texture(background,p+vec2(0,d.y)).rgb*.15;c+=texture(background,p-vec2(0,d.y)).rgb*.15;return c;}
vec3 cameraSample(vec3 screen,int index){
  vec2 fp=(foregroundInverse[index]*screen).xy/sourceSize;
  vec2 bp=curveSource((backgroundInverse[index]*screen).xy,curvePose[index],curveShift[index]);
  vec3 original=texture(image,fp).rgb;
  vec3 bg=mix(original,softBackground(bp,backgroundSoftness[index]),sceneBlend);
  float protection=texture(protectionMask,fp).a;
  float inside=step(0.,fp.x)*step(fp.x,1.)*step(0.,fp.y)*step(fp.y,1.);
  return addOverlay(mix(bg,original,protection*inside),fp);
}
void main(){vec3 screen=vec3(uv*outputSize,1);vec2 p=(inverse*screen).xy/sourceSize;vec3 c;
  if(depthActive){
    // Composite a complete photograph at EACH shutter instant. Averaging the
    // mask independently creates cross terms and ghosts around moving edges.
    c=cameraSample(screen,0)*.25+cameraSample(screen,1)*.5+cameraSample(screen,2)*.25;
    c*=exposure;
  }else{vec2 d=vec2(softness)/sourceSize;
    c=photograph(p)*.4;c+=photograph(p+vec2(d.x,0))*.15;c+=photograph(p-vec2(d.x,0))*.15;c+=photograph(p+vec2(0,d.y))*.15;c+=photograph(p-vec2(0,d.y))*.15;c*=exposure;
  }color=vec4(clamp(c,0.,1.),1.);}`;

export class FrameRenderer {
  private gl: WebGL2RenderingContext | null;
  private context: CanvasRenderingContext2D | null = null;
  private program?: WebGLProgram;
  private texture?: WebGLTexture;
  private backgroundTexture?: WebGLTexture;
  private maskTexture?: WebGLTexture;
  private overlayTexture?: WebGLTexture;
  private uploaded?: TexImageSource;
  private uploadedLayers?: SceneDrawOptions['layers'];
  private overlay?: SceneOverlay;
  private layeredCanvas?: HTMLCanvasElement;
  private backgroundCanvas?: HTMLCanvasElement;
  private protectionCanvas?: HTMLCanvasElement;
  private perspectiveCanvas?: HTMLCanvasElement;
  readonly backend: 'WebGL2' | 'Canvas 2D';
  constructor(readonly canvas: HTMLCanvasElement, forceCanvas = false) {
    this.gl = forceCanvas ? null : canvas.getContext('webgl2', { alpha: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    this.backend = this.gl ? 'WebGL2' : 'Canvas 2D';
    if (!this.gl) { this.context = canvas.getContext('2d', { alpha: false }); if (!this.context) throw new Error('浏览器无法创建预览画布'); return; }
    const gl = this.gl;
    const compile = (type: number, code: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, code); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || '画面程序加载失败'); return shader; };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('画面程序初始化失败');
    this.program = program; gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'aPosition'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const texture=(unit:number,name:string,mipmaps=true)=>{const t=gl.createTexture()!;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mipmaps?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));if(mipmaps)gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform1i(gl.getUniformLocation(program,name),unit);return t;};
    this.texture=texture(0,'image');this.backgroundTexture=texture(1,'background');this.maskTexture=texture(2,'protectionMask',false);this.overlayTexture=texture(3,'overlay',false);
  }
  draw(source: TexImageSource, geometry: Geometry, frame: MotionFrame = STILL_FRAME, staticSource = false, scene?: SceneDrawOptions) {
    const { canvas } = this, g = geometry;
    if (canvas.width !== g.width) canvas.width = g.width; if (canvas.height !== g.height) canvas.height = g.height;
    const render=photoRenderState(frame,scene),layers=render.layers;
    const camera=layers?cameraRigAt(render.frame,scene!,g.width/g.height):undefined;
    const backgroundShutter=camera?.globalShutter.map((global,i)=>composeMotionFrames(global,camera.relativeShutter[i],g.width/g.height)) as [MotionFrame,MotionFrame,MotionFrame]|undefined;
    const sampling=camera&&backgroundShutter?backgroundSamplingPlan(g,backgroundShutter,camera.blur,scene!.params.perspective,scene!.params.curvature,{foregroundShutter:camera.globalShutter,perspectiveShutter:camera.relativeShutter}):undefined;
    const cameraGeometry=sampling?.geometry??g;
    const cameraFrame=sampling?.samples[1]??render.frame;
    const gain = sampling?1:safeGain(g,cameraFrame), f = adjustedFrame(cameraFrame, gain);
    const blend=scene?captureBlend(scene.seconds,scene.params.duration):1;
    let overlayRect:SceneRect|undefined;
    if(render.overlayActive){this.overlay??=new SceneOverlay();overlayRect=this.overlay.render(scene!);}
    if (this.gl) {
      const gl = this.gl, p = this.program!; gl.viewport(0, 0, g.width, g.height); gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D, this.texture!);
      if(!staticSource || this.uploaded!==source){gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);gl.generateMipmap(gl.TEXTURE_2D);this.uploaded=source;}
      gl.uniform1i(gl.getUniformLocation(p,'depthActive'),layers?1:0);
      gl.uniform1i(gl.getUniformLocation(p,'overlayActive'),overlayRect?1:0);
      gl.uniform1f(gl.getUniformLocation(p,'sceneBlend'),blend);
      if(layers&&sampling){
        if(this.uploadedLayers!==layers){
          for(const [unit,texture,src] of [[1,this.backgroundTexture,layers.background],[2,this.maskTexture,layers.mask]] as const){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture!);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);if(unit===1)gl.generateMipmap(gl.TEXTURE_2D);}this.uploadedLayers=layers;
        }
        sampling.samples.forEach((sample,i)=>{
          gl.uniformMatrix3fv(gl.getUniformLocation(p,`backgroundInverse[${i}]`),false,inverseTransform(cameraGeometry,sample,1));
          gl.uniformMatrix3fv(gl.getUniformLocation(p,`foregroundInverse[${i}]`),false,inverseTransform(g,sampling.foregroundSamples![i],1));
        });
        gl.uniform3f(gl.getUniformLocation(p,'backgroundSoftness'),...sampling.sourceRadii);
        gl.uniform3f(gl.getUniformLocation(p,'curveOptics'),g.centerX,g.centerY,Math.min(g.sourceWidth,g.sourceHeight));
        gl.uniform1f(gl.getUniformLocation(p,'curvature'),sampling.curvature);
        sampling.cameras.forEach((camera,i)=>{gl.uniform3f(gl.getUniformLocation(p,`curvePose[${i}]`),camera.yaw,camera.pitch,camera.dolly);gl.uniform2f(gl.getUniformLocation(p,`curveShift[${i}]`),camera.translateX,camera.translateY);});
      }
      if(overlayRect){gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.overlayTexture!);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.overlay!.canvas);
        gl.uniform4f(gl.getUniformLocation(p,'overlayRect'),overlayRect.x,overlayRect.y,overlayRect.width,overlayRect.height);}
      gl.uniformMatrix3fv(gl.getUniformLocation(p, 'inverse'), false, inverseTransform(cameraGeometry, cameraFrame, gain));
      gl.uniform2f(gl.getUniformLocation(p, 'outputSize'), g.width, g.height); gl.uniform2f(gl.getUniformLocation(p, 'sourceSize'), g.sourceWidth, g.sourceHeight);
      gl.uniform1f(gl.getUniformLocation(p, 'softness'), f.blur * g.height / 1440 / (g.scale * f.zoom));
      gl.uniform1f(gl.getUniformLocation(p, 'exposure'), layers?frame.exposure:f.exposure); gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      const c = this.context!;c.save();c.clearRect(0,0,g.width,g.height);
      const transform=(motion:MotionFrame,geometry:Geometry,frameGain=safeGain(geometry,motion),target=c)=>{const m=adjustedFrame(motion,frameGain);target.translate(g.width*(.5+m.x),g.height*(.5+m.y));target.rotate(m.rotation);target.scale(g.scale*m.zoom,g.scale*m.zoom);target.translate(-g.centerX,-g.centerY);return m;};
      if(layers&&sampling){
        const scratch=(name:'layeredCanvas'|'backgroundCanvas'|'protectionCanvas'|'perspectiveCanvas')=>{
          this[name]??=document.createElement('canvas');const value=this[name]!;
          if(value.width!==g.width)value.width=g.width;if(value.height!==g.height)value.height=g.height;return value;
        };
        const sampleCanvas=scratch('layeredCanvas'),background=scratch('backgroundCanvas'),protection=scratch('protectionCanvas');
        const sc=sampleCanvas.getContext('2d')!,bc=background.getContext('2d')!,pc=protection.getContext('2d')!;
        for(let i=0;i<3;i++){
          const m=sampling.samples[i],global=sampling.foregroundSamples![i];
          bc.clearRect(0,0,g.width,g.height);bc.save();bc.filter=`blur(${m.blur*g.height/1440}px)`;
          if(scene!.params.perspective>0){
            const mesh=scratch('perspectiveCanvas'),mc=mesh.getContext('2d')!;mc.clearRect(0,0,g.width,g.height);
            drawPerspectiveCanvas(mc,layers.background,cameraGeometry,m,sampling.cameras[i],sampling.curvature,inverseTransform(cameraGeometry,m,1));
            bc.drawImage(mesh,0,0);
          }else{transform(m,cameraGeometry,1,bc);bc.drawImage(layers.background,0,0,g.sourceWidth,g.sourceHeight);}bc.restore();
          // The same common camera samples source and mask at this exposure.
          pc.clearRect(0,0,g.width,g.height);pc.save();transform(global,g,1,pc);pc.drawImage(layers.mask,0,0,g.sourceWidth,g.sourceHeight);pc.restore();
          bc.save();bc.globalCompositeOperation='destination-out';bc.drawImage(protection,0,0);bc.restore();
          sc.clearRect(0,0,g.width,g.height);sc.save();transform(global,g,1,sc);sc.drawImage(source as CanvasImageSource,0,0);sc.restore();
          sc.save();sc.globalAlpha=blend;sc.drawImage(background,0,0);sc.restore();
          if(overlayRect){sc.save();sc.globalAlpha=blend;transform(global,g,1,sc);sc.drawImage(this.overlay!.canvas,overlayRect.x*g.sourceWidth,overlayRect.y*g.sourceHeight,overlayRect.width*g.sourceWidth,overlayRect.height*g.sourceHeight);sc.restore();}
          c.save();c.globalCompositeOperation='lighter';c.globalAlpha=i===1?.5:.25;c.filter=`brightness(${frame.exposure})`;c.drawImage(sampleCanvas,0,0);c.restore();
        }
      }else{
        c.filter=f.exposure===1&&f.blur===0?'none':`brightness(${f.exposure}) blur(${f.blur*g.height/1440}px)`;transform(render.frame,g);c.drawImage(source as CanvasImageSource,0,0);
        if(overlayRect){c.globalAlpha=blend;c.drawImage(this.overlay!.canvas,overlayRect.x*g.sourceWidth,overlayRect.y*g.sourceHeight,overlayRect.width*g.sourceWidth,overlayRect.height*g.sourceHeight);}
      }
      c.restore();
    }
  }
  dispose() { if (this.gl) { for(const texture of [this.texture,this.backgroundTexture,this.maskTexture,this.overlayTexture])if(texture)this.gl.deleteTexture(texture);this.gl.deleteProgram(this.program!); this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } }
}
export function quantizedProgress(seconds: number, duration: number, fps: number): number {
  const steps=Math.max(2,Math.round(duration*fps/2)*2);
  return Math.max(0,Math.min(.999999,Math.floor(seconds/duration*steps)/steps));
}
export function videoAppearance(progress: number, p: EffectParams): MotionFrame {
  let exposure = 1;
  if (p.flash) exposure = progress < .5 ? .68 + .04 * progress : progress < .53 ? 1+.06*Math.sin((progress-.5)/.03*Math.PI) : 1;
  return { ...STILL_FRAME, exposure, blur: p.focus * Math.max(0, 1 - progress * 2) };
}
