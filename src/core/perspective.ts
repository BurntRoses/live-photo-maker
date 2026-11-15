import type { MotionFrame } from './types';

/** Camera-plane coordinates use the photograph's short edge as one unit.
 * x points right, y points down and the capture camera looks along +z.
 */
export interface CurveCamera {
  yaw: number;
  pitch: number;
  translateX: number;
  translateY: number;
  dolly: number;
}
export interface CurvePoint { x: number; y: number }
export interface ProjectedCurvePoint extends CurvePoint { depth: number }
export interface CurveRect { left: number; top: number; right: number; bottom: number }
export interface CurveJacobian { xx: number; xy: number; yx: number; yy: number; det: number }
export const IDENTITY_CURVE_CAMERA: Readonly<CurveCamera> = Object.freeze({ yaw: 0, pitch: 0, translateX: 0, translateY: 0, dolly: 0 });

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const curvatureValue = (value: number) => clamp(finite(value), -.45, 1.5);
const identity = (camera: CurveCamera) => camera.yaw === 0 && camera.pitch === 0 && camera.translateX === 0 && camera.translateY === 0 && camera.dolly === 0;

/** Reuses the selected nonperiodic take. Zero amount never changes old affine
 * motion, and its midpoint produces the identity camera without a time gate.
 */
export function createPerspectiveCamera(frame: MotionFrame, amount: number): CurveCamera {
  const gain = clamp(finite(amount), 0, 2);
  if (!gain) return { ...IDENTITY_CURVE_CAMERA };
  const x = finite(frame.x), y = finite(frame.y), zoom = Math.max(.1, finite(frame.zoom, 1));
  if (x === 0 && y === 0 && zoom === 1) return { ...IDENTITY_CURVE_CAMERA };
  return {
    yaw: clamp(x * gain * 1.4, -.12, .12),
    pitch: clamp(-y * gain * 1.4, -.1, .1),
    // Pair lateral displacement with yaw/pitch around the capture centre.
    // Their first-order image-centre shift cancels, leaving depth-dependent
    // parallax instead of merely adding another whole-background slide.
    translateX: clamp(x * gain * 1.4, -.06, .06),
    translateY: clamp(y * gain * 1.4, -.06, .06),
    dolly: clamp(Math.log(zoom) * gain * .25, -.06, .06),
  };
}

/** A bounded depth prior, not barrel distortion. Capture projection cancels z:
 * project(z*x,z*y,z) = (x,y), whatever the chosen curvature.
 */
export function curveDepth(x: number, y: number, curvature: number): number {
  const radius = x * x + .65 * y * y;
  return 1 + curvatureValue(curvature) * radius / (1 + radius);
}

function rotate(x: number, y: number, z: number, camera: CurveCamera): [number, number, number] {
  const sx = Math.sin(camera.pitch), cx = Math.cos(camera.pitch), sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw);
  const py = cx * y - sx * z, pz = sx * y + cx * z;
  return [cy * x + sy * pz, py, -sy * x + cy * pz];
}

/** Forward projection: q = Ry(yaw) Rx(pitch) (Z(x,y) [x,y,1] - C).
 * A nonpositive returned depth is behind the virtual camera and must be
 * rejected by coverage/mesh checks, rather than drawn across the image.
 */
export function projectPoint(x: number, y: number, camera: CurveCamera, curvature: number): ProjectedCurvePoint {
  if (identity(camera)) return { x, y, depth: curveDepth(x, y, curvature) };
  const depth = curveDepth(x, y, curvature);
  const [qx, qy, qz] = rotate(depth * x - camera.translateX, depth * y - camera.translateY, depth - camera.dolly, camera);
  return { x: qx / qz, y: qy / qz, depth: qz };
}

/** Exact local forward derivative, used to reject folds and size a mesh. */
export function curveJacobian(x: number, y: number, camera: CurveCamera, curvature: number): CurveJacobian {
  if (identity(camera)) return { xx: 1, xy: 0, yx: 0, yy: 1, det: 1 };
  const k = curvatureValue(curvature), radius = x * x + .65 * y * y, z = 1 + k * radius / (1 + radius);
  const zx = k * 2 * x / ((1 + radius) * (1 + radius)), zy = k * 1.3 * y / ((1 + radius) * (1 + radius));
  const q = rotate(z * x - camera.translateX, z * y - camera.translateY, z - camera.dolly, camera);
  const dx = rotate(z + x * zx, y * zx, zx, camera), dy = rotate(x * zy, z + y * zy, zy, camera);
  const squareDepth = q[2] * q[2];
  const xx = (dx[0] * q[2] - q[0] * dx[2]) / squareDepth, xy = (dy[0] * q[2] - q[0] * dy[2]) / squareDepth;
  const yx = (dx[1] * q[2] - q[1] * dx[2]) / squareDepth, yy = (dy[1] * q[2] - q[1] * dy[2]) / squareDepth;
  return { xx, xy, yx, yy, det: xx * yy - xy * yx };
}

/** Intersect the camera ray with the same radial-depth surface. The surface's
 * bounded z gives an initial bracket; safeguarded Newton uses eight fixed
 * iterations, identically to PERSPECTIVE_GLSL. Invalid rays return undefined.
 */
export function unprojectPoint(x: number, y: number, camera: CurveCamera, curvature: number): CurvePoint | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (identity(camera)) return { x, y };
  const sx = Math.sin(camera.pitch), cx = Math.cos(camera.pitch), sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw);
  // R transpose maps the capture ray back into the surface coordinate system.
  const rx = cy * x - sy, rz = sy * x + cy;
  const dx = rx, dy = cx * y + sx * rz, dz = -sx * y + cx * rz;
  if (!(dz > 1e-6)) return;
  const k = curvatureValue(curvature), minZ = Math.min(1, 1 + k), maxZ = Math.max(1, 1 + k);
  let lo = (minZ - camera.dolly) / dz, hi = (maxZ - camera.dolly) / dz;
  if (!(lo > 0) || !Number.isFinite(hi)) return;
  let lambda = clamp((1 - camera.dolly) / dz, lo, hi);
  for (let iteration = 0; iteration < 8; iteration++) {
    const px = camera.translateX + lambda * dx, py = camera.translateY + lambda * dy, pz = camera.dolly + lambda * dz;
    const u = px / pz, v = py / pz, radius = u * u + .65 * v * v;
    const error = pz - 1 - k * radius / (1 + radius);
    // A float32-compatible stop avoids bisecting away from an already
    // converged root when a GPU rounds the next lambda to this same value.
    if (Math.abs(error) <= 1e-7) break;
    if (error > 0) hi = lambda; else lo = lambda;
    const du = (dx * pz - px * dz) / (pz * pz), dv = (dy * pz - py * dz) / (pz * pz);
    const derivative = dz - k * (2 * u * du + 1.3 * v * dv) / ((1 + radius) * (1 + radius));
    const next = lambda - error / derivative;
    lambda = Number.isFinite(next) && next > lo && next < hi ? next : (lo + hi) * .5;
  }
  const pz = camera.dolly + lambda * dz;
  const point = { x: (camera.translateX + lambda * dx) / pz, y: (camera.translateY + lambda * dy) / pz };
  const check = projectPoint(point.x, point.y, camera, k);
  if (!(check.depth > 1e-6) || !Number.isFinite(check.x) || !Number.isFinite(check.y) || Math.max(Math.abs(check.x - x), Math.abs(check.y - y)) > 1e-6) return;
  return point;
}

/** Grid coverage and orientation check, including blur padding in source-plane
 * units. This is sampled evidence; callers should also bound cell error or
 * adaptively subdivide projected mesh cells before claiming full coverage.
 */
export function curveCoverage(viewport: CurveRect, camera: CurveCamera, curvature: number, source: CurveRect, padding = 0, steps = 12): boolean {
  const count = Math.max(2, Math.ceil(steps)), pad = Math.max(0, finite(padding));
  for (let row = 0; row <= count; row++) for (let col = 0; col <= count; col++) {
    const point = unprojectPoint(viewport.left + (viewport.right - viewport.left) * col / count, viewport.top + (viewport.bottom - viewport.top) * row / count, camera, curvature);
    if (!point || point.x < source.left + pad || point.x > source.right - pad || point.y < source.top + pad || point.y > source.bottom - pad) return false;
    const j = curveJacobian(point.x, point.y, camera, curvature);
    if (!Number.isFinite(j.det) || j.det <= 1e-6) return false;
  }
  return true;
}

/** Shared shader contract. pose = (yaw,pitch,dolly); translation = (tx,ty).
 * Return xy = source curve-plane coordinates, z = validity (1 or 0).
 * JavaScript and GLSL use the same surface, bracket and eight Newton steps.
 */
export const PERSPECTIVE_GLSL = `
vec3 curveUnproject(vec2 point,vec3 pose,vec2 translation,float curvature){
  if(all(equal(pose,vec3(0.)))&&all(equal(translation,vec2(0.))))return vec3(point,1.);
  float sx=sin(pose.y),cx=cos(pose.y),sy=sin(pose.x),cy=cos(pose.x);
  float rx=cy*point.x-sy,rz=sy*point.x+cy;
  vec3 d=vec3(rx,cx*point.y+sx*rz,-sx*point.y+cx*rz);
  if(d.z<=.000001)return vec3(0.);
  float k=clamp(curvature,-.45,1.5),lo=(min(1.,1.+k)-pose.z)/d.z,hi=(max(1.,1.+k)-pose.z)/d.z;
  if(lo<=0.)return vec3(0.);
  float lambda=clamp((1.-pose.z)/d.z,lo,hi);
  for(int iteration=0;iteration<8;iteration++){
    vec3 p=vec3(translation,pose.z)+lambda*d;
    vec2 uv=p.xy/p.z;
    float radius=uv.x*uv.x+.65*uv.y*uv.y;
    float error=p.z-1.-k*radius/(1.+radius);
    if(abs(error)<=.0000001)break;
    if(error>0.)hi=lambda;else lo=lambda;
    vec2 delta=(d.xy*p.z-p.xy*d.z)/(p.z*p.z);
    float derivative=d.z-k*(2.*uv.x*delta.x+1.3*uv.y*delta.y)/((1.+radius)*(1.+radius));
    float next=lambda-error/derivative;
    lambda=(next>lo&&next<hi)?next:(lo+hi)*.5;
  }
  vec3 p=vec3(translation,pose.z)+lambda*d;
  return vec3(p.xy/p.z,1.);
}`;
