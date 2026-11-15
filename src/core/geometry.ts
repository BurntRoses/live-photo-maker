import type { EffectParams, MotionFrame, SubjectBounds } from './types';

export interface Geometry { width: number; height: number; sourceWidth: number; sourceHeight: number; centerX: number; centerY: number; scale: number; gain: number; subject?:SubjectBounds }
export function outputSize(iw: number, ih: number, aspect: EffectParams['aspect'], maxEdge = 1440) {
  const ratio = aspect === 'original' ? iw / ih : aspect === '3:4' ? .75 : 9 / 16;
  const maxW = Math.min(iw, maxEdge), maxH = Math.min(ih, maxEdge);
  let w = Math.min(maxW, maxH * ratio), h = w / ratio;
  return { width: Math.max(2, Math.floor(w / 2) * 2), height: Math.max(2, Math.floor(h / 2) * 2) };
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export function createGeometry(iw: number, ih: number, width: number, height: number, params: EffectParams, frames: MotionFrame[] = [], subject?:SubjectBounds): Geometry {
  const base = Math.max(width / iw, height / ih);
  const g: Geometry = { width, height, sourceWidth: iw, sourceHeight: ih,
    centerX: clamp(params.cropX * iw, width * (1-2*params.margin) / (2 * base), iw - width * (1-2*params.margin) / (2 * base)),
    centerY: clamp(params.cropY * ih, height * (1-2*params.margin) / (2 * base), ih - height * (1-2*params.margin) / (2 * base)),
    scale: base / (1 - 2 * params.margin), gain: 1 };
  if(params.protectSubject&&subject){
    const halfW=width/(2*g.scale),halfH=height/(2*g.scale);
    const loX=Math.max(halfW,subject.right*iw-halfW),hiX=Math.min(iw-halfW,subject.left*iw+halfW);
    const loY=Math.max(halfH,subject.bottom*ih-halfH),hiY=Math.min(ih-halfH,subject.top*ih+halfH);
    if(loX<=hiX&&loY<=hiY){g.centerX=clamp(g.centerX,loX,hiX);g.centerY=clamp(g.centerY,loY,hiY);g.subject=subject;}
  }
  if (frames.length && !frames.every(f => frameCovered(g, f, 1))) {
    let a = 0, b = 1;
    for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (frames.every(f => frameCovered(g, f, m))) a = m; else b = m; }
    g.gain = a * .999;
  }
  return g;
}
export function adjustedFrame(frame: MotionFrame, gain: number): MotionFrame {
  // Soft focus also needs source pixels beyond the viewport. When a protected
  // subject already touches the source edge, returning to a safe still must
  // remove that sampling radius as well as camera movement.
  return { ...frame, x: frame.x * gain, y: frame.y * gain, rotation: frame.rotation * gain, zoom: Math.exp(Math.log(frame.zoom) * gain), blur: frame.blur * gain };
}
export function inverseTransform(g: Geometry, frame: MotionFrame, gain = g.gain): number[] {
  const f = adjustedFrame(frame, gain), s = g.scale * f.zoom;
  const a = Math.cos(f.rotation) / s, b = Math.sin(f.rotation) / s;
  const cx = g.width * (.5 + f.x), cy = g.height * (.5 + f.y);
  return [a, -b, 0, b, a, 0, g.centerX - a * cx - b * cy, g.centerY + b * cx - a * cy, 1];
}
export function frameCovered(g: Geometry, frame: MotionFrame, gain = g.gain): boolean {
  const m = inverseTransform(g, frame, gain);
  const f=adjustedFrame(frame,gain),padding=f.blur*g.height/1440/(g.scale*f.zoom)*3;
  const edgesCovered = [[0, 0], [g.width, 0], [g.width, g.height], [0, g.height]].every(([x, y]) => {
    const sx = m[0] * x + m[3] * y + m[6], sy = m[1] * x + m[4] * y + m[7];
    return sx >= padding-1e-6 && sy >= padding-1e-6 && sx <= g.sourceWidth-padding+1e-6 && sy <= g.sourceHeight-padding+1e-6;
  });
  if(!edgesCovered)return false;
  if(!g.subject)return true;
  const s=g.scale*f.zoom,c=Math.cos(f.rotation),sn=Math.sin(f.rotation),b=g.subject;
  return [[b.left,b.top],[b.right,b.top],[b.right,b.bottom],[b.left,b.bottom]].every(([x,y])=>{
    const dx=x*g.sourceWidth-g.centerX,dy=y*g.sourceHeight-g.centerY;
    const px=g.width*(.5+f.x)+s*(c*dx-sn*dy),py=g.height*(.5+f.y)+s*(sn*dx+c*dy);
    return px>=-1e-6&&py>=-1e-6&&px<=g.width+1e-6&&py<=g.height+1e-6;
  });
}
export function safeGain(g: Geometry, frame: MotionFrame): number {
  if (frameCovered(g, frame)) return g.gain;
  let a = 0, b = g.gain;
  for (let i = 0; i < 22; i++) { const m = (a + b) / 2; if (frameCovered(g, frame, m)) a = m; else b = m; }
  return a * .999;
}
