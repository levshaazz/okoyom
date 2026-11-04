import { MAP_MANIFEST, type HeightEncoding } from '../data/map-manifest';
import { isWater, sampleColor, sampleHeight } from '../lib/map-height';
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
const MAP_D = MAP_W * (MAP_MANIFEST.heightVersts / MAP_MANIFEST.widthVersts);

function lift(height: number): number {
  const amp = Math.min(MAP_W, MAP_D) * MAP_MANIFEST.heightScale;
  return (height - MAP_MANIFEST.seaLevel) * amp;
}

function place(nx: number, ny: number, height?: number): THREE.Vector3 {
  const h = height ?? sampleHeight(nx, ny);
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

  const heightImage = MAP_MANIFEST.heightUrl ? await loadImage(MAP_MANIFEST.heightUrl) : null;
  const heightAt = sampler(heightImage, MAP_MANIFEST.heightEncoding) ?? sampleHeight;
  const waterImage = MAP_MANIFEST.waterUrl ? await loadImage(MAP_MANIFEST.waterUrl) : null;
  const waterAt =
    sampler(waterImage, 'r8') ??
    ((nx: number, ny: number) => (heightImage ? heightAt(nx, ny) < MAP_MANIFEST.seaLevel : isWater(nx, ny)) ? 1 : 0);
  const waterBool = (nx: number, ny: number) => waterAt(nx, ny) > 0.5;

  const seg = mobile ? 104 : 220;
  const texSize = mobile ? 384 : 640;
  const albedoCanvas = MAP_MANIFEST.albedoUrl
    ? null
    : paintAlbedo(texSize, heightAt, waterBool);
  const waterCanvas = paintWater(mobile ? 256 : 512, waterBool);

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
  const camera = new THREE.PerspectiveCamera(38, 1, 0.08, 80);

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

  const n = seg + 1;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const indices: number[] = [];
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const nx = ix / seg;
      const ny = iy / seg;
      const i = iy * n + ix;
      const p = place(nx, ny, heightAt(nx, ny));
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      uvs[i * 2] = nx;
      uvs[i * 2 + 1] = 1 - ny;
    }
  }
  for (let iy = 0; iy < seg; iy++) {
    for (let ix = 0; ix < seg; ix++) {
      const a = iy * n + ix;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const albedoTex = new THREE.CanvasTexture(albedoCanvas ?? document.createElement('canvas'));
  albedoTex.colorSpace = THREE.SRGBColorSpace;
  albedoTex.anisotropy = 4;
  albedoTex.wrapS = albedoTex.wrapT = THREE.ClampToEdgeWrapping;
  if (MAP_MANIFEST.albedoUrl) {
    const loaded = await new THREE.TextureLoader().loadAsync(MAP_MANIFEST.albedoUrl).catch(() => null);
    if (loaded) {
      loaded.colorSpace = THREE.SRGBColorSpace;
      albedoTex.dispose();
      Object.assign(albedoTex, loaded);
    } else if (albedoCanvas) {
      albedoTex.image = albedoCanvas;
      albedoTex.needsUpdate = true;
    }
  }
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: albedoTex, roughness: 0.92, metalness: 0.02 }),
  );
  terrain.castShadow = !mobile;
  terrain.receiveShadow = true;
  scene.add(terrain);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W * 6, MAP_D * 6),
    new THREE.MeshStandardMaterial({ color: '#16384c', roughness: 0.35, metalness: 0.08 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = lift(0) - 0.2;
  ocean.receiveShadow = true;
  scene.add(ocean);

  const waterTex = new THREE.CanvasTexture(waterCanvas);
  waterTex.wrapS = waterTex.wrapT = THREE.ClampToEdgeWrapping;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W, MAP_D, 1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uMask: { value: waterTex }, uSun: { value: new THREE.Vector3(-0.4, 0.75, -0.35).normalize() } },
      vertexShader: `uniform float uTime; varying vec2 vUv; varying vec3 vPos;
        void main(){
          vUv = uv;
          vec3 p = position;
          p.z += sin(position.x * 1.7 + uTime * 1.4) * 0.035 + sin(position.y * 1.3 - uTime) * 0.02;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vPos = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `uniform sampler2D uMask; uniform vec3 uSun; varying vec2 vUv; varying vec3 vPos;
        void main(){
          float m = texture2D(uMask, vUv).r;
          if (m < 0.5) discard;
          vec3 viewDir = normalize(cameraPosition - vPos);
          float fres = pow(1.0 - max(dot(viewDir, vec3(0.0,1.0,0.0)), 0.0), 2.2);
          float spec = pow(max(dot(reflect(-uSun, vec3(0.0,1.0,0.0)), viewDir), 0.0), 48.0);
          vec3 col = mix(vec3(0.16,0.36,0.40), vec3(0.55,0.72,0.74), fres);
          col += spec * vec3(1.0, 0.95, 0.85) * 0.55;
          gl_FragColor = vec4(col, 0.78);
        }`,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.02;
  scene.add(water);

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
    uniforms: { uMask: { value: fogTex }, uTime: { value: 0 }, uOpacity: { value: 0.92 } },
    vertexShader: `uniform float uTime; varying vec2 vUv; varying float vH;
      void main(){
        vUv = uv;
        vec3 p = position;
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
  scene.add(fogShell);

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
  };
  let fogTarget = new Float32Array(4).fill(1);
  let fogShown = fogTarget.slice();
  let yaw = 0.35;
  let pitch = 0.78;
  let dist = mobile ? 16 : 15;
  let tx = (0.42 - 0.5) * MAP_W;
  let tz = (0.42 - 0.5) * MAP_D;
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
      lift(sampleHeight(tx / MAP_W + 0.5, tz / MAP_D + 0.5)) + Math.sin(elev) * dist,
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
    const verst = MAP_MANIFEST.widthVersts / MAP_W;
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
    overlayCtx.fillText('5 вёрст', 28, h - 36);
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
      albedoTex.dispose();
      waterTex.dispose();
      fogTex.dispose();
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
