import type { Geometry } from './geometry';
import type { MotionFrame } from './types';
import { projectPoint, unprojectPoint, type CurveCamera } from './perspective';

interface Point { x: number; y: number }
export interface PerspectiveVertex { output: Point; source: Point }
export interface PerspectiveCanvasMesh {
  triangles: Array<[PerspectiveVertex, PerspectiveVertex, PerspectiveVertex]>;
  maxError: number;
  maxDepth: number;
  sampledPoints: number;
}

/** Tessellate output with cached shared rays. Edge, diagonal and centroid probes
 * bound sampled affine geometric error to a quarter output pixel. */
export function createPerspectiveCanvasMesh(geometry: Geometry, camera: CurveCamera, curvature: number, inverse: number[], imageWidth = geometry.sourceWidth, imageHeight = geometry.sourceHeight, tolerance = .25): PerspectiveCanvasMesh {
  const g = geometry, unit = Math.min(g.sourceWidth, g.sourceHeight), columns = Math.max(2, Math.min(24, Math.ceil(g.width / 144))), rows = Math.max(2, Math.min(24, Math.ceil(g.height / 144)));
  const cache = new Map<string, PerspectiveVertex>(), triangles: PerspectiveCanvasMesh['triangles'] = [];
  const map = (x: number, y: number): PerspectiveVertex => {
    const key = `${x}/${y}`, previous = cache.get(key); if (previous) return previous;
    const sx = inverse[0] * x + inverse[3] * y + inverse[6], sy = inverse[1] * x + inverse[4] * y + inverse[7];
    const point = unprojectPoint((sx - g.centerX) / unit, (sy - g.centerY) / unit, camera, curvature);
    if (!point) throw new Error('透视幅度超出可用范围，请减小空间透视');
    const vertex = { output: { x, y }, source: { x: (point.x * unit + g.centerX) * imageWidth / g.sourceWidth, y: (point.y * unit + g.centerY) * imageHeight / g.sourceHeight } };
    cache.set(key, vertex); return vertex;
  };
  // Invert the affine output->camera-plane transform once for all error probes.
  const affineDet = inverse[0] * inverse[4] - inverse[3] * inverse[1];
  if (Math.abs(affineDet) < 1e-12) throw new Error('透视构图变换不可逆');
  const project = (source: Point): Point => {
    const x = source.x * g.sourceWidth / imageWidth, y = source.y * g.sourceHeight / imageHeight;
    const p = projectPoint((x - g.centerX) / unit, (y - g.centerY) / unit, camera, curvature);
    const px = p.x * unit + g.centerX - inverse[6], py = p.y * unit + g.centerY - inverse[7];
    return { x: (inverse[4] * px - inverse[3] * py) / affineDet, y: (-inverse[1] * px + inverse[0] * py) / affineDet };
  };
  const tileError = (a: PerspectiveVertex, b: PerspectiveVertex, c: PerspectiveVertex, d: PerspectiveVertex): number => {
    let error = 0;
    for (const [u, v] of [[.5, 0], [1, .5], [.5, 1], [0, .5], [.5, .5], [2 / 3, 1 / 3], [1 / 3, 2 / 3]]) {
      let source: Point;
      if (v <= u) source = { x: a.source.x * (1 - u) + b.source.x * (u - v) + d.source.x * v, y: a.source.y * (1 - u) + b.source.y * (u - v) + d.source.y * v };
      else source = { x: a.source.x * (1 - v) + d.source.x * u + c.source.x * (v - u), y: a.source.y * (1 - v) + d.source.y * u + c.source.y * (v - u) };
      const projected = project(source), x = a.output.x + (d.output.x - a.output.x) * u, y = a.output.y + (d.output.y - a.output.y) * v;
      error = Math.max(error, Math.hypot(projected.x - x, projected.y - y));
    }
    return error;
  };
  let maxError = 0, maxDepth = 0;
  const cell = (x0: number, y0: number, x1: number, y1: number, depth: number) => {
    const a = map(x0, y0), b = map(x1, y0), c = map(x0, y1), d = map(x1, y1), error = tileError(a, b, c, d);
    if (error > tolerance && depth < 3) {
      const mx = (x0 + x1) * .5, my = (y0 + y1) * .5;
      cell(x0, y0, mx, my, depth + 1); cell(mx, y0, x1, my, depth + 1); cell(x0, my, mx, y1, depth + 1); cell(mx, my, x1, y1, depth + 1); return;
    }
    if (error > tolerance + 1e-6) throw new Error('透视网格超过可用精度，请减小空间透视');
    maxError = Math.max(maxError, error); maxDepth = Math.max(maxDepth, depth);
    triangles.push([a, b, d], [a, d, c]);
  };
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) cell(col * g.width / columns, row * g.height / rows, (col + 1) * g.width / columns, (row + 1) * g.height / rows, 0);
  return { triangles, maxError, maxDepth, sampledPoints: cache.size };
}

/** Draw the same inverse camera rays as WebGL. Foreground and its protection
 * mask share the common camera outside this background mesh. */
export function drawPerspectiveCanvas(context: CanvasRenderingContext2D, image: HTMLCanvasElement, geometry: Geometry, _frame: MotionFrame, camera: CurveCamera, curvature: number, inverse: number[]) {
  const mesh = createPerspectiveCanvasMesh(geometry, camera, curvature, inverse, image.width, image.height);
  const triangle = (a: PerspectiveVertex, b: PerspectiveVertex, c: PerspectiveVertex) => {
    const x1 = b.source.x - a.source.x, y1 = b.source.y - a.source.y, x2 = c.source.x - a.source.x, y2 = c.source.y - a.source.y, det = x1 * y2 - x2 * y1;
    if (Math.abs(det) < 1e-10) return;
    const u1 = b.output.x - a.output.x, v1 = b.output.y - a.output.y, u2 = c.output.x - a.output.x, v2 = c.output.y - a.output.y;
    const aa = (u1 * y2 - u2 * y1) / det, bb = (v1 * y2 - v2 * y1) / det, cc = (u2 * x1 - u1 * x2) / det, dd = (v2 * x1 - v1 * x2) / det;
    // Offset each edge by a full output-pixel distance. Expanding vertices
    // radially from the centroid leaves a much smaller normal overlap on long
    // diagonals, where clip antialiasing can otherwise reveal the lower layer.
    const winding = Math.sign(u1 * v2 - v1 * u2);
    const expand = (previous: Point, p: Point, next: Point): Point => {
      const ax = p.x - previous.x, ay = p.y - previous.y, al = Math.hypot(ax, ay);
      const bx = next.x - p.x, by = next.y - p.y, bl = Math.hypot(bx, by);
      const n1 = { x: winding * ay / al, y: -winding * ax / al };
      const n2 = { x: winding * by / bl, y: -winding * bx / bl };
      const gain = .8 / Math.max(1e-6, 1 + n1.x * n2.x + n1.y * n2.y);
      return { x: p.x + (n1.x + n2.x) * gain, y: p.y + (n1.y + n2.y) * gain };
    };
    const pa = expand(c.output, a.output, b.output), pb = expand(a.output, b.output, c.output), pc = expand(b.output, c.output, a.output);
    context.save(); context.beginPath(); context.moveTo(pa.x, pa.y); context.lineTo(pb.x, pb.y); context.lineTo(pc.x, pc.y); context.closePath(); context.clip();
    context.transform(aa, bb, cc, dd, a.output.x - aa * a.source.x - cc * a.source.y, a.output.y - bb * a.source.x - dd * a.source.y);
    // Rasterize only this triangle's nearby source texels. Drawing the complete
    // photo under hundreds of tiny clips makes software Canvas scale the same
    // large bitmap repeatedly. Include the expanded clip and a bilinear guard
    // so cropping changes work size, without changing the affine mapping.
    const sourceAt = (p: Point): Point => {
      const x = p.x - a.output.x, y = p.y - a.output.y;
      return { x: a.source.x + (dd * x - cc * y) / (aa * dd - bb * cc), y: a.source.y + (-bb * x + aa * y) / (aa * dd - bb * cc) };
    };
    const sa = sourceAt(pa), sb = sourceAt(pb), sc = sourceAt(pc);
    const left = Math.max(0, Math.floor(Math.min(sa.x, sb.x, sc.x)) - 2), top = Math.max(0, Math.floor(Math.min(sa.y, sb.y, sc.y)) - 2);
    const right = Math.min(image.width, Math.ceil(Math.max(sa.x, sb.x, sc.x)) + 2), bottom = Math.min(image.height, Math.ceil(Math.max(sa.y, sb.y, sc.y)) + 2);
    if (right > left && bottom > top) context.drawImage(image, left, top, right - left, bottom - top, left, top, right - left, bottom - top);
    context.restore();
  };
  for (const [a, b, c] of mesh.triangles) triangle(a, b, c);
  return mesh;
}
