export type Aspect = 'original' | '3:4' | '9:16';
export type ExportTarget = 'mp4' | 'gif' | 'android' | 'huawei' | 'apple';
export type SceneEffect = 'none' | 'steam' | 'candle' | 'depth';
export interface EffectParams {
  strength: number; rotation: number; zoomDirection: -1 | 0 | 1; zoomAmount: number;
  focus: number; fps: number; duration: number; margin: number; exposure: number;
  flash: boolean; aspect: Aspect; cropX: number; cropY: number; surprise: number;
  protectSubject: boolean;
  sceneEffect: SceneEffect; sceneAmount: number; sceneX: number; sceneY: number;
  sceneWidth: number; sceneHeight: number; sceneWind: number;
  backgroundBlur: number; motionBlur: number;
  perspective: number; curvature: number;
  cameraShake: number; parallax: number;
}
export interface MotionTake { seed: number; trajectoryId: string; mirrorX: -1 | 1; mirrorY: -1 | 1 }
export interface MotionFrame { x: number; y: number; rotation: number; zoom: number; blur: number; exposure: number }
export interface PhotoMetadata {
  make?: string; model?: string; lens?: string; capturedAt?: string; offsetTime?: string;
  iso?: number; exposureTime?: number; fNumber?: number; focalLength?: number;
  artist?: string; description?: string; copyright?: string;
  latitude?: number; longitude?: number; altitude?: number;
}
export interface AudioSettings { source: string; volume: number; muted: boolean; shutter: boolean }
export interface SubjectBounds { left: number; top: number; right: number; bottom: number }
export interface MediaAsset {
  file: File; kind: 'photo' | 'video'; name: string; width: number; height: number;
  duration: number; element: HTMLImageElement | HTMLVideoElement; poster: HTMLCanvasElement;
  originalMetadata: PhotoMetadata; hasAudio: boolean; url: string;
  subjectBounds?: SubjectBounds;
  depthLayers?: import('./depth').DepthLayers;
  depthPolygon?: Array<{ x: number; y: number }>;
  movingPolygons?: Array<Array<{ x: number; y: number }>>;
}
export interface ProjectState {
  asset: MediaAsset | null; params: EffectParams; take: MotionTake; metadata: PhotoMetadata;
  audio: AudioSettings; playing: boolean; exporting: boolean;
}
export const DEFAULT_PARAMS: EffectParams = {
  strength: 1.65, rotation: .12, zoomDirection: 1, zoomAmount: .012, focus: 1.1,
  fps: 30, duration: 3, margin: .05, exposure: .003, flash: false,
  aspect: 'original', cropX: .5, cropY: .5, surprise: .25,
  protectSubject: true,
  sceneEffect: 'depth', sceneAmount: .7, sceneX: .5, sceneY: .55,
  sceneWidth: .18, sceneHeight: .32, sceneWind: .1,
  backgroundBlur: 1.4, motionBlur: .85,
  perspective: .45, curvature: .3,
  cameraShake: .75, parallax: .4,
};
export const DEFAULT_AUDIO: AudioSettings = { source: 'none', volume: .45, muted: false, shutter: true };
