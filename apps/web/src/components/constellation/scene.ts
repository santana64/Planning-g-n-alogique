import * as THREE from 'three/webgpu';
import {
  Fn,
  exp,
  float,
  instancedBufferAttribute,
  max,
  smoothstep,
  uniform,
  uv,
  vec4,
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { QUALITY_PROFILES, type QualityPreset } from '@chronolignee/engine';
import type { ConstellationLink, ConstellationStar } from '@/server/constellation';
import {
  RING_SPACING,
  SKY,
  centuryGuides,
  starBrightness,
  starDepth,
  starSize,
  uncertaintySpan,
  type ConstellationMode,
} from './appearance';

/**
 * The constellation's renderer.
 *
 * A plain module, not a component: it owns a WebGPU (or WebGL 2) renderer, a
 * scene and a camera, and knows nothing about React. The component drives it
 * and draws the names over it in the DOM, where text is sharp and selectable.
 *
 * Frames are drawn on demand — when the camera moves, a transition runs, or
 * the data changes — not sixty times a second over a still picture. A family
 * constellation left open in a tab should cost nothing.
 *
 * On-demand drawing has one trap, found by reading the pixels back: shader
 * pipelines compile in the background, and three.js silently skips an object
 * whose pipeline is not ready yet. The first frames after anything new is
 * built are therefore incomplete — here, entirely empty — and with nothing
 * left to trigger another frame, that empty canvas stayed on screen until
 * the reader happened to move the mouse. So after anything that can create a
 * pipeline, the scene keeps drawing for a short while, compiles explicitly,
 * and draws again once the compilation reports done.
 */

const TRANSITION_MS = 900;
const FOV = 45;
/** How long to keep drawing after something that may have created a pipeline. */
const SETTLE_MS = 1200;

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  /** In front of the camera and inside the canvas. */
  readonly visible: boolean;
}

export interface ConstellationScene {
  readonly backend: 'webgpu' | 'webgl2';
  setData(
    stars: readonly ConstellationStar[],
    links: readonly ConstellationLink[],
    focusId: string | null,
    presentYear: number,
  ): void;
  setMode(mode: ConstellationMode): void;
  setQuality(preset: QualityPreset): void;
  resize(width: number, height: number): void;
  resetView(): void;
  zoom(factor: number): void;
  /** Screen position of each star, in the order given to setData. */
  projectStars(): ProjectedPoint[];
  /** Screen position of each century guide's label, with its year. */
  projectGuides(): (ProjectedPoint & { readonly year: number })[];
  /** Called after every drawn frame, with the time since the previous one when continuous. */
  onFrame(listener: (frameMs: number | null) => void): void;
  readonly frames: number;
  /**
   * Every pipeline the current content needs has compiled, and a frame has
   * been drawn since: what is on the canvas is the whole picture.
   */
  readonly settled: boolean;
  dispose(): void;
}

export interface SceneOptions {
  readonly preset: QualityPreset;
  readonly forceWebGL: boolean;
  readonly reducedMotion: boolean;
}

interface Tween {
  readonly start: number;
  readonly duration: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export async function createConstellationScene(
  canvas: HTMLCanvasElement,
  options: SceneOptions,
): Promise<ConstellationScene> {
  let profile = QUALITY_PROFILES[options.preset];
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: profile.antialias,
    forceWebGL: options.forceWebGL,
  });
  await renderer.init();
  const backend: 'webgpu' | 'webgl2' =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
      ? 'webgpu'
      : 'webgl2';

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatioCap));
  renderer.setClearColor(new THREE.Color(SKY.background), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20_000);
  camera.position.set(0, 0, 120);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !options.reducedMotion;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minDistance = 4;
  controls.maxDistance = 4_000;

  // --- Stars ----------------------------------------------------------------

  const halo = uniform(profile.halo);
  let capacity = 0;
  let positions = new Float32Array(0);
  let brightness = new Float32Array(0);
  let sizes = new Float32Array(0);
  let tints = new Float32Array(0);
  let positionAttribute: THREE.InstancedBufferAttribute | null = null;
  let brightnessAttribute: THREE.InstancedBufferAttribute | null = null;
  let sizeAttribute: THREE.InstancedBufferAttribute | null = null;
  let tintAttribute: THREE.InstancedBufferAttribute | null = null;
  let sprite: THREE.Sprite | null = null;
  let starMaterial: THREE.PointsNodeMaterial | null = null;

  function buildStars(count: number) {
    capacity = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
    positions = new Float32Array(capacity * 3);
    brightness = new Float32Array(capacity);
    sizes = new Float32Array(capacity);
    tints = new Float32Array(capacity * 3);
    positionAttribute = new THREE.InstancedBufferAttribute(positions, 3);
    brightnessAttribute = new THREE.InstancedBufferAttribute(brightness, 1);
    sizeAttribute = new THREE.InstancedBufferAttribute(sizes, 1);
    tintAttribute = new THREE.InstancedBufferAttribute(tints, 3);
    for (const attribute of [
      positionAttribute,
      brightnessAttribute,
      sizeAttribute,
      tintAttribute,
    ]) {
      attribute.setUsage(THREE.DynamicDrawUsage);
    }

    if (sprite) {
      scene.remove(sprite);
      starMaterial?.dispose();
    }

    const material = new THREE.PointsNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: false,
    });
    material.alphaToCoverage = false;
    material.positionNode = instancedBufferAttribute<'vec3'>(positionAttribute, 'vec3');
    const light = instancedBufferAttribute<'float'>(brightnessAttribute, 'float');
    // Magnitude, as the sky has it: a brighter star also looks larger. On
    // light alone, a sourced and an unsourced star differ by a shade the eye
    // barely separates at this size.
    material.sizeNode = instancedBufferAttribute<'float'>(sizeAttribute, 'float')
      .mul(halo)
      .mul(light.mul(0.8).add(0.6));
    const tint = instancedBufferAttribute<'vec3'>(tintAttribute, 'vec3');
    // A disc for the star itself and a soft falloff around it. The core's
    // share of the sprite shrinks as the halo grows, so the star keeps its
    // size whatever the quality preset.
    material.colorNode = Fn(() => {
      const distance = uv().sub(0.5).length().mul(2);
      const core = float(1).div(halo);
      const disc = float(1).sub(smoothstep(core.mul(0.55), core, distance));
      const glow = exp(distance.mul(-4.5)).mul(float(1).sub(distance)).mul(0.55);
      return vec4(tint, max(disc, glow).mul(light));
    })();

    starMaterial = material;
    sprite = new THREE.Sprite(material);
    sprite.frustumCulled = false;
    sprite.count = 0;
    scene.add(sprite);
  }

  // --- Lines ----------------------------------------------------------------

  function lineLayer(): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    const material = new THREE.LineBasicNodeMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const segments = new THREE.LineSegments(geometry, material);
    segments.frustumCulled = false;
    scene.add(segments);
    return segments;
  }

  function fillLines(layer: THREE.LineSegments, points: number[], colors: number[]) {
    const geometry = layer.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (position.array.length !== points.length) {
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(points), 3).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    } else {
      (position.array as Float32Array).set(points);
      position.needsUpdate = true;
      const color = geometry.getAttribute('color') as THREE.BufferAttribute;
      (color.array as Float32Array).set(colors);
      color.needsUpdate = true;
    }
    geometry.setDrawRange(0, points.length / 3);
    geometry.computeBoundingSphere();
  }

  const linkLayer = lineLayer();
  const ringLayer = lineLayer();
  const guideLayer = lineLayer();
  const spanLayer = lineLayer();
  const planOpacity = uniform(1);
  const depthOpacity = uniform(0);
  (ringLayer.material as THREE.LineBasicNodeMaterial).opacityNode = planOpacity;
  (guideLayer.material as THREE.LineBasicNodeMaterial).opacityNode = depthOpacity;
  (spanLayer.material as THREE.LineBasicNodeMaterial).opacityNode = depthOpacity;

  const colour = (hex: string) => new THREE.Color(hex);
  const TINT = {
    star: colour(SKY.star),
    focus: colour(SKY.focus),
    hidden: colour(SKY.hidden),
    parent: colour(SKY.parentLink),
    otherParent: colour(SKY.otherParentLink),
    partner: colour(SKY.partnerLink),
    guide: colour(SKY.guide),
  };

  function circle(
    radius: number,
    z: number,
    points: number[],
    colors: number[],
    tint: THREE.Color,
  ) {
    const segments = 160;
    for (let index = 0; index < segments; index += 1) {
      const a = (index / segments) * Math.PI * 2;
      const b = ((index + 1) / segments) * Math.PI * 2;
      points.push(
        radius * Math.cos(a),
        radius * Math.sin(a),
        z,
        radius * Math.cos(b),
        radius * Math.sin(b),
        z,
      );
      colors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
    }
  }

  // --- State ----------------------------------------------------------------

  let stars: readonly ConstellationStar[] = [];
  let links: readonly ConstellationLink[] = [];
  let focusId: string | null = null;
  let presentYear = new Date().getFullYear();
  let mode: ConstellationMode = 'plan';
  let guides: { year: number; z: number }[] = [];
  let outerRadius = RING_SPACING * 2;

  // Transition endpoints, per star: position and brightness.
  let fromPosition = new Float32Array(0);
  let toPosition = new Float32Array(0);
  let fromLight = new Float32Array(0);
  let toLight = new Float32Array(0);
  let starTween: Tween | null = null;
  let layerTween: (Tween & { fromPlan: number; toPlan: number }) | null = null;

  let cameraTween:
    | (Tween & {
        fromPosition: THREE.Vector3;
        toPosition: THREE.Vector3;
        fromTarget: THREE.Vector3;
        toTarget: THREE.Vector3;
      })
    | null = null;

  let width = 1;
  let height = 1;
  let needsRender = true;
  let frames = 0;
  let lastFrameAt: number | null = null;
  const frameListeners: ((frameMs: number | null) => void)[] = [];
  let disposed = false;
  let settleUntil = 0;
  let compiled = false;
  let settled = false;
  let compileGeneration = 0;

  function settle() {
    settleUntil = performance.now() + SETTLE_MS;
    needsRender = true;
  }

  /** Compile what the scene now holds, and draw again when it is ready. */
  function compileThenSettle() {
    compiled = false;
    settled = false;
    settle();
    const generation = ++compileGeneration;
    renderer
      .compileAsync(scene, camera)
      .then(() => {
        if (disposed || generation !== compileGeneration) return;
        compiled = true;
        settle();
      })
      // A failed compilation is reported by three itself; the settle window
      // still gives every pipeline that did compile its chance to be drawn.
      .catch(() => undefined);
  }

  controls.addEventListener('change', () => {
    needsRender = true;
  });
  // The reader takes the camera back the moment they touch it.
  controls.addEventListener('start', () => {
    cameraTween = null;
  });

  function targetFor(star: ConstellationStar): { z: number; light: number } {
    const depth = starDepth(star, mode);
    return {
      z: depth ?? 0,
      // Without a place in depth, a star is not drawn there at all.
      light: depth === null ? 0 : starBrightness(star),
    };
  }

  function writeLinks() {
    const index = new Map(stars.map((star, position) => [star.id, position]));
    const points: number[] = [];
    const colors: number[] = [];
    for (const link of links) {
      const a = index.get(link.from);
      const b = index.get(link.to);
      if (a === undefined || b === undefined) continue;
      // A line fades with the fainter of its two ends: a link to someone
      // not placed in depth disappears with them.
      const strength = Math.min(brightness[a] ?? 0, brightness[b] ?? 0) > 0.01 ? 1 : 0;
      const tint =
        link.kind === 'PARTNER' ? TINT.partner : link.biological ? TINT.parent : TINT.otherParent;
      points.push(
        positions[a * 3] as number,
        positions[a * 3 + 1] as number,
        positions[a * 3 + 2] as number,
        positions[b * 3] as number,
        positions[b * 3 + 1] as number,
        positions[b * 3 + 2] as number,
      );
      const r = tint.r * strength;
      const g = tint.g * strength;
      const bl = tint.b * strength;
      colors.push(r, g, bl, r, g, bl);
    }
    fillLines(linkLayer, points, colors);
  }

  function writeSpans() {
    const points: number[] = [];
    const colors: number[] = [];
    stars.forEach((star, position) => {
      if (star.hidden) return;
      const span = uncertaintySpan(star);
      if (!span) return;
      const x = toPosition[position * 3] as number;
      const y = toPosition[position * 3 + 1] as number;
      points.push(x, y, span.near, x, y, span.far);
      colors.push(TINT.star.r * 0.5, TINT.star.g * 0.5, TINT.star.b * 0.5, 0, 0, 0);
    });
    fillLines(spanLayer, points, colors);
  }

  function writeGuides() {
    const rings: number[] = [];
    const ringColors: number[] = [];
    const maxHop = stars.reduce((max, star) => Math.max(max, star.hop), 0);
    for (let hop = 1; hop <= maxHop; hop += 1) {
      circle(hop * RING_SPACING, 0, rings, ringColors, TINT.guide);
    }
    fillLines(ringLayer, rings, ringColors);

    guides = centuryGuides(stars, presentYear);
    const planes: number[] = [];
    const planeColors: number[] = [];
    for (const guide of guides) circle(outerRadius, guide.z, planes, planeColors, TINT.guide);
    fillLines(guideLayer, planes, planeColors);
  }

  function applyStarFrame(progress: number) {
    const t = ease(progress);
    for (let index = 0; index < stars.length; index += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const k = index * 3 + axis;
        positions[k] =
          (fromPosition[k] as number) +
          ((toPosition[k] as number) - (fromPosition[k] as number)) * t;
      }
      brightness[index] =
        (fromLight[index] as number) +
        ((toLight[index] as number) - (fromLight[index] as number)) * t;
    }
    if (positionAttribute) positionAttribute.needsUpdate = true;
    if (brightnessAttribute) brightnessAttribute.needsUpdate = true;
    writeLinks();
  }

  function startStarTransition(immediate: boolean) {
    if (immediate || options.reducedMotion) {
      starTween = null;
      applyStarFrame(1);
    } else {
      starTween = { start: performance.now(), duration: TRANSITION_MS };
    }
    needsRender = true;
  }

  function retarget() {
    stars.forEach((star, index) => {
      const target = targetFor(star);
      toPosition[index * 3] = star.x;
      toPosition[index * 3 + 1] = star.y;
      toPosition[index * 3 + 2] = target.z;
      toLight[index] = target.light;
    });
  }

  function viewFor(nextMode: ConstellationMode): {
    position: THREE.Vector3;
    target: THREE.Vector3;
  } {
    const aspect = width / Math.max(1, height);
    const fit = Math.tan(((FOV / 2) * Math.PI) / 180);
    if (nextMode === 'plan') {
      const distance = (outerRadius * 1.08) / fit / Math.min(1, aspect);
      return { position: new THREE.Vector3(0, 0, distance), target: new THREE.Vector3(0, 0, 0) };
    }
    const placed = stars
      .map((star) => starDepth(star, 'depth'))
      .filter((value): value is number => value !== null);
    const nearest = placed.length > 0 ? Math.max(...placed) : 0;
    const furthest = placed.length > 0 ? Math.min(...placed) : 0;
    const middle = (nearest + furthest) / 2;
    const extent = Math.max(outerRadius, (nearest - furthest) / 2);
    const distance = (extent * 1.9) / fit / Math.min(1, aspect);
    // From the present, a little above and to the side: the rings recede
    // into the page and the centuries are seen one behind the other.
    const direction = new THREE.Vector3(-0.55, 0.42, 1).normalize();
    return {
      position: new THREE.Vector3(0, 0, middle).addScaledVector(direction, distance),
      target: new THREE.Vector3(0, 0, middle),
    };
  }

  function moveCamera(nextMode: ConstellationMode, immediate: boolean) {
    const view = viewFor(nextMode);
    if (immediate || options.reducedMotion) {
      cameraTween = null;
      camera.position.copy(view.position);
      controls.target.copy(view.target);
      controls.update();
    } else {
      cameraTween = {
        start: performance.now(),
        duration: TRANSITION_MS,
        fromPosition: camera.position.clone(),
        toPosition: view.position,
        fromTarget: controls.target.clone(),
        toTarget: view.target,
      };
    }
    needsRender = true;
  }

  function advance(now: number): boolean {
    let active = false;
    if (starTween) {
      const progress = Math.min(1, (now - starTween.start) / starTween.duration);
      applyStarFrame(progress);
      if (progress >= 1) starTween = null;
      active = true;
    }
    if (layerTween) {
      const progress = Math.min(1, (now - layerTween.start) / layerTween.duration);
      const plan = layerTween.fromPlan + (layerTween.toPlan - layerTween.fromPlan) * ease(progress);
      planOpacity.value = plan;
      depthOpacity.value = 1 - plan;
      if (progress >= 1) layerTween = null;
      active = true;
    }
    if (cameraTween) {
      const t = ease(Math.min(1, (now - cameraTween.start) / cameraTween.duration));
      camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, t);
      controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, t);
      if (t >= 1) cameraTween = null;
      active = true;
    }
    return active;
  }

  renderer.setAnimationLoop(() => {
    if (disposed) return;
    const now = performance.now();
    const animating = advance(now);
    const moved = controls.update();
    const settling = now < settleUntil;
    if (!needsRender && !animating && !moved && !settling) {
      lastFrameAt = null;
      return;
    }
    needsRender = false;
    renderer.render(scene, camera);
    frames += 1;
    if (compiled) settled = true;
    const frameMs = lastFrameAt === null ? null : now - lastFrameAt;
    lastFrameAt = now;
    for (const listener of frameListeners) listener(frameMs);
  });

  const projection = new THREE.Vector3();
  function project(x: number, y: number, z: number): ProjectedPoint {
    projection.set(x, y, z).project(camera);
    const sx = ((projection.x + 1) / 2) * width;
    const sy = ((1 - projection.y) / 2) * height;
    const visible =
      projection.z > -1 && projection.z < 1 && sx >= 0 && sx <= width && sy >= 0 && sy <= height;
    return { x: sx, y: sy, visible };
  }

  return {
    backend,
    get frames() {
      return frames;
    },
    get settled() {
      return settled;
    },

    setData(nextStars, nextLinks, nextFocusId, nextPresentYear) {
      const previous = new Map<string, { x: number; y: number; z: number; light: number }>();
      stars.forEach((star, index) => {
        previous.set(star.id, {
          x: positions[index * 3] as number,
          y: positions[index * 3 + 1] as number,
          z: positions[index * 3 + 2] as number,
          light: brightness[index] as number,
        });
      });
      const firstLoad = stars.length === 0;
      // New stars rise from where the new focus person was, so a change of
      // focus reads as the family turning around them.
      const origin = (nextFocusId && previous.get(nextFocusId)) || { x: 0, y: 0, z: 0, light: 0 };

      stars = nextStars;
      links = nextLinks;
      focusId = nextFocusId;
      presentYear = nextPresentYear;
      const maxHop = stars.reduce((max, star) => Math.max(max, star.hop), 0);
      outerRadius = Math.max(RING_SPACING * 1.5, (maxHop + 0.6) * RING_SPACING);

      if (stars.length > capacity || !sprite) buildStars(stars.length);
      fromPosition = new Float32Array(stars.length * 3);
      toPosition = new Float32Array(stars.length * 3);
      fromLight = new Float32Array(stars.length);
      toLight = new Float32Array(stars.length);

      retarget();
      stars.forEach((star, index) => {
        const before = previous.get(star.id);
        const start = before ?? { ...origin, light: 0 };
        fromPosition[index * 3] = start.x;
        fromPosition[index * 3 + 1] = start.y;
        fromPosition[index * 3 + 2] = start.z;
        fromLight[index] = before ? before.light : 0;

        const isFocus = star.id === focusId;
        const tint = isFocus ? TINT.focus : star.hidden ? TINT.hidden : TINT.star;
        tints[index * 3] = tint.r;
        tints[index * 3 + 1] = tint.g;
        tints[index * 3 + 2] = tint.b;
        sizes[index] = starSize(star, isFocus);
      });
      if (sprite) sprite.count = stars.length;
      if (sizeAttribute) sizeAttribute.needsUpdate = true;
      if (tintAttribute) tintAttribute.needsUpdate = true;

      writeGuides();
      writeSpans();
      startStarTransition(firstLoad);
      if (firstLoad) moveCamera(mode, true);
      compileThenSettle();
    },

    setMode(nextMode) {
      if (nextMode === mode) return;
      mode = nextMode;
      retarget();
      fromPosition.set(positions.subarray(0, stars.length * 3));
      fromLight.set(brightness.subarray(0, stars.length));
      startStarTransition(false);
      const toPlan = nextMode === 'plan' ? 1 : 0;
      if (options.reducedMotion) {
        planOpacity.value = toPlan;
        depthOpacity.value = 1 - toPlan;
      } else {
        layerTween = {
          start: performance.now(),
          duration: TRANSITION_MS,
          fromPlan: planOpacity.value,
          toPlan,
        };
      }
      moveCamera(nextMode, false);
    },

    setQuality(preset) {
      profile = QUALITY_PROFILES[preset];
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatioCap));
      renderer.setSize(width, height, false);
      halo.value = profile.halo;
      // A new pixel ratio resizes the output target, which can mean a new
      // output pipeline to compile.
      settle();
    },

    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      settle();
    },

    resetView() {
      moveCamera(mode, false);
    },

    zoom(factor) {
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
      const length = Math.min(
        controls.maxDistance,
        Math.max(controls.minDistance, offset.length()),
      );
      camera.position.copy(controls.target).add(offset.setLength(length));
      needsRender = true;
    },

    projectStars() {
      return stars.map((_, index) =>
        project(
          positions[index * 3] as number,
          positions[index * 3 + 1] as number,
          positions[index * 3 + 2] as number,
        ),
      );
    },

    projectGuides() {
      if (mode !== 'depth') return [];
      return guides.map((guide) => ({ year: guide.year, ...project(-outerRadius, 0, guide.z) }));
    },

    onFrame(listener) {
      frameListeners.push(listener);
    },

    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      controls.dispose();
      for (const layer of [linkLayer, ringLayer, guideLayer, spanLayer]) {
        layer.geometry.dispose();
        (layer.material as THREE.Material).dispose();
      }
      starMaterial?.dispose();
      renderer.dispose();
    },
  };
}
