import bank from '../data/trajectories.json';
import type { EffectParams, MotionFrame, MotionTake } from './types';

export const motionCalibration = bank.calibration;
export const referenceTracks = bank.tracks;

// All 23 measurements are retained. Default selection rejects the examples with
// aggressive camera turns, marked zoom, negligible end jumps, or weak consensus.
const naturalTracks = referenceTracks.filter(track =>
  track.quality.acceptedFraction >= .95 &&
  track.measurements.maxTranslation <= .04 &&
  track.measurements.maxRotationDegrees <= 1 &&
  track.measurements.maxScalePercent <= 2 &&
  track.measurements.endJump >= .004 &&
  track.measurements.speedP90 < .05,
);

export function randomUnit(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let x = Math.imul(state ^ state >>> 15, 1 | state);
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

/** One immutable camera take. Calling play never calls this function. */
export function createTake(seed = freshSeed()): MotionTake {
  const random = randomUnit(seed);
  const trajectory = naturalTracks[Math.floor(random() * naturalTracks.length)];
  return {
    seed: seed >>> 0,
    trajectoryId: trajectory.id,
    mirrorX: random() < .5 ? -1 : 1,
    mirrorY: random() < .5 ? -1 : 1,
  };
}

function freshSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Catmull-Rom interpolation preserves the recorded direction changes, rather
 * than replacing them with a periodic procedural oscillation. */
function pointAt(points: number[][], progress: number): number[] {
  const position = clamp(progress, 0, 1) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(position));
  const t = position - i;
  const a = points[Math.max(0, i - 1)];
  const b = points[i];
  const c = points[i + 1];
  const d = points[Math.min(points.length - 1, i + 2)];
  return b.map((v, axis) => .5 * ((2 * v) + (-a[axis] + c[axis]) * t +
    (2 * a[axis] - 5 * v + 4 * c[axis] - d[axis]) * t * t +
    (-a[axis] + 3 * v - 3 * c[axis] + d[axis]) * t * t * t));
}

/** Geometric origin is exactly the still photo at .5. The terminal hard cut is
 * deliberately not in this function: playback/export swaps to the static still. */
export function motionAt(progress: number, take: MotionTake, params: EffectParams): MotionFrame {
  const t = clamp(progress, 0, 1);
  const track = referenceTracks.find(item => item.id === take.trajectoryId) ?? naturalTracks[0];
  const sample = pointAt(track.points, t);
  const middle = pointAt(track.points, .5);
  const path = sample.map((v, axis) => v - middle[axis]);
  const strength = clamp(params.strength, 0, 5);
  // Do not amplify almost-static measurements. Only damp reference outliers.
  const translationScale = Math.min(1,
    motionCalibration.defaultTranslationEnvelope / Math.max(.0001, track.measurements.maxTranslation));
  const rotationScale = Math.min(1,
    motionCalibration.defaultRotationEnvelopeDegrees / Math.max(.0001, track.measurements.maxRotationDegrees));
  const x = path[0] * translationScale * strength * take.mirrorX;
  const y = path[1] * translationScale * strength * take.mirrorY;
  const rotation = path[2] * rotationScale * clamp(params.rotation, 0, 2) * strength * take.mirrorX;
  const recordedBreath = clamp(path[3], -.02, .02) * .08 * strength;
  const push = params.zoomDirection * clamp(params.zoomAmount, 0, .2) * (2 * t - 1);
  const zoom = Math.exp(recordedBreath + push);
  const blur = clamp(params.focus, 0, 1.5) * Math.pow(Math.max(0, 1 - 2 * t), 2);
  let exposure = 1 + clamp(params.exposure, 0, .03) * (2 * t - 1);
  if (params.flash) {
    // A real light change: no white overlay. At the still timestamp the original
    // brightness is reached; the brief post-capture tail decays within 90 ms.
    if (t < .5) exposure = .68 + .04 * t;
    else if (t < .53) exposure = 1 + .06 * Math.sin((t - .5) / .03 * Math.PI);
    else exposure = 1;
  }
  return { x, y, rotation, zoom, blur, exposure };
}
