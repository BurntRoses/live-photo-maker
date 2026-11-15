import { motionAt } from './motion';
import type { SceneDrawOptions } from './scene';
import type { MotionFrame } from './types';

type ShutterFrames = [MotionFrame, MotionFrame, MotionFrame];

export interface CameraRig {
  /** Shared by the foreground, its mask, and the already composed background. */
  global: MotionFrame;
  /** Applied to the background before the shared camera transform. */
  relativeBackground: MotionFrame;
  globalShutter: ShutterFrames;
  relativeShutter: ShutterFrames;
  /** Background defocus, separate from the common directional shutter. */
  blur: number;
}

const IDENTITY: MotionFrame = { x: 0, y: 0, rotation: 0, zoom: 1, blur: 0, exposure: 1 };
const MAX_RELATIVE_SHORT_EDGE = .012;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;
const smooth = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

/** Compose centered output-space similarities: outer(inner(p)). Translation is
 * normalized independently by viewport width and height, so aspect is required
 * even though the underlying camera rotation and scale are isotropic. */
export function composeMotionFrames(outer: MotionFrame, inner: MotionFrame, aspect: number): MotionFrame {
  const ratio = Math.max(1e-6, finite(aspect, 1)), c = Math.cos(outer.rotation), s = Math.sin(outer.rotation);
  return {
    x: outer.x + outer.zoom * (c * inner.x - s * inner.y / ratio),
    y: outer.y + outer.zoom * (s * inner.x * ratio + c * inner.y),
    rotation: outer.rotation + inner.rotation,
    zoom: outer.zoom * inner.zoom,
    blur: Math.hypot(outer.blur, outer.zoom * inner.blur),
    exposure: outer.exposure * inner.exposure,
  };
}

function splitCamera(frame: MotionFrame, shake: number, depthRatio: number, aspect: number) {
  const global: MotionFrame = {
    ...frame,
    x: frame.x * shake || 0,
    y: frame.y * shake || 0,
    rotation: frame.rotation * shake || 0,
    zoom: Math.exp(Math.log(Math.max(.1, frame.zoom)) * shake),
    // Geometric shutter samples carry no extra Gaussian blur. Defocus is
    // returned separately, and exposure is applied once by the compositor.
    blur: 0,
    exposure: 1,
  };
  const c = Math.cos(global.rotation), s = Math.sin(global.rotation);
  const correction = (depthRatio - 1) / global.zoom;
  const relativeBackground: MotionFrame = {
    ...IDENTITY,
    // G(p) = scale R p + T and B(p) = scale R p + depthRatio T.
    // Thus Q = inverse(G) B has only the translation below. Its rotation and
    // scale remain identity, avoiding layer-specific roll or size breathing.
    x: correction * (c * global.x + s * global.y / aspect) || 0,
    y: correction * (-s * global.x * aspect + c * global.y) || 0,
  };
  const shortEdgeDistance = Math.hypot(relativeBackground.x * Math.max(aspect, 1), relativeBackground.y * Math.max(1 / aspect, 1));
  const budgetGain = Math.min(1, MAX_RELATIVE_SHORT_EDGE / Math.max(1e-12, shortEdgeDistance));
  relativeBackground.x *= budgetGain;
  relativeBackground.y *= budgetGain;
  return { global, relativeBackground };
}

/** A single measured camera take drives the complete photograph. Nearby and far
 * layers share its roll, scale, and exposure time; only a bounded relative
 * translation expresses depth. The middle is the exact still and the final
 * frame remains nonclosed for the player's explicit terminal hard cut. */
export function cameraRigAt(frame: MotionFrame, scene: SceneDrawOptions, aspect: number): CameraRig {
  const p = scene.params as SceneDrawOptions['params'] & { cameraShake?: number; parallax?: number };
  const duration = Math.max(.001, p.duration), progress = clamp(scene.seconds / duration, 0, 1);
  const capture = !Number.isFinite(scene.seconds) || scene.seconds < 0 || Math.abs(progress - .5) < 1e-8;
  if (capture) return {
    global: { ...IDENTITY }, relativeBackground: { ...IDENTITY },
    globalShutter: [{ ...IDENTITY }, { ...IDENTITY }, { ...IDENTITY }],
    relativeShutter: [{ ...IDENTITY }, { ...IDENTITY }, { ...IDENTITY }], blur: 0,
  };
  const ratio = Math.max(1e-6, finite(aspect, 1));
  const shake = clamp(finite(p.cameraShake, .75), 0, 1.5);
  const depthRatio = 1 - .4 * clamp(finite(p.parallax, .4), 0, 1);
  const center = splitCamera(frame, shake, depthRatio, ratio);
  const gate = smooth(Math.abs(progress - .5) / .035);
  const halfExposure = clamp(finite(p.motionBlur, .85), 0, 2) / 60 * gate;
  const sample = (offset: number) => scene.take
    ? splitCamera(motionAt(clamp((scene.seconds + offset) / duration, 0, 1), scene.take, p), shake, depthRatio, ratio)
    : center;
  const before = sample(-halfExposure), after = sample(halfExposure);
  return {
    ...center,
    globalShutter: [before.global, center.global, after.global],
    relativeShutter: [before.relativeBackground, center.relativeBackground, after.relativeBackground],
    blur: (Math.max(0, finite(p.backgroundBlur, 1.4)) + Math.max(0, frame.blur)) * gate,
  };
}
