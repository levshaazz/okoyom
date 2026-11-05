import { decode } from 'fast-png';
import { MAP_MANIFEST, type HeightEncoding } from '../data/map-manifest';
import {
  applyCanopy,
  canopyDepthMaterial,
  createForestMesh,
  createRoadMesh,
  emptyMaskTexture,
  forestTexture,
  type CanopyUniforms,
} from './map-drape';
import {
  blurRect,
  isWater,
  liftMeters,
  normalizedToMeters,
  proceduralNormalized,
  resampleU16,
  sampleColor,
} from '../lib/map-height';
import { forestPlacements, redChannel, softenForestMask } from '../lib/map-forest';
import { ROAD_STYLE, buildRoadRibbon, traceMaskRoads, type MapRoad } from '../lib/map-roads';
import type { SceneLayers, SceneMarker, ScenePin, SceneRoute, SceneZone } from '../lib/map-view-model';
import * as THREE from 'three';

export type { SceneLayers, SceneMarker, ScenePin, SceneRoute, SceneZone };

export interface MapScene {
  resize(): void;
  setFog(mask: Float32Array, size: number): void;
  setMarkers(markers: SceneMarker[]): void;
  setPins(pins: ScenePin[]): void;
  setZones(zones: SceneZone[]): void;
  setRoutes(routes: SceneRoute[]): void;
  setLayers(layers: SceneLayers): void;
  setAlbedo(dataUrl: string | null): void;
  north(): void;
  zoom(factor: number): void;
  dispose(): void;
}

const MAP_W = 24;
const MAP_D = MAP_W * (MAP_MANIFEST.heightSpan / MAP_MANIFEST.widthSpan);

function lift(height01: number): number {
  return liftMeters(normalizedToMeters(height01), MAP_W);
}

/** Подменяется сеткой загруженного края. Пока файлы не прочитаны — процедурный запас. */
let sampleTerrain = proceduralNormalized;

function place(nx: number, ny: number, height?: number): THREE.Vector3 {
  const h = height ?? sampleTerrain(nx, ny);
  return new THREE.Vector3((nx - 0.5) * MAP_W, lift(h), (ny - 0.5) * MAP_D);
}

async function loadImage(url: string): Promise<ImageData | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(url));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

async function loadU16(url: string): Promise<{ data: Uint16Array; width: number; height: number } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const png = decode(new Uint8Array(await response.arrayBuffer()));
    if (png.depth !== 16) return null;
    const pixels = png.width * png.height;
    if (png.channels === 1 && png.data instanceof Uint16Array) {
      return { data: png.data, width: png.width, height: png.height };
    }
    const view =
      png.data instanceof Uint16Array
        ? png.data
        : new Uint16Array(png.data.buffer, png.data.byteOffset, Math.floor(png.data.byteLength / 2));
    const data = new Uint16Array(pixels);
    for (let i = 0; i < pixels; i++) data[i] = view[i * png.channels] ?? 0;
    return { data, width: png.width, height: png.height };
  } catch {
    return null;
  }
}

function packU16(src: Uint16Array, w: number, h: number): THREE.DataTexture {
  const bytes = new Uint8Array(w * h * 4);
  for (let i = 0; i < src.length; i++) {
    const v = src[i] ?? 0;
    bytes[i * 4] = (v >> 8) & 255;
    bytes[i * 4 + 1] = v & 255;
    bytes[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(bytes, w, h);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function smoothNormals(positions: Float32Array, segX: number, segY: number, stride: number): Float32Array {
  const gw = segX + 1;
  const gh = segY + 1;
  const normals = new Float32Array(gw * gh * 3);
  const at = (ix: number, iy: number) => {
    const i = (iy * gw + ix) * 3;
    return [positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0];
  };
  for (let iy = 0; iy < gh; iy++) {
    for (let ix = 0; ix < gw; ix++) {
      const l = at(Math.max(0, ix - stride), iy);
      const r = at(Math.min(segX, ix + stride), iy);
      const u = at(ix, Math.max(0, iy - stride));
      const d = at(ix, Math.min(segY, iy + stride));
      const ex = r[0]! - l[0]!;
      const ey = r[1]! - l[1]!;
      const ez = r[2]! - l[2]!;
      const sx = d[0]! - u[0]!;
      const sy = d[1]! - u[1]!;
      const sz = d[2]! - u[2]!;
      let nx = ey * sz - ez * sy;
      let ny = ez * sx - ex * sz;
      let nz = ex * sy - ey * sx;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      const o = (iy * gw + ix) * 3;
      normals[o] = nx / len;
      normals[o + 1] = ny / len;
      normals[o + 2] = nz / len;
    }
  }
  return normals;
}

function sampler(data: ImageData | null, encoding: HeightEncoding): ((nx: number, ny: number) => number) | null {
  if (!data) return null;
  return (nx, ny) => {
    const x = Math.min(data.width - 1, Math.max(0, Math.floor(nx * (data.width - 1))));
    const y = Math.min(data.height - 1, Math.max(0, Math.floor(ny * (data.height - 1))));
    const i = (y * data.width + x) * 4;
    const r = data.data[i] ?? 0;
    const g = data.data[i + 1] ?? 0;
    return encoding === 'rg16' ? (r * 256 + g) / 65535 : r / 255;
  };
}

function paintAlbedo(
  size: number,
  heightAt: (nx: number, ny: number) => number,
  waterAt: ((nx: number, ny: number) => boolean) | null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);
      const ny = y / (size - 1);
      const color = waterAt && waterAt(nx, ny) ? { r: 42, g: 96, b: 112 } : sampleColor(nx, ny);
      void heightAt;
      const i = (y * size + x) * 4;
      image.data[i] = color.r;
      image.data[i + 1] = color.g;
      image.data[i + 2] = color.b;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function paintWater(size: number, waterAt: (nx: number, ny: number) => boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = waterAt(x / (size - 1), y / (size - 1));
      const i = (y * size + x) * 4;
      image.data[i] = on ? 255 : 0;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export async function mountMapScene(
  canvas: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  mobile: boolean,
  hooks: { onMarker: (id: string) => void; onGround: (x: number, y: number) => void },
): Promise<MapScene> {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('webgl');

  const painted =
    MAP_MANIFEST.heightEncoding === 'u16' && MAP_MANIFEST.heightUrl ? await loadU16(MAP_MANIFEST.heightUrl) : null;
  const legacy =
    !painted && MAP_MANIFEST.heightUrl && MAP_MANIFEST.heightEncoding !== 'u16'
      ? await loadImage(MAP_MANIFEST.heightUrl)
      : null;
  const legacySample = sampler(legacy, MAP_MANIFEST.heightEncoding === 'u16' ? 'r8' : MAP_MANIFEST.heightEncoding);

  const segX = mobile ? 168 : 336;
  const segY = mobile ? 94 : 189;
  const gw = segX + 1;
  const gh = segY + 1;
  const waterW = 512;
  const waterH = 288;
  let meshH: Float32Array;
  let waterU16: Uint16Array;
  if (painted) {
    const meshRadius = Math.max(2, Math.round(painted.width / gw / 3));
    const raw = resampleU16(painted.data, painted.width, painted.height, gw, gh, 'avg', meshRadius);
    const asFloat = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) asFloat[i] = (raw[i] ?? 0) / 65535;
    meshH = blurRect(asFloat, gw, gh, 1);
    const waterRadius = Math.max(1, Math.ceil(painted.width / waterW / 2));
    waterU16 = resampleU16(painted.data, painted.width, painted.height, waterW, waterH, 'min', waterRadius);
  } else {
    meshH = new Float32Array(gw * gh);
    waterU16 = new Uint16Array(waterW * waterH);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const nx = x / segX;
        const ny = y / segY;
        meshH[y * gw + x] = legacySample ? legacySample(nx, ny) : proceduralNormalized(nx, ny);
      }
    }
    meshH = blurRect(meshH, gw, gh, 1);
    for (let y = 0; y < waterH; y++) {
      for (let x = 0; x < waterW; x++) {
        const nx = x / (waterW - 1);
        const ny = y / (waterH - 1);
        const h = legacySample ? legacySample(nx, ny) : proceduralNormalized(nx, ny);
        waterU16[y * waterW + x] = Math.round(Math.max(0, Math.min(1, h)) * 65535);
      }
    }
  }
  const heightAt = (nx: number, ny: number) => {
    const x = Math.min(segX, Math.max(0, nx * segX));
    const y = Math.min(segY, Math.max(0, ny * segY));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(segX, x0 + 1);
    const y1 = Math.min(segY, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const at = (yy: number, xx: number) => meshH[yy * gw + xx] ?? 0;
    const a = at(y0, x0) * (1 - tx) + at(y0, x1) * tx;
    const b = at(y1, x0) * (1 - tx) + at(y1, x1) * tx;
    return a * (1 - ty) + b * ty;
  };
  sampleTerrain = heightAt;

  const waterImage = MAP_MANIFEST.waterUrl ? await loadImage(MAP_MANIFEST.waterUrl) : null;
  const waterSample = sampler(waterImage, 'r8');
  const waterBool = (nx: number, ny: number) => {
    if (waterSample && waterSample(nx, ny) > 0.5) return true;
    if (painted) return normalizedToMeters(heightAt(nx, ny)) < MAP_MANIFEST.seaLevelM;
    return isWater(nx, ny) || normalizedToMeters(heightAt(nx, ny)) < MAP_MANIFEST.seaLevelM;
  };

  const forestImage = MAP_MANIFEST.forestUrl ? await loadImage(MAP_MANIFEST.forestUrl) : null;
  const forestMask = forestImage ? redChannel(forestImage.data) : null;
  const canopyW = 512;
  const canopyH = 288;
  const forestTex = forestMask
    ? forestTexture(softenForestMask(forestMask, forestImage!.width, forestImage!.height, canopyW, canopyH), canopyW, canopyH)
    : emptyMaskTexture();
  const treeCols = mobile ? 58 : 84;
  const treeRows = mobile ? 32 : 48;
  const canopyLift = mobile ? 0.14 : 0.2;
  const treeSpots = forestMask
    ? forestPlacements(forestMask, forestImage!.width, forestImage!.height, treeCols, treeRows, waterBool).map((spot) => {
        const world = place(spot.x, spot.y);
        return { ...spot, wx: world.x, wy: world.y + canopyLift * 0.72, wz: world.z };
      })
    : [];

  const texSize = mobile ? 384 : 640;
  const albedoCanvas = MAP_MANIFEST.albedoUrl ? null : paintAlbedo(texSize, heightAt, waterBool);
  const waterCanvas = waterImage ? null : paintWater(mobile ? 256 : 512, waterBool);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.6));
  renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor('#8d8474', 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#c9bea6', mobile ? 0.03 : 0.015);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.08, 140);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; void main(){
        float h = normalize(vP).y;
        vec3 top = vec3(0.42,0.50,0.58);
        vec3 hor = vec3(0.79,0.73,0.60);
        vec3 low = vec3(0.62,0.56,0.46);
        vec3 col = mix(low, hor, smoothstep(-0.15, 0.12, h));
        col = mix(col, top, smoothstep(0.05, 0.55, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
    }),
  );
  scene.add(sky);

  const hemi = new THREE.HemisphereLight('#d5e2ea', '#6a5438', 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d2', 2.6);
  sun.position.set(-14, 18, -6);
  sun.castShadow = !mobile;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 48;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);

  const positions = new Float32Array(gw * gh * 3);
  const uvs = new Float32Array(gw * gh * 2);
  const indices: number[] = [];
  for (let iy = 0; iy < gh; iy++) {
    for (let ix = 0; ix < gw; ix++) {
      const nx = ix / segX;
      const ny = iy / segY;
      const i = iy * gw + ix;
      const p = place(nx, ny, meshH[i] ?? 0);
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      uvs[i * 2] = nx;
      uvs[i * 2 + 1] = 1 - ny;
    }
  }
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * gw + ix;
      indices.push(a, a + gw, a + 1, a + 1, a + gw, a + gw + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.setAttribute('normal', new THREE.BufferAttribute(smoothNormals(positions, segX, segY, 2), 3));

  const albedoTex = new THREE.CanvasTexture(albedoCanvas ?? document.createElement('canvas'));
  albedoTex.colorSpace = THREE.SRGBColorSpace;
  albedoTex.anisotropy = mobile ? 2 : 8;
  albedoTex.wrapS = albedoTex.wrapT = THREE.ClampToEdgeWrapping;
  if (MAP_MANIFEST.albedoUrl) {
    const loaded = await new THREE.TextureLoader().loadAsync(MAP_MANIFEST.albedoUrl).catch(() => null);
    if (loaded) {
      loaded.colorSpace = THREE.SRGBColorSpace;
      albedoTex.dispose();
      Object.assign(albedoTex, loaded);
      albedoTex.anisotropy = mobile ? 2 : 8;
    } else if (albedoCanvas) {
      albedoTex.image = albedoCanvas;
      albedoTex.needsUpdate = true;
    }
  }
  const terrainMat = new THREE.MeshStandardMaterial({ map: albedoTex, roughness: 0.92, metalness: 0.02 });
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.castShadow = !mobile;
  terrain.receiveShadow = true;
  scene.add(terrain);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W * 6, MAP_D * 6),
    new THREE.MeshStandardMaterial({ color: '#16384c', roughness: 0.35, metalness: 0.08 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  const sea01 =
    (MAP_MANIFEST.seaLevelM - MAP_MANIFEST.heightMinM) /
    (MAP_MANIFEST.heightMaxM - MAP_MANIFEST.heightMinM || 1);
  ocean.position.y = lift(sea01) - 0.25;
  ocean.receiveShadow = true;
  scene.add(ocean);

  let waterTex: THREE.Texture;
  if (MAP_MANIFEST.waterUrl) {
    const loaded = await new THREE.TextureLoader().loadAsync(MAP_MANIFEST.waterUrl).catch(() => null);
    if (loaded) {
      loaded.colorSpace = THREE.NoColorSpace;
      loaded.wrapS = loaded.wrapT = THREE.ClampToEdgeWrapping;
      loaded.magFilter = THREE.LinearFilter;
      loaded.minFilter = THREE.LinearFilter;
      waterTex = loaded;
    } else {
      waterTex = new THREE.CanvasTexture(waterCanvas ?? paintWater(256, waterBool));
    }
  } else {
    waterTex = new THREE.CanvasTexture(waterCanvas ?? paintWater(256, waterBool));
  }
  waterTex.wrapS = waterTex.wrapT = THREE.ClampToEdgeWrapping;
  waterTex.colorSpace = THREE.NoColorSpace;
  const canopyUniforms: CanopyUniforms = {
    uForest: { value: forestTex },
    uWater: { value: waterTex },
    uForestOn: { value: 1 },
    uCanopy: { value: canopyLift },
  };
  applyCanopy(terrainMat, canopyUniforms);
  if (!mobile) terrain.customDepthMaterial = canopyDepthMaterial(canopyUniforms);
  const heightTex = packU16(waterU16, waterW, waterH);
  const sunDir = new THREE.Vector3(-0.4, 0.75, -0.35).normalize();
  const waterFrag = `uniform sampler2D uMask; uniform sampler2D uHeight; uniform vec3 uSun;
    uniform float uMin; uniform float uMax; uniform float uSea; uniform float uInland;
    varying vec2 vUv; varying vec3 vPos;
    void main(){
      float m = texture2D(uMask, vUv).r;
      vec4 enc = texture2D(uHeight, vUv);
      float v = floor(enc.r * 255.0 + 0.5) * 256.0 + floor(enc.g * 255.0 + 0.5);
      float meters = uMin + (v / 65535.0) * (uMax - uMin);
      bool painted = m >= 0.5;
      bool below = meters < uSea;
      if (uInland > 0.5) { if (!(painted && !below)) discard; }
      else if (!(painted || below)) discard;
      vec3 viewDir = normalize(cameraPosition - vPos);
      float fres = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 2.4);
      float spec = pow(max(dot(reflect(-uSun, vec3(0.0, 1.0, 0.0)), viewDir), 0.0), 48.0);
      vec3 col = mix(vec3(0.10, 0.28, 0.34), vec3(0.62, 0.78, 0.78), fres);
      col += spec * vec3(1.0, 0.95, 0.85) * 0.45;
      gl_FragColor = vec4(col, 0.28 + fres * 0.4);
    }`;
  const waterUniforms = () => ({
    uTime: { value: 0 },
    uMask: { value: waterTex },
    uHeight: { value: heightTex },
    uSun: { value: sunDir },
    uMin: { value: MAP_MANIFEST.heightMinM },
    uMax: { value: MAP_MANIFEST.heightMaxM },
    uSea: { value: MAP_MANIFEST.seaLevelM },
    uInland: { value: 0 },
  });
  const seaMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: waterUniforms(),
    vertexShader: `uniform float uTime; varying vec2 vUv; varying vec3 vPos;
      void main(){
        vUv = uv;
        vec3 p = position;
        p.z += sin(position.x * 1.7 + uTime * 1.4) * 0.004 + sin(position.y * 1.3 - uTime) * 0.003;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vPos = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: waterFrag,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_D, 1, 1), seaMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = lift(sea01) + 0.004;
  water.renderOrder = 2;
  scene.add(water);
  const inlandPos = positions.slice();
  for (let i = 1; i < inlandPos.length; i += 3) inlandPos[i] += 0.004;
  const inlandGeo = new THREE.BufferGeometry();
  inlandGeo.setAttribute('position', new THREE.BufferAttribute(inlandPos, 3));
  inlandGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  inlandGeo.setIndex(indices);
  const inlandMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: waterUniforms(),
    vertexShader: `uniform float uTime; varying vec2 vUv; varying vec3 vPos;
      void main(){
        vUv = uv;
        vec3 p = position;
        p.y += sin(p.x * 1.7 + uTime * 1.4) * 0.004 + sin(p.z * 1.3 - uTime) * 0.003;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vPos = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: waterFrag,
  });
  inlandMat.uniforms.uInland!.value = 1;
  const inland = new THREE.Mesh(inlandGeo, inlandMat);
  inland.renderOrder = 2;
  scene.add(inland);

  let fogSize = 2;
  let fogBytes = new Uint8Array(16);
  fogBytes.fill(255);
  let fogTex = new THREE.DataTexture(fogBytes, fogSize, fogSize);
  fogTex.magFilter = THREE.LinearFilter;
  fogTex.minFilter = THREE.LinearFilter;
  fogTex.wrapS = fogTex.wrapT = THREE.ClampToEdgeWrapping;
  fogTex.flipY = false;
  fogTex.needsUpdate = true;
  const fogMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMask: { value: fogTex },
      uTime: { value: 0 },
      uOpacity: { value: 0.92 },
      uForest: canopyUniforms.uForest,
      uWater: canopyUniforms.uWater,
      uForestOn: canopyUniforms.uForestOn,
      uCanopy: canopyUniforms.uCanopy,
    },
    vertexShader: `uniform float uTime; uniform sampler2D uForest; uniform sampler2D uWater; uniform float uForestOn; uniform float uCanopy;
      varying vec2 vUv; varying float vH;
      void main(){
        vUv = uv;
        vec3 p = position;
        float forestMask = texture2D(uForest, uv).r;
        float wet = texture2D(uWater, uv).r;
        forestMask *= 1.0 - smoothstep(0.42, 0.72, wet);
        p.y += forestMask * uForestOn * uCanopy;
        float n = sin(p.x * 0.45 + uTime * 0.35) * cos(p.z * 0.4 - uTime * 0.22);
        p.y += 0.05 + n * 0.04;
        vH = n;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform sampler2D uMask; uniform float uTime; uniform float uOpacity; varying vec2 vUv; varying float vH;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        float a = hash(i); float b = hash(i+vec2(1.0,0.0)); float c = hash(i+vec2(0.0,1.0)); float d = hash(i+vec2(1.0,1.0));
        return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
      }
      void main(){
        float hidden = texture2D(uMask, vec2(vUv.x, 1.0 - vUv.y)).r;
        float n = noise(vUv * 7.0 + vec2(uTime * 0.05, uTime * 0.03));
        n += 0.5 * noise(vUv * 15.0 - vec2(uTime * 0.04, 0.0));
        float puff = smoothstep(0.25, 0.85, n);
        float alpha = smoothstep(0.12, 0.55, hidden) * (0.62 + 0.38 * puff) * uOpacity;
        vec3 col = mix(vec3(0.62,0.66,0.70), vec3(0.90,0.91,0.88), puff + vH * 0.15);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const fogShell = new THREE.Mesh(geo, fogMat);
  fogShell.frustumCulled = false;
  fogShell.renderOrder = 4;
  scene.add(fogShell);

  const roadsImage = MAP_MANIFEST.roadsUrl ? await loadImage(MAP_MANIFEST.roadsUrl) : null;
  let mapRoads: MapRoad[] = MAP_MANIFEST.roads.map((road) => ({
    ...road,
    points: road.points.map((point) => ({ x: point.x, y: point.y })),
  }));
  if (roadsImage) {
    mapRoads = mapRoads.concat(traceMaskRoads(redChannel(roadsImage.data), roadsImage.width, roadsImage.height));
  }
  const seaY = lift(sea01);
  const forestCover = (nx: number, ny: number) => {
    if (!forestMask || !forestImage || waterBool(nx, ny)) return 0;
    const x = Math.min(forestImage.width - 1, Math.max(0, Math.floor(nx * (forestImage.width - 1))));
    const y = Math.min(forestImage.height - 1, Math.max(0, Math.floor(ny * (forestImage.height - 1))));
    return (forestMask[y * forestImage.width + x] ?? 0) / 255;
  };
  const ribbon = buildRoadRibbon(mapRoads, (point, tier) => {
    const world = place(point.x, point.y);
    const canopy = forestCover(point.x, point.y) * canopyLift;
    let y = world.y + canopy + 0.045;
    if (tier === 'sail') y = Math.max(world.y, seaY) + 0.06;
    else if (waterBool(point.x, point.y)) y = Math.max(world.y, seaY) + 0.04;
    return { x: world.x, y, z: world.z };
  });
  const forest = createForestMesh(
    treeSpots,
    mobile ? { near: 4.2, far: 8.5, hide: 12 } : { near: 6.5, far: 14, hide: 22 },
    fogTex,
  );
  if (forest) scene.add(forest.mesh);
  const roads = createRoadMesh(ribbon, fogTex);
  if (roads) scene.add(roads.mesh);

  const zoneGroup = new THREE.Group();
  const routeGroup = new THREE.Group();
  scene.add(zoneGroup);
  scene.add(routeGroup);

  const overlayCtx = overlay.getContext('2d');
  let markers: SceneMarker[] = [];
  let pins: ScenePin[] = [];
  let layers: SceneLayers = {
    places: true,
    threats: true,
    rumors: true,
    pins: true,
    routes: true,
    party: false,
    endonym: true,
    translation: true,
    forests: true,
    roads: true,
  };
  let fogTarget = new Float32Array(4).fill(1);
  let fogShown = fogTarget.slice();
  let yaw = 0.22;
  let pitch = 0.72;
  let dist = mobile ? 14 : 12.5;
  let tx = (0.46 - 0.5) * MAP_W;
  let tz = (0.58 - 0.5) * MAP_D;
  let vYaw = 0;
  let vPitch = 0;
  let vDist = 0;
  let vX = 0;
  let vZ = 0;
  let northAnim: number | null = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected: { id: string; sx: number; sy: number }[] = [];
  let alive = true;
  let frame = 0;

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    overlay.width = Math.floor(w * Math.min(window.devicePixelRatio || 1, 2));
    overlay.height = Math.floor(h * Math.min(window.devicePixelRatio || 1, 2));
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();

  function clampTarget() {
    const limitX = MAP_W * 0.46;
    const limitZ = MAP_D * 0.46;
    tx = Math.max(-limitX, Math.min(limitX, tx));
    tz = Math.max(-limitZ, Math.min(limitZ, tz));
  }

  function applyCamera() {
    pitch = Math.max(0.42, Math.min(1.22, pitch));
    dist = Math.max(mobile ? 7 : 5.5, Math.min(34, dist));
    clampTarget();
    const elev = pitch;
    camera.position.set(
      tx + Math.cos(elev) * Math.sin(yaw) * dist,
      Math.max(0, lift(sampleTerrain(tx / MAP_W + 0.5, tz / MAP_D + 0.5))) + Math.sin(elev) * dist,
      tz + Math.cos(elev) * Math.cos(yaw) * dist,
    );
    camera.lookAt(tx, 0.2, tz);
    const span = 12 + dist * 0.35;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(tx - 10, 16, tz - 6);
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    sun.shadow.camera.updateProjectionMatrix();
    sky.position.copy(camera.position);
  }

  function drawLabels() {
    if (!overlayCtx) return;
    const w = overlay.width;
    const h = overlay.height;
    overlayCtx.clearRect(0, 0, w, h);
    overlayCtx.textAlign = 'center';
    projected.length = 0;
    const drawText = (nx: number, ny: number, primary: string, secondary: string | null, rumor: boolean, id?: string) => {
      const p = place(nx, ny).add(new THREE.Vector3(0, 0.35, 0));
      p.project(camera);
      if (p.z > 1) return;
      const sx = (p.x * 0.5 + 0.5) * w;
      const sy = (-p.y * 0.5 + 0.5) * h;
      if (id) projected.push({ id, sx: (sx / w) * canvas.clientWidth, sy: (sy / h) * canvas.clientHeight });
      const distCam = camera.position.distanceTo(place(nx, ny));
      const size = Math.max(13, Math.min(30, 420 / distCam)) * (w / (canvas.clientWidth || w));
      overlayCtx.save();
      overlayCtx.translate(sx, sy);
      overlayCtx.shadowColor = 'rgba(0,0,0,0.85)';
      overlayCtx.shadowBlur = 6;
      overlayCtx.fillStyle = rumor ? '#9db3c9' : '#f6efdc';
      overlayCtx.font = `${rumor ? 'italic ' : ''}600 ${size}px "Cormorant SC", serif`;
      if (layers.endonym || !secondary) overlayCtx.fillText(primary, 0, -8);
      if (secondary && layers.translation) {
        overlayCtx.fillStyle = rumor ? '#b7c6d4' : '#e4d8bc';
        overlayCtx.font = `${Math.max(11, size * 0.48)}px "EB Garamond", serif`;
        overlayCtx.fillText(secondary, 0, size * 0.42);
      }
      overlayCtx.restore();
    };
    if (layers.places) {
      for (const marker of markers) {
        if (marker.rumor && !layers.rumors) continue;
        if (!marker.rumor && marker.primary === '?' && !layers.rumors) continue;
        const primary = layers.endonym || !marker.secondary ? marker.primary : marker.secondary;
        const secondary = layers.endonym && layers.translation ? marker.secondary : layers.translation ? marker.primary : null;
        drawText(marker.x, marker.y, primary, marker.secondary ? secondary : null, marker.rumor, marker.id);
      }
    }
    if (layers.pins) {
      for (const pin of pins) {
        if (pin.shared && !layers.party) continue;
        if (!pin.shared && !layers.pins) continue;
        drawText(pin.x, pin.y, pin.label, null, !pin.shared);
      }
    }
    if (layers.roads) {
      for (const road of mapRoads) {
        if (!road.label) continue;
        const mid = road.points[Math.floor((road.points.length - 1) / 2)];
        if (!mid) continue;
        const anchor = place(mid.x, mid.y);
        const p = anchor.clone().project(camera);
        if (p.z > 1) continue;
        const distCam = camera.position.distanceTo(anchor);
        if (distCam > 24) continue;
        const sx = (p.x * 0.5 + 0.5) * w;
        const sy = (-p.y * 0.5 + 0.5) * h;
        const size = Math.max(11, Math.min(18, 260 / distCam)) * (w / (canvas.clientWidth || w));
        overlayCtx.save();
        overlayCtx.translate(sx, sy);
        overlayCtx.shadowColor = 'rgba(0,0,0,0.8)';
        overlayCtx.shadowBlur = 4;
        overlayCtx.fillStyle = ROAD_STYLE[road.tier].color;
        overlayCtx.font = `600 ${size}px "Alegreya SC", serif`;
        overlayCtx.textAlign = 'center';
        overlayCtx.fillText(road.label, 0, size * 0.9);
        overlayCtx.restore();
      }
    }
    const cx = w - 78 * (w / (canvas.clientWidth || w));
    const cy = h - 78 * (h / (canvas.clientHeight || h));
    overlayCtx.save();
    overlayCtx.translate(cx, cy);
    overlayCtx.rotate(-yaw);
    overlayCtx.strokeStyle = 'rgba(243,238,227,0.8)';
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.arc(0, 0, 28, 0, Math.PI * 2);
    overlayCtx.moveTo(0, 8);
    overlayCtx.lineTo(0, -22);
    overlayCtx.stroke();
    overlayCtx.fillStyle = '#f3eee3';
    overlayCtx.font = '14px "Alegreya SC", serif';
    overlayCtx.textAlign = 'center';
    overlayCtx.fillText('С', 0, -26);
    overlayCtx.restore();
    const verst = MAP_MANIFEST.widthSpan / MAP_W;
    const pxPerUnit = (w / (canvas.clientWidth || w)) * (canvas.clientWidth / (2 * Math.tan((camera.fov * Math.PI) / 360) * dist));
    const barUnits = 5 / verst;
    const bar = Math.max(40, Math.min(160, barUnits * pxPerUnit * 0.15));
    overlayCtx.strokeStyle = '#e7e1d2';
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(28, h - 28);
    overlayCtx.lineTo(28 + bar, h - 28);
    overlayCtx.stroke();
    overlayCtx.fillStyle = '#e7e1d2';
    overlayCtx.font = '13px "EB Garamond", serif';
    overlayCtx.textAlign = 'left';
    overlayCtx.fillText(`5 ${MAP_MANIFEST.spanUnit}`, 28, h - 36);
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'pan' | 'orbit' | 'pinch' = 'pan';
  let lastX = 0;
  let lastY = 0;
  let lastDist = 0;
  let lastAngle = 0;
  let moved = 0;

  function onDown(event: PointerEvent) {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      lastDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      lastAngle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
      mode = 'pinch';
      return;
    }
    mode = event.button === 2 ? 'orbit' : 'pan';
  }
  function onMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = event.clientX;
    lastY = event.clientY;
    if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distNow = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (lastDist > 0) {
        const factor = lastDist / distNow;
        dist *= Math.pow(factor, 0.65);
        const ang = Math.atan2(b!.y - a!.y, b!.x - a!.x);
        yaw -= ang - lastAngle;
        lastAngle = ang;
      }
      lastDist = distNow;
      pitch = Math.max(0.42, Math.min(1.22, pitch - dy * 0.002));
      return;
    }
    if (mode === 'orbit') {
      vYaw -= dx * 0.003;
      vPitch -= dy * 0.002;
      yaw -= dx * 0.005;
      pitch -= dy * 0.004;
      return;
    }
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const scale = dist * 0.0022;
    const mx = (dx * rightX + dy * fwdX) * scale;
    const mz = (dx * rightZ + dy * fwdZ) * scale;
    tx -= mx;
    tz -= mz;
    vX = -mx;
    vZ = -mz;
  }
  function onUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (pointers.size === 0 && moved < 7) {
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const hit = projected.find((row) => Math.hypot(row.sx - sx, row.sy - sy) < 36);
      if (hit) hooks.onMarker(hit.id);
      else {
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const found = raycaster.intersectObject(terrain)[0];
        if (found?.uv) hooks.onGround(found.uv.x, 1 - found.uv.y);
      }
    }
    if (pointers.size < 2) mode = 'pan';
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const blockMenu = (event: Event) => event.preventDefault();
  canvas.addEventListener('contextmenu', blockMenu);
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    dist *= Math.exp(event.deltaY * 0.0011);
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });

  let raf = 0;
  const loop = () => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const t = performance.now() / 1000;
    (water.material as THREE.ShaderMaterial).uniforms.uTime!.value = t;
    inlandMat.uniforms.uTime!.value = t;
    fogMat.uniforms.uTime!.value = t;
    if (northAnim !== null) {
      yaw += (northAnim - yaw) * 0.12;
      if (Math.abs(northAnim - yaw) < 0.01) {
        yaw = northAnim;
        northAnim = null;
      }
    } else {
      yaw += vYaw;
      pitch += vPitch;
      tx += vX;
      tz += vZ;
      dist += vDist;
      vYaw *= 0.9;
      vPitch *= 0.9;
      vX *= 0.9;
      vZ *= 0.9;
      vDist *= 0.88;
    }
    if (fogShown.length === fogTarget.length && fogBytes.length === fogShown.length * 4) {
      let changed = false;
      for (let i = 0; i < fogShown.length; i++) {
        const next = (fogShown[i] ?? 0) + ((fogTarget[i] ?? 0) - (fogShown[i] ?? 0)) * 0.08;
        if (Math.abs(next - (fogShown[i] ?? 0)) > 0.004) changed = true;
        fogShown[i] = next;
        const byte = Math.max(0, Math.min(255, Math.round(next * 255)));
        fogBytes[i * 4] = byte;
        fogBytes[i * 4 + 1] = byte;
        fogBytes[i * 4 + 2] = byte;
        fogBytes[i * 4 + 3] = 255;
      }
      if (changed) fogTex.needsUpdate = true;
    }
    if (roads) {
      roads.fov.value = (camera.fov * Math.PI) / 180;
      roads.resolution.value.set(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
    }
    applyCamera();
    renderer.render(scene, camera);
    if (frame++ % 1 === 0) drawLabels();
  };
  loop();

  return {
    resize,
    setFog(mask, size) {
      fogTarget = new Float32Array(mask);
      if (size !== fogSize || fogShown.length !== mask.length) {
        fogSize = size;
        fogShown = mask.slice();
        fogBytes = new Uint8Array(mask.length * 4);
        for (let i = 0; i < mask.length; i++) {
          const byte = Math.round((mask[i] ?? 0) * 255);
          fogBytes[i * 4] = byte;
          fogBytes[i * 4 + 1] = byte;
          fogBytes[i * 4 + 2] = byte;
          fogBytes[i * 4 + 3] = 255;
        }
        fogTex.dispose();
        fogTex = new THREE.DataTexture(fogBytes, size, size);
        fogTex.magFilter = THREE.LinearFilter;
        fogTex.minFilter = THREE.LinearFilter;
        fogTex.wrapS = fogTex.wrapT = THREE.ClampToEdgeWrapping;
        fogTex.flipY = false;
        fogTex.needsUpdate = true;
        fogMat.uniforms.uMask!.value = fogTex;
        if (forest) forest.fog.value = fogTex;
        if (roads) roads.fog.value = fogTex;
      }
    },
    setMarkers(next) {
      markers = next;
    },
    setPins(next) {
      pins = next;
    },
    setLayers(next) {
      layers = next;
      zoneGroup.visible = next.threats;
      routeGroup.visible = next.routes;
      canopyUniforms.uForestOn.value = next.forests ? 1 : 0;
      if (forest) forest.mesh.visible = next.forests;
      if (roads) roads.mesh.visible = next.roads;
    },
    setZones(zones) {
      zoneGroup.clear();
      const colors = { low: '#7fb27a', mid: '#e3c565', high: '#c4453b' };
      for (const zone of zones) {
        const mesh = new THREE.Mesh(
          new THREE.CircleGeometry(zone.radius * MAP_W, 40),
          new THREE.MeshBasicMaterial({ color: colors[zone.tone], transparent: true, opacity: 0.22, depthWrite: false }),
        );
        const p = place(zone.x, zone.y);
        mesh.position.set(p.x, p.y + 0.08, p.z);
        mesh.rotation.x = -Math.PI / 2;
        zoneGroup.add(mesh);
      }
    },
    setRoutes(routes) {
      routeGroup.clear();
      for (const route of routes) {
        if (route.points.length < 2) continue;
        const pts = route.points.map((point) => place(point.x, point.y).setY(place(point.x, point.y).y + 0.12));
        const geoLine = new THREE.BufferGeometry().setFromPoints(pts);
        routeGroup.add(new THREE.Line(geoLine, new THREE.LineBasicMaterial({ color: '#e3c565' })));
      }
    },
    setAlbedo(dataUrl) {
      if (!dataUrl) {
        if (albedoCanvas) {
          albedoTex.image = albedoCanvas;
          albedoTex.needsUpdate = true;
        }
        return;
      }
      const img = new Image();
      img.onload = () => {
        albedoTex.image = img;
        albedoTex.needsUpdate = true;
      };
      img.src = dataUrl;
    },
    north() {
      northAnim = 0;
      vYaw = 0;
    },
    zoom(factor: number) {
      dist *= factor;
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('contextmenu', blockMenu);
      canvas.removeEventListener('wheel', onWheel);
      renderer.dispose();
      geo.dispose();
      inlandGeo.dispose();
      albedoTex.dispose();
      waterTex.dispose();
      heightTex.dispose();
      fogTex.dispose();
      forestTex.dispose();
      if (forest) {
        forest.mesh.geometry.dispose();
        (forest.mesh.material as THREE.Material).dispose();
      }
      if (roads) {
        roads.mesh.geometry.dispose();
        (roads.mesh.material as THREE.Material).dispose();
      }
      const depth = terrain.customDepthMaterial;
      if (depth && !Array.isArray(depth)) depth.dispose();
    },
  };
}

export function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
