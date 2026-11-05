import * as THREE from 'three';
import type { ForestPlacement } from '../lib/map-forest';
import type { RoadRibbon } from '../lib/map-roads';

export interface CanopyUniforms {
  uForest: { value: THREE.Texture };
  uWater: { value: THREE.Texture };
  uForestOn: { value: number };
  uCanopy: { value: number };
}

const CANOPY_PARS = `
uniform sampler2D uForest;
uniform sampler2D uWater;
uniform float uForestOn;
uniform float uCanopy;
varying float vForest;
varying vec2 vCanopyUv;
`;

const CANOPY_VERT = `
vCanopyUv = uv;
float forestMask = texture2D(uForest, uv).r;
float wet = texture2D(uWater, uv).r;
forestMask *= 1.0 - smoothstep(0.42, 0.72, wet);
vForest = forestMask * uForestOn;
transformed.y += vForest * uCanopy;
`;

/** Мягкая маска полога. Строка 0 — север, flipY кладёт её в v=1, как uv рельефа. */
export function forestTexture(mask: Uint8Array, width: number, height: number): THREE.DataTexture {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const value = mask[i] ?? 0;
    bytes[i * 4] = value;
    bytes[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(bytes, width, height);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function emptyMaskTexture(): THREE.DataTexture {
  return forestTexture(new Uint8Array([0]), 1, 1);
}

/** Темнее и зеленее, плюс подъём полога. Нормаль чуть ломается, чтобы лес читался объёмом. */
export function applyCanopy(material: THREE.Material, uniforms: CanopyUniforms): void {
  material.customProgramCacheKey = () => 'okoyom-canopy-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uForest = uniforms.uForest;
    shader.uniforms.uWater = uniforms.uWater;
    shader.uniforms.uForestOn = uniforms.uForestOn;
    shader.uniforms.uCanopy = uniforms.uCanopy;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CANOPY_PARS}`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float nC = texture2D(uForest, uv).r;
        float nR = texture2D(uForest, uv + vec2(0.004, 0.0)).r;
        float nU = texture2D(uForest, uv + vec2(0.0, 0.004)).r;
        objectNormal = normalize(objectNormal + vec3((nC - nR) * 2.6, 0.0, (nC - nU) * 2.6));`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CANOPY_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CANOPY_PARS}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float cover = smoothstep(0.16, 0.58, vForest);
        float clump = fract(sin(dot(floor(vCanopyUv * vec2(180.0, 102.0)), vec2(127.1, 311.7))) * 43758.5453);
        vec3 canopy = mix(vec3(0.035, 0.12, 0.045), vec3(0.15, 0.33, 0.13), clump);
        diffuseColor.rgb = mix(diffuseColor.rgb, canopy, cover * 0.86);
        diffuseColor.rgb *= mix(1.0, 0.74, cover);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float crown = fract(sin(dot(floor(vCanopyUv * vec2(180.0, 102.0)), vec2(127.1, 311.7))) * 43758.5453);
        float crownR = fract(sin(dot(floor((vCanopyUv + vec2(0.0055, 0.0)) * vec2(180.0, 102.0)), vec2(127.1, 311.7))) * 43758.5453);
        float crownU = fract(sin(dot(floor((vCanopyUv + vec2(0.0, 0.0055)) * vec2(180.0, 102.0)), vec2(127.1, 311.7))) * 43758.5453);
        normal = normalize(normal + vec3((crown - crownR) * vForest * 0.85, (crown - crownU) * vForest * 0.85, 0.0));`,
      );
  };
}

/** Та же высота, что у цветного материала, иначе тень отстаёт от полога. */
export function canopyDepthMaterial(uniforms: CanopyUniforms): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  material.customProgramCacheKey = () => 'okoyom-canopy-depth-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uForest = uniforms.uForest;
    shader.uniforms.uWater = uniforms.uWater;
    shader.uniforms.uForestOn = uniforms.uForestOn;
    shader.uniforms.uCanopy = uniforms.uCanopy;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uForest;
        uniform sampler2D uWater;
        uniform float uForestOn;
        uniform float uCanopy;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float forestMask = texture2D(uForest, uv).r;
        float wet = texture2D(uWater, uv).r;
        forestMask *= 1.0 - smoothstep(0.42, 0.72, wet);
        transformed.y += forestMask * uForestOn * uCanopy;`,
      );
  };
  return material;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0;
  for (const part of parts) verts += part.getAttribute('position').count;
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const index: number[] = [];
  let offset = 0;
  for (const part of parts) {
    const pos = part.getAttribute('position');
    const nrm = part.getAttribute('normal');
    const col = part.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      position[(offset + i) * 3] = pos.getX(i);
      position[(offset + i) * 3 + 1] = pos.getY(i);
      position[(offset + i) * 3 + 2] = pos.getZ(i);
      normal[(offset + i) * 3] = nrm.getX(i);
      normal[(offset + i) * 3 + 1] = nrm.getY(i);
      normal[(offset + i) * 3 + 2] = nrm.getZ(i);
      color[(offset + i) * 3] = col.getX(i);
      color[(offset + i) * 3 + 1] = col.getY(i);
      color[(offset + i) * 3 + 2] = col.getZ(i);
    }
    const src = part.getIndex();
    if (src) {
      for (let i = 0; i < src.count; i++) index.push((src.getX(i) ?? 0) + offset);
    }
    offset += pos.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setIndex(index);
  return geo;
}

function paint(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Три низких конуса — куст крон, не отдельное дерево на каждый пиксель. */
export function canopyClusterGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.012, 0.018, 0.08, 4);
  trunk.translate(0, 0.04, 0);
  const a = new THREE.ConeGeometry(0.1, 0.26, 5);
  a.translate(0, 0.18, 0);
  const b = new THREE.ConeGeometry(0.075, 0.2, 4);
  b.translate(0.09, 0.15, 0.04);
  const c = new THREE.ConeGeometry(0.065, 0.18, 4);
  c.translate(-0.08, 0.14, 0.045);
  return mergeParts([
    paint(trunk, new THREE.Color('#3b2c1d')),
    paint(a, new THREE.Color('#1a4324')),
    paint(b, new THREE.Color('#245630')),
    paint(c, new THREE.Color('#14361e')),
  ]);
}

export interface TreeLod {
  near: number;
  far: number;
  hide: number;
}

export interface ForestMesh {
  mesh: THREE.InstancedMesh;
  fog: { value: THREE.Texture };
}

/**
 * Кроны инстансами. Вблизи полный куст, дальше сплющивается в кочку полога и пропадает:
 * издалека лес держит окраска и смещение рельефа.
 */
export function createForestMesh(
  spots: Array<ForestPlacement & { wx: number; wy: number; wz: number }>,
  lod: TreeLod,
  fogTex: THREE.Texture,
): ForestMesh | null {
  if (!spots.length) return null;
  const geometry = canopyClusterGeometry();
  const treeUv = new Float32Array(spots.length * 2);
  geometry.setAttribute('treeUv', new THREE.InstancedBufferAttribute(treeUv, 2));
  const fog = { value: fogTex };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.customProgramCacheKey = () => `okoyom-trees-${lod.hide}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFog = fog;
    shader.uniforms.uLodNear = { value: lod.near };
    shader.uniforms.uLodFar = { value: lod.far };
    shader.uniforms.uLodHide = { value: lod.hide };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 treeUv;
        varying vec2 vTreeUv;
        uniform float uLodNear;
        uniform float uLodFar;
        uniform float uLodHide;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTreeUv = treeUv;
        #ifdef USE_INSTANCING
          vec3 iCenter = instanceMatrix[3].xyz;
          float camD = distance(cameraPosition, iCenter);
          float detail = smoothstep(uLodFar, uLodNear, camD);
          float hide = 1.0 - smoothstep(uLodFar, uLodHide, camD);
          transformed.xz *= mix(0.42, 1.0, detail);
          transformed.y *= mix(0.16, 1.0, detail);
          transformed *= hide;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vTreeUv;
        uniform sampler2D uFog;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float hidden = texture2D(uFog, vec2(vTreeUv.x, 1.0 - vTreeUv.y)).r;
        if (hidden > 0.92) discard;`,
      );
  };
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    if (!spot) continue;
    dummy.position.set(spot.wx, spot.wy, spot.wz);
    dummy.rotation.set(0, spot.yaw, 0);
    dummy.scale.setScalar(spot.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const tint = 0.78 + (spot.scale - 0.7) * 0.45;
    mesh.setColorAt(i, new THREE.Color(tint, tint, tint * 0.9));
    treeUv[i * 2] = spot.x;
    treeUv[i * 2 + 1] = 1 - spot.y;
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const uvAttr = geometry.getAttribute('treeUv');
  uvAttr.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh, fog };
}

export interface RoadMesh {
  mesh: THREE.Mesh;
  fog: { value: THREE.Texture };
  fov: { value: number };
  resolution: { value: THREE.Vector2 };
}

export function createRoadMesh(ribbon: RoadRibbon, fogTex: THREE.Texture): RoadMesh | null {
  if (ribbon.index.length < 3) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(ribbon.position, 3));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(ribbon.side, 1));
  geometry.setAttribute('aSideDir', new THREE.BufferAttribute(ribbon.sideDir, 2));
  geometry.setAttribute('aWidth', new THREE.BufferAttribute(ribbon.width, 1));
  geometry.setAttribute('aMinPx', new THREE.BufferAttribute(ribbon.minPx, 1));
  geometry.setAttribute('aAlong', new THREE.BufferAttribute(ribbon.along, 1));
  geometry.setAttribute('aPattern', new THREE.BufferAttribute(ribbon.pattern, 1));
  geometry.setAttribute('aAssumed', new THREE.BufferAttribute(ribbon.assumed, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(ribbon.color, 3));
  geometry.setAttribute('aRoadUv', new THREE.BufferAttribute(ribbon.uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(ribbon.index, 1));
  geometry.computeBoundingSphere();
  const fog = { value: fogTex };
  const fov = { value: 0.66 };
  const resolution = { value: new THREE.Vector2(800, 600) };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { uFog: fog, uFov: fov, uResolution: resolution },
    vertexShader: `
      attribute float aSide;
      attribute vec2 aSideDir;
      attribute float aWidth;
      attribute float aMinPx;
      attribute float aAlong;
      attribute float aPattern;
      attribute float aAssumed;
      attribute vec3 aColor;
      attribute vec2 aRoadUv;
      uniform float uFov;
      uniform vec2 uResolution;
      varying float vSide;
      varying float vAlong;
      varying float vPattern;
      varying float vAssumed;
      varying vec3 vColor;
      varying vec2 vRoadUv;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        p.y += 0.035;
        vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
        vec4 sideClip = projectionMatrix * viewMatrix * modelMatrix * vec4(p + vec3(aSideDir.x, 0.0, aSideDir.y), 1.0);
        vec2 dir = sideClip.xy / max(sideClip.w, 0.0001) - clip.xy / max(clip.w, 0.0001);
        float span = length(dir);
        vec2 nrm = span > 0.00001 ? dir / span : vec2(0.0, 1.0);
        float halfNdc = max(aWidth * span * 0.5, aMinPx / max(1.0, uResolution.y));
        clip.xy += nrm * halfNdc * clip.w * aSide;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        vSide = aSide;
        vAlong = aAlong;
        vPattern = aPattern;
        vAssumed = aAssumed;
        vColor = aColor;
        vRoadUv = aRoadUv;
        gl_Position = clip;
      }
    `,
    fragmentShader: `
      uniform sampler2D uFog;
      uniform float uFov;
      uniform vec2 uResolution;
      varying float vSide;
      varying float vAlong;
      varying float vPattern;
      varying float vAssumed;
      varying vec3 vColor;
      varying vec2 vRoadUv;
      varying vec3 vWorld;
      void main() {
        float hidden = texture2D(uFog, vec2(vRoadUv.x, 1.0 - vRoadUv.y)).r;
        if (hidden > 0.92) discard;
        float distCam = max(0.35, distance(cameraPosition, vWorld));
        float worldPerPx = 2.0 * tan(uFov * 0.5) * distCam / max(1.0, uResolution.y);
        float period = max(0.02, (vPattern > 1.5 ? 8.0 : 14.0) * worldPerPx);
        float duty = vPattern > 1.5 ? 0.38 : 0.55;
        if (vAssumed > 0.5) duty *= 0.72;
        if (vPattern > 0.5 && fract(vAlong / period) > duty) discard;
        float edge = smoothstep(0.42, 0.98, abs(vSide));
        vec3 ink = vPattern > 1.5 ? vec3(0.04, 0.18, 0.28) : vec3(0.22, 0.12, 0.04);
        vec3 col = mix(vColor, ink, edge);
        float alpha = mix(0.98, 0.7, vAssumed) * (1.0 - smoothstep(0.4, 0.92, hidden));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return { mesh, fog, fov, resolution };
}
