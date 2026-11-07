import { LabelOccupancy, placeGraphLabel } from "./labelPlacement";
import { chineseConstellation } from "./chineseConstellations";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { hashString, starSize, type GraphTopology } from "./topology";
import { CAMERA_MAX_DISTANCE, FOG_FAR, FOG_NEAR } from "./viewBudget";
import type { QualitySettings } from "./quality";
import type { ConstellationLabel } from "./layouts/constellation";
// Value import (unlike the type-only one above), but still not a cycle: constellation.ts imports
// viewBudget.ts, never this file. Sharing the key function is what keeps the two sides' idea of
// "same edge" identical instead of two hand-matched encodings.
import { figureEdgeKey } from "./layouts/constellation";

export interface ThemeColors {
  background: string;
  text: string;
  muted: string;
  accents: Record<string, string>;
}

const ACCENT_NAMES = ["violet", "blue", "green", "amber", "red"] as const;

/** "3d" is the full orbit-camera experience; "2d" locks the camera face-on. See
 * docs/WORKSPACE-3D.md's "2D / 3D" section. */
export type GraphDimension = "2d" | "3d";
/** Mirrors `GraphMode` from store.ts, kept structural here so this module doesn't import the
 * store (renderer.ts has no other app-state dependency). */
export type CameraPresentationMode = "force" | "constellation";

/** Slow full-orbit auto-rotate for 3D Force mode. 60/speed = seconds per orbit (see
 * `OrbitControls.autoRotateSpeed` docs — default 2.0 is 30s/orbit); 0.75 lands at 80s, inside the
 * ~60–90s target. */
const AUTO_ROTATE_SPEED = 0.75;
/** How long idle (no OrbitControls interaction, no node drag) before auto-rotate/sway resumes. */
const IDLE_RESUME_MS = 2500;
/** Exponential-decay rate (per second) for easing `controls.target` back to the graph centroid
 * while idle — see `recenterTarget`. ~1.5 covers ~95% of the distance in ~2s, slow enough to read
 * as a drift rather than a snap. */
const RECENTER_RATE = 1.5;
/** Recentering stops once `controls.target` is within this many world units of the centroid — the
 * remaining sliver is left alone rather than snapped to zero, so there's never a visible pop. */
const RECENTER_EPSILON = 0.5;
/** Constellation-mode azimuth sway amplitude — comfortably under the "never flips past ~±30°"
 * requirement in the Phase 17 plan. */
const SWAY_AMPLITUDE_RAD = THREE.MathUtils.degToRad(25);
/** One full sway back-and-forth cycle takes this long — slow, so it reads as parallax, not spin. */
const SWAY_PERIOD_S = 26;
/** 2D↔3D camera reframe duration — matches `LayoutTransition`'s ~900ms so a dimension switch and
 * a Force/Constellation switch feel like the same "weight" of animation. */
const CAMERA_EASE_MS = 750;

/** How long the initial-load "opening" reveal takes to fade stars/edges from near-invisible to
 * full brightness — see `startEntrance`. Deliberately slower than a mode-switch transition so the
 * first sight of a vault reads as a distinct, special moment, not just another layout swap. Passed
 * to `GraphView3D`'s `LayoutTransition.start()` override too, so the position burst-from-center and
 * this brightness ramp finish in lockstep. */
export const ENTRANCE_DURATION_MS = 1300;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function readThemeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--color-bg", "#0a0e16"),
    text: read("--color-text", "#e6ebf4"),
    muted: read("--color-muted", "#8b96ad"),
    accents: Object.fromEntries(ACCENT_NAMES.map((name) => [name, read(`--color-accent-${name}`, "#4cc2ff")])),
  };
}

function hexToRgb01(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = h.length === 6 ? parseInt(h, 16) : NaN;
  if (Number.isNaN(num)) return [0.5, 0.4, 1];
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

/** Small radial-gradient sprite, generated once on a canvas — zero GPU text/geometry cost per star.
 * Two-stage falloff (tight bright core + soft wide halo) reads as a glowing point, not a flat disc. */
function makeSpriteTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,255,255,0.95)");
  g.addColorStop(0.4, "rgba(255,255,255,0.32)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const POINT_VERTEX = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
attribute float aHighlight;
attribute float aPinned;
attribute float aSelected;
uniform float uTime;
uniform float uPixelRatio;
uniform float uTwinkle;
uniform float uSizeScale;
// Graph settings panel's "Node size" slider — a plain multiplier on top of the perspective-correct
// uSizeScale term below, so the slider scales stars uniformly regardless of camera distance.
// Default 1.0 (see store.ts's DEFAULT_GRAPH_SETTINGS) reproduces the pre-Phase-18 size exactly.
uniform float uSizeMult;
uniform float uMinSize;
// Initial-load "opening" reveal (see startEntrance): ramps 0 -> 1 over ENTRANCE_DURATION_MS.
// Defaults to 1 (fully revealed) so every other caller of this shader is unaffected. Precision is
// explicit (matching the fragment shader's declaration below) because a plain uniform float
// here would default to the vertex stage's highp, while the fragment stage's top-of-file
// precision mediump float default gives its own copy mediump instead — GLSL requires a uniform
// shared between stages to agree, or WebGL rejects the whole program at link time.
uniform mediump float uEntrance;
varying vec3 vColor;
varying float vHighlight;
varying float vPinned;
varying float vSelected;
varying float vFogDepth;
void main() {
  vColor = aColor;
  vHighlight = aHighlight;
  vPinned = aPinned;
  vSelected = aSelected;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mvPosition.z;
  float twinkle = 1.0 + uTwinkle * 0.18 * sin(uTime * 1.6 + aPhase);
  // Stars grow in from a small fraction of their final size during the entrance reveal, instead of
  // popping to full size the instant they're visible at all (see uEntrance / the fragment shader).
  float entranceSize = mix(0.35, 1.0, uEntrance);
  gl_PointSize = max(uMinSize, aSize * twinkle * (uSizeScale / -mvPosition.z)) * uPixelRatio * uSizeMult * entranceSize;
  gl_Position = projectionMatrix * mvPosition;
}`;

const POINT_FRAGMENT = /* glsl */ `
precision mediump float;
uniform sampler2D uSprite;
// three.js's WebGLProgram only auto-declares fogColor/fogNear/fogFar inside its own built-in
// shader chunks, not for custom ShaderMaterial source — it still auto-defines USE_FOG (below)
// when material.fog is true and scene.fog is set, but these three uniforms must be declared
// and fed manually from the JS side (see the constructor and setTheme()).
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform mediump float uEntrance;
varying vec3 vColor;
varying float vHighlight;
varying float vPinned;
varying float vSelected;
varying float vFogDepth;
void main() {
  vec4 tex = texture2D(uSprite, gl_PointCoord);
  float bright = clamp(vHighlight, 0.0, 1.4);
  float a = tex.a * min(bright, 1.0) * uEntrance;
  vec3 col = vColor * bright;
  // Pin ring / selection ring: two subtle annuli sampled straight off
  // gl_PointCoord, no extra geometry — see docs/WORKSPACE-3D.md's rendering budget.
  float d = length(gl_PointCoord - vec2(0.5));
  if (vPinned > 0.5) {
    float ring = smoothstep(0.30, 0.33, d) * (1.0 - smoothstep(0.37, 0.40, d));
    a = max(a, ring * 0.85);
    col = mix(col, vColor, ring);
  }
  if (vSelected > 0.5) {
    float ring2 = smoothstep(0.41, 0.44, d) * (1.0 - smoothstep(0.47, 0.50, d));
    a = max(a, ring2 * 0.95);
    col = mix(col, vec3(1.0), ring2 * 0.7);
  }
  if (a < 0.01) discard;
  #ifdef USE_FOG
  col = mix(col, fogColor, smoothstep(fogNear, fogFar, vFogDepth));
  #endif
  gl_FragColor = vec4(col, a);
}`;

/** Faint small-caps constellation-name sprites, Constellation Mode only — the one exception to
 * the "one draw call per primitive class" budget, since there's at most one per cluster. */
const CONSTELLATION_LABEL_OPACITY = 0.45;
/** Matches `LayoutTransition`'s duration so a label finishes fading in exactly as its cluster
 * settles into place. */
const CONSTELLATION_LABEL_FADE_MS = 900;

/** Hard clamp on how far `OrbitControls` will ever let the camera pull back from its target —
 * `CAMERA_MAX_DISTANCE` and the fog range now live in viewBudget.ts — a dependency-free module
 * both this renderer and ConstellationLayout's fit-to-budget pass import, so the two can never
 * drift apart again (which is how the dome outgrew the reachable volume once already) without a
 * layout having to import the renderer and drag three.js into a pure-CPU module graph. Re-exported
 * here so existing readers of `renderer.ts` still find them where they expect. */
export { CAMERA_MAX_DISTANCE, FOG_FAR } from "./viewBudget";

/** Edge line opacity at the Display section's default "Link thickness" (1×) — see
 * `setLinkThickness`, which scales this. */
const EDGE_BASE_OPACITY = 0.4;
/** Edge count a vault has to exceed before edges start being drawn fainter. Below this the sky is
 * sparse enough that additive blending reads as intended: a few crossing lines, slightly brighter
 * where they meet. */
const EDGE_DENSITY_FLOOR = 250;
/** Node count past which the label budget starts shrinking, for the same reason. */
const LABEL_DENSITY_FLOOR = 120;
/** Above this many edges, additive blending stops being a look and becomes a white blob: every
 * overlap SUMS, so a dense core saturates to pure white no matter how faint each line is. Past this
 * the edges switch to ordinary alpha blending, where a hundred overlapping lines can at worst reach
 * the line colour instead of running away to white. */
const EDGE_ADDITIVE_CEILING = 900;
/** Constellation Mode's synthetic "shape completion" guide-line opacity — deliberately dimmer
 * than a real edge's `EDGE_BASE_OPACITY`, so a real connection always reads as more prominent. */
const SYNTHETIC_EDGE_OPACITY = 0.15;

/** Constellation Mode's star-brightness boost, applied uniformly to every node (see
 * `setConstellationEmphasis`) — this mode is explicitly allowed to make stars shine brighter than
 * Force mode's baseline, composing multiplicatively with hover/select and the Filters section's
 * `filterDim` so neither stops working. */
const CONSTELLATION_NODE_MULT = 1.25;
/** Per-edge multiplier when both endpoints landed in the SAME constellation (see
 * `ConstellationLayout.clusterOf`) — brighter than a plain Force-mode edge, so a constellation's
 * own asterism lines read as its shape at a glance. */
const CONSTELLATION_EDGE_SAME_MULT = 1.6;
/** Same constellation, but NOT part of the drawn figure — a real link between two stars the
 * constellation's own line figure doesn't join. Kept visible (it is genuine information) but well
 * below the figure's own lines, because a cluster's unrelated internal links crossing a figure is
 * what stopped Orion reading as Orion on a real vault. */
const CONSTELLATION_EDGE_OFF_FIGURE_MULT = 0.3;
/** Shared empty set, so leaving Constellation Mode doesn't allocate one per switch. */
const EMPTY_FIGURE_EDGES: ReadonlySet<number> = new Set<number>();
/**
 * Cross-constellation real edges are fully HIDDEN in Constellation Mode (see `applyEdgeHighlight`,
 * which forces such an edge's alpha to 0 — the same "invisible but still a real edge" mechanism
 * already used for a Filters-section-hidden endpoint, not a second visibility concept), not merely
 * dimmed. This used to be a 0.55 multiplier; verified against a running 37-note vault, not chosen
 * by taste, and 0.55 measurably failed: `partitionGraph` targets constellations of 5-24 stars
 * regardless of the real graph's shape (see that function's own doc comment), so a vault whose
 * real links don't happen to respect that partition — the common case, since the partition is
 * explicitly permitted to ignore topology — produces MANY cross-constellation edges relative to
 * same-constellation ones, with no upper bound as a vault grows. `linesMaterial` below uses
 * `AdditiveBlending`, so on-screen brightness from several overlapping faint lines SUMS, not maxes
 * — no fixed non-zero per-edge opacity is safe against an unbounded count of them converging on
 * the same screen region, which is exactly the "whole view re-reads as one connected web"
 * complaint this mode exists to fix. Hiding them outright has a real, bounded cost instead (a
 * genuine cross-constellation link becomes invisible in this mode), which is the trade the product
 * spec's "may disregard the graph entirely" licence explicitly covers — restated in Force mode,
 * which never calls `setConstellationEmphasis` and so never reaches this branch at all (see that
 * function's own doc comment).
 */

/** Wiki-link arrowhead triangle dimensions in *screen pixels* — `updateArrows` converts them to
 * world units per arrow from that arrow's camera distance, so an arrowhead reads at the same size
 * at every zoom level. Fixed world-unit sizes can't: any constant is either subpixel zoomed out or
 * screen-filling zoomed in. */
const ARROW_PX_LENGTH = 13;
const ARROW_PX_HALF_WIDTH = 4.5;
/** Cap on the share of an edge an arrowhead may cover, so a short edge stays a line with a head on
 * it rather than becoming one solid triangle. */
const ARROW_MAX_EDGE_FRACTION = 0.3;
/** Reference axes `updateArrows` falls back to when an edge runs almost straight at the camera and
 * the billboard cross product degenerates (the arrow is edge-on and near-invisible there anyway).
 * Swaps to the side axis whenever an edge runs close to parallel with the up axis, so this
 * fallback's own cross product never degenerates either. */
const ARROW_REF_UP = new THREE.Vector3(0, 1, 0);
const ARROW_REF_SIDE = new THREE.Vector3(1, 0, 0);

/**
 * The only three.js layer: one `THREE.Points` draw for all stars, one
 * `THREE.LineSegments` draw for all edges, plus a 2D overlay canvas for
 * labels. No bloom/postprocessing, no per-node objects. All typed arrays
 * are allocated in `setTopology` and mutated in place afterwards — see
 * docs/CONSTELLATION.md's rendering budget.
 */
export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly cameraDirection = new THREE.Vector3();
  private cameraDistance = 460;
  private readonly sprite = makeSpriteTexture();

  // Dimension/mode/animating camera behavior — see docs/WORKSPACE-3D.md's "2D / 3D" and
  // docs/CONSTELLATION.md's "sway". `applyCameraMode` is the one entry point GraphView3D calls;
  // everything else here reacts to these three flags plus idle/interacting state, recomputed each
  // `render()` frame rather than threaded through a dozen call sites.
  private dimension: GraphDimension = "3d";
  private presentationMode: CameraPresentationMode = "force";
  private animating = true;
  /** True while an OrbitControls drag or a node drag (`setControlsEnabled(false)`) is in flight. */
  private interacting = false;
  /** True once `IDLE_RESUME_MS` has elapsed since the last interaction ended — starts true so a
   * freshly-loaded graph auto-rotates/sways immediately, with no interaction required first. */
  private idle = true;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Sway phase accumulator (radians); only advances while actively swaying, so pausing/resuming
   * never skips ahead. */
  private swayPhase = 0;
  /** Wall-clock ms of the previous swaying frame, or null right after a (re)start — used to get a
   * real per-frame dt for the phase accumulator without a stale jump on resume. */
  private swayLastMs: number | null = null;
  private readonly swayBaseTheta: number;
  private readonly swayBasePhi: number;
  private readonly swayVector = new THREE.Vector3();
  /** Mean of all current node positions, refreshed each `updatePositions` call — the pivot idle
   * recentering eases `controls.target` toward. Right-drag panning translates `target` to an
   * arbitrary world point (often right on some unrelated star), and autoRotate/sway then orbit
   * *around* wherever it landed, reading as "camera fixates a random note"; recentering while idle
   * (see `recenterTarget`) keeps the orbit pivot on the graph as a whole instead. */
  private readonly centroid = new THREE.Vector3();
  /** Wall-clock ms of the previous recentering frame, or null right after a (re)start — same
   * pattern as `swayLastMs`, so the first frame after going idle doesn't jump by a stale dt. */
  private recenterLastMs: number | null = null;
  private cameraTransition: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    startMs: number;
  } | null = null;

  private readonly pointsGeometry = new THREE.BufferGeometry();
  private readonly pointsMaterial: THREE.ShaderMaterial;
  private readonly points: THREE.Points;

  private readonly linesGeometry = new THREE.BufferGeometry();
  private readonly linesMaterial: THREE.LineBasicMaterial;
  private readonly lines: THREE.LineSegments;

  // Constellation Mode's dim "shape completion" guide lines (see ConstellationLayout's
  // `syntheticEdges` doc comment) — the pattern's own line figure drawn wherever the real graph
  // has no edge of its own between the same two (now-positioned) stars. Purely visual: never
  // raycast, never affects Unlink/hover, hidden outside Constellation Mode.
  private readonly syntheticEdgesGeometry = new THREE.BufferGeometry();
  private readonly syntheticEdgesMaterial: THREE.LineBasicMaterial;
  private readonly syntheticEdgesMesh: THREE.LineSegments;
  private syntheticEdgePairs: ReadonlyArray<readonly [number, number]> = [];

  // Directional arrowheads on every edge (wiki-link and canvas/drag-created alike — both carry a
  // real from/to at creation time, so both get one) — Display section's "Arrows" toggle. One
  // pooled triangle per edge, one draw call total, per docs/WORKSPACE-3D.md's rendering budget
  // ("arrows are the only possible new primitive layer" — see the Phase 18 plan). Hidden (not
  // removed) when the toggle is off. Never raycast.
  private readonly arrowsGeometry = new THREE.BufferGeometry();
  private readonly arrowsMaterial: THREE.MeshBasicMaterial;
  private readonly arrowsMesh: THREE.Mesh;
  /** Indices into `topology.edges`, in the same order as the arrow triangles packed into
   * `arrowsGeometry` — recomputed in `setTopology`. */
  private arrowEdgeIndices: number[] = [];
  /** Full-edge-index → arrow-triangle-index — lets `applyEdgeHighlight` update an edge's arrow
   * color in the same pass as its line color, without a second scan over `arrowEdgeIndices`. */
  private arrowIndexByEdge = new Int32Array(0);
  // Scratch vectors for `updateArrows`, reused every frame instead of allocated per edge.
  private readonly arrowDir = new THREE.Vector3();
  private readonly arrowPerp = new THREE.Vector3();
  private readonly arrowTip = new THREE.Vector3();
  private readonly arrowBase = new THREE.Vector3();
  private readonly arrowToCam = new THREE.Vector3();

  // Shift-drag link preview: a single segment + a small glow sprite at the
  // cursor end, per docs/WORKSPACE-3D.md's rendering budget. Hidden (not
  // removed) when not actively link-dragging.
  private readonly previewLineGeometry = new THREE.BufferGeometry();
  private readonly previewLineMaterial: THREE.LineBasicMaterial;
  private readonly previewLine: THREE.Line;
  private readonly previewGlowMaterial: THREE.SpriteMaterial;
  private readonly previewGlow: THREE.Sprite;

  private readonly labelCanvas: HTMLCanvasElement;
  private readonly labelCtx: CanvasRenderingContext2D;

  // Constellation-name sprites: pooled THREE.Sprites (grown, never shrunk — hidden instead of
  // disposed when a switch needs fewer), one canvas texture per distinct name (cached, since the
  // same pattern name recurs across vaults/regenerations). Never raycast — see `pick`/`pickEdge`,
  // which only intersect `points`/`lines`.
  private readonly constellationLabelSprites: THREE.Sprite[] = [];
  private readonly constellationLabelTextures = new Map<string, THREE.Texture>();
  private constellationLabelFadeStart = 0;

  private readonly raycaster = new THREE.Raycaster();
  private readonly raycastPlane = new THREE.Plane();
  private readonly raycastHit = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();

  private topology: GraphTopology | null = null;
  private rankedByDegree: number[] = [];
  private edgeBaseColors = new Float32Array(0);
  private theme: ThemeColors;

  private dprCap = 2;
  private lastWidth = 0;
  private lastHeight = 0;
  private labelCount = 40;
  private twinkleEnabled = true;
  private lastHoverIndex: number | null = null;
  private lastSelectedIndex: number | null = null;

  // Graph settings panel state — see `setFilterDim`, `setLinkThickness`, `setLabelDensity`.
  /** Per-node opacity multiplier (0..1) from the Filters section's search/orphans/existingOnly —
   * combined (not overwritten) with hover highlighting in `applyPointHighlight`/`applyEdgeHighlight`
   * so hovering a dimmed star still works sensibly. Reallocated to all-1s in `setTopology`. */
  private filterDim: Float32Array<ArrayBufferLike> = new Float32Array(0);
  /** Display section's "Link thickness" slider. WebGL's `lineWidth` is clamped to 1px on most
   * GPUs (ANGLE/macOS/ES contexts all ignore it), so this is applied primarily as an edge
   * opacity/brightness multiplier — see `setLinkThickness`. */
  private linkThicknessMult = 1;
  /** How much the current vault's sheer size dims its edges, 0-1. `AdaptiveQuality` only reacts to
   * frame time, so a fast machine happily rendered a 1,600-edge vault at full brightness and full
   * label count: it ran at 60fps and looked like a floodlight. Density is a separate axis from
   * speed and needs its own answer. Recomputed in `setTopology`. */
  private edgeDensityFactor = 1;
  /** Same idea for text: the fraction of the label budget a vault this size actually gets. */
  private labelDensityFactor = 1;
  /** Whether the current quality tier asked for additive (glowing) edges. Kept separate from the
   * material's actual blending, which density can override. */
  private additiveEdgesRequested = true;
  /** Edge count of the live topology, so `setQuality` can honour the additive ceiling too. */
  private edgeCountForDensity = 0;
  /** Constellation Mode's per-node cluster assignment (`ConstellationLayout.clusterOf`), or `null`
   * outside Constellation Mode — see `setConstellationEmphasis`. Drives both the uniform node
   * brightness boost (`applyPointHighlight`) and the same-vs-different-constellation edge
   * brightness split (`applyEdgeHighlight`); `null` makes both no-ops so Force mode is pixel-for-
   * pixel unaffected by this feature ever having run. */
  private constellationClusterOf: Int32Array | null = null;
  /** Which node pairs the current constellations' line figures actually join — see
   * `ConstellationLayout.figureEdgeKeys`. Empty outside Constellation Mode. */
  private figureEdgeKeys: ReadonlySet<number> = EMPTY_FIGURE_EDGES;
  /** Initial-load "opening" reveal state — see `startEntrance`. `entranceActive` false (the
   * default) means every multiplier below is a no-op 1, so nothing changes for a renderer that
   * never has `startEntrance` called on it. */
  private entranceActive = false;
  private entranceStartMs = 0;
  private entranceDurationMs = ENTRANCE_DURATION_MS;
  /** Mirrors `uEntrance` (points) so `recomputeLineOpacity` can fold the same ramp into edges,
   * which have no shader uniform of their own — `LineBasicMaterial` is a built-in material. */
  private entranceOpacityFactor = 1;
  /** Display section's "Text fade" slider — a multiplier on `labelCount` (itself driven by
   * `AdaptiveQuality`), applied in `updateLabels`. */
  private labelDensityMult = 1;

  constructor(
    glCanvas: HTMLCanvasElement,
    labelCanvas: HTMLCanvasElement,
    theme: ThemeColors,
    initialDimension: GraphDimension = "3d",
  ) {
    this.theme = theme;
    this.dimension = initialDimension;
    this.labelCanvas = labelCanvas;
    this.labelCtx = labelCanvas.getContext("2d")!;

    // Fully transparent clear: the overlay's CSS radial-gradient (same "deep space" recipe used
    // behind the 2D canvas elsewhere in the app) shows through, for depth with zero extra draw cost.
    this.renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);

    // Depth cue: distant stars fade toward the theme background instead of staying full-bright
    // out to the far clip plane, so orbiting reads as genuinely 3D. Linear fog, mutated (never
    // reallocated) in `setTheme()` — see docs/CONSTELLATION.md's rendering budget.
    {
      const [fr, fg, fb] = hexToRgb01(theme.background);
      this.scene.fog = new THREE.Fog(new THREE.Color(fr, fg, fb).getHex(), FOG_NEAR, FOG_FAR);
    }

    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 5000);
    this.cameraDirection.set(0.13, 0.13, 1).normalize();
    // The fixed "face-on" viewing direction constellation sway oscillates around and 2D locks to
    // along its z-only variant — captured once, before any dimension override below.
    {
      const baseSpherical = new THREE.Spherical().setFromVector3(this.cameraDirection);
      this.swayBaseTheta = baseSpherical.theta;
      this.swayBasePhi = baseSpherical.phi;
    }
    this.camera.position
      .copy(initialDimension === "2d" ? new THREE.Vector3(0, 0, 1) : this.cameraDirection)
      .multiplyScalar(this.cameraDistance);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, glCanvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 60;
    this.controls.maxDistance = CAMERA_MAX_DISTANCE;
    this.controls.target.set(0, 0, 0);
    this.controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
    // enableRotate/mouseButtons for the actual starting dimension are set by the `applyCameraMode`
    // call GraphView3D's initial mount effect makes right after construction — see that method's
    // own doc comment (and docs/WORKSPACE-3D.md's "2D / 3D") for the real 2D-vs-3D behavior.
    // Idle-pause/resume for both 3D Force's autoRotate and 3D Constellation's sway — a node drag
    // gates the same state via `setControlsEnabled`. See docs/WORKSPACE-3D.md's "2D / 3D".
    this.controls.addEventListener("start", () => this.markInteractionStart());
    this.controls.addEventListener("end", () => this.markInteractionEnd());

    this.raycaster.params.Points = { threshold: 9 };
    this.raycaster.params.Line = { threshold: 6 };

    this.pointsMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uTwinkle: { value: 1 },
        uSizeScale: { value: 600 },
        uSizeMult: { value: 1 },
        uMinSize: { value: initialDimension === "2d" ? 6 : 0 },
        uEntrance: { value: 1 },
        uSprite: { value: this.sprite },
        // Manually declared/fed (see POINT_FRAGMENT) since WebGLProgram doesn't auto-populate
        // fog uniforms for custom ShaderMaterial source.
        fogColor: { value: (this.scene.fog as THREE.Fog).color.clone() },
        fogNear: { value: FOG_NEAR },
        fogFar: { value: FOG_FAR },
      },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    // `ShaderMaterial.fog` defaults to false (unlike built-in materials), so the constructor arg
    // above is redundant with this — belt-and-suspenders per three.js version quirks around when
    // `WebGLProgram` decides to inject `USE_FOG`/fogColor/fogNear/fogFar.
    this.pointsMaterial.fog = true;
    this.points = new THREE.Points(this.pointsGeometry, this.pointsMaterial);
    this.scene.add(this.points);

    this.linesMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: EDGE_BASE_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.linesGeometry, this.linesMaterial);
    // Never culled: `updatePositions` never calls `computeBoundingSphere()` on this geometry (its
    // one draw call needs no per-node bounds), so three.js's auto-computed sphere stays frozen at
    // whatever the entrance reveal's bunched starting positions were — zooming/panning then leaves
    // that stale tiny sphere outside the frustum and the entire edge layer disappears while stars
    // (whose geometry IS refreshed every frame) stay visible. Culling a single draw call buys
    // nothing anyway. Same reasoning applies to `syntheticEdgesMesh`/`arrowsMesh` below.
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);

    this.syntheticEdgesMaterial = new THREE.LineBasicMaterial({
      color: this.theme.muted,
      transparent: true,
      opacity: SYNTHETIC_EDGE_OPACITY,
      depthWrite: false,
    });
    this.syntheticEdgesMesh = new THREE.LineSegments(this.syntheticEdgesGeometry, this.syntheticEdgesMaterial);
    this.syntheticEdgesMesh.visible = false;
    this.syntheticEdgesMesh.raycast = () => {}; // decorative only — never pickable
    // Same stale-bounding-sphere gotcha as `lines` above — this geometry is rewritten every
    // `updatePositions` too, so skip the (no-op-for-culling) recompute there entirely.
    this.syntheticEdgesMesh.frustumCulled = false;
    this.scene.add(this.syntheticEdgesMesh);

    this.arrowsMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.arrowsMesh = new THREE.Mesh(this.arrowsGeometry, this.arrowsMaterial);
    this.arrowsMesh.visible = false;
    // Same stale-bounding-sphere gotcha as `lines` above — rebuilt every `updateArrows`, so skip
    // the (no-op-for-culling) recompute there entirely.
    this.arrowsMesh.frustumCulled = false;
    this.scene.add(this.arrowsMesh);

    this.previewLineGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.previewLineMaterial = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.previewLine = new THREE.Line(this.previewLineGeometry, this.previewLineMaterial);
    this.previewLine.visible = false;
    this.scene.add(this.previewLine);

    this.previewGlowMaterial = new THREE.SpriteMaterial({
      map: this.sprite,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.previewGlow = new THREE.Sprite(this.previewGlowMaterial);
    this.previewGlow.scale.setScalar(16);
    this.previewGlow.visible = false;
    this.scene.add(this.previewGlow);
  }

  /** (Re)allocates every pooled buffer for a new topology — the only place this module allocates per-node arrays. */
  setTopology(topology: GraphTopology, theme: ThemeColors): void {
    this.topology = topology;
    this.theme = theme;
    this.lastHoverIndex = null;
    this.lastSelectedIndex = null;
    this.recomputeDensity(topology.nodes.length, topology.edges.length);
    // A stale array from the previous topology could otherwise be indexed by node indices from
    // the new one (different meaning, possibly out of range) for the brief window before the host
    // re-applies it below — same reasoning as `filterDim`'s reset just after.
    this.constellationClusterOf = null;
    const n = topology.nodes.length;
    // Reset to fully-visible; the host (GraphView3D) re-applies the Filters section's current
    // search/orphans/existingOnly state right after calling setTopology — same re-apply-on-rebuild
    // pattern as physics.ts's setForces/setFlatten.
    this.filterDim = new Float32Array(n).fill(1);

    this.rankedByDegree = topology.nodes
      .map((_, i) => i)
      .sort((a, b) => topology.nodes[b].degree - topology.nodes[a].degree);

    const positions = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const phases = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    const highlight = new Float32Array(n).fill(1);
    const pinned = new Float32Array(n);
    const selected = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const node = topology.nodes[i];
      sizes[i] = starSize(node.degree) * (node.ghost ? 0.7 : 1);
      phases[i] = ((hashString(node.id) % 1000) / 1000) * Math.PI * 2;
      const [r, g, b] = hexToRgb01(theme.accents[node.accent] ?? theme.text);
      const dim = node.ghost ? 0.55 : 1;
      colors[i * 3] = r * dim;
      colors[i * 3 + 1] = g * dim;
      colors[i * 3 + 2] = b * dim;
    }
    this.pointsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.pointsGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    this.pointsGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    this.pointsGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    this.pointsGeometry.setAttribute(
      "aHighlight",
      new THREE.BufferAttribute(highlight, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.pointsGeometry.setAttribute(
      "aPinned",
      new THREE.BufferAttribute(pinned, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.pointsGeometry.setAttribute(
      "aSelected",
      new THREE.BufferAttribute(selected, 1).setUsage(THREE.DynamicDrawUsage),
    );

    const e = topology.edges.length;
    const edgePositions = new Float32Array(e * 2 * 3);
    this.edgeBaseColors = new Float32Array(e * 2 * 3);
    const [mr, mg, mb] = hexToRgb01(theme.muted);
    for (let i = 0; i < e * 2; i++) {
      this.edgeBaseColors[i * 3] = mr;
      this.edgeBaseColors[i * 3 + 1] = mg;
      this.edgeBaseColors[i * 3 + 2] = mb;
    }
    this.linesGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(edgePositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    // RGBA (not RGB): alpha carries per-edge visibility (see `applyEdgeHighlight`) so a
    // filtered-out edge is truly transparent instead of color-multiplied to black, which rendered
    // as a solid line under NormalBlending (mid/low quality's `edgeGlow: false`, see `setQuality`).
    const edgeColorsRGBA = new Float32Array(e * 2 * 4);
    for (let i = 0; i < e * 2; i++) {
      edgeColorsRGBA[i * 4] = this.edgeBaseColors[i * 3];
      edgeColorsRGBA[i * 4 + 1] = this.edgeBaseColors[i * 3 + 1];
      edgeColorsRGBA[i * 4 + 2] = this.edgeBaseColors[i * 3 + 2];
      edgeColorsRGBA[i * 4 + 3] = 1;
    }
    this.linesGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(edgeColorsRGBA, 4).setUsage(THREE.DynamicDrawUsage),
    );

    this.arrowEdgeIndices = [];
    this.arrowIndexByEdge = new Int32Array(e).fill(-1);
    for (let i = 0; i < e; i++) {
      this.arrowIndexByEdge[i] = this.arrowEdgeIndices.length;
      this.arrowEdgeIndices.push(i);
    }
    const arrowCount = this.arrowEdgeIndices.length;
    const arrowPositions = new Float32Array(arrowCount * 3 * 3);
    // RGBA, same reasoning as the edge "color" attribute above.
    const arrowColors = new Float32Array(arrowCount * 3 * 4);
    for (let i = 0; i < arrowCount * 3; i++) {
      arrowColors[i * 4] = mr;
      arrowColors[i * 4 + 1] = mg;
      arrowColors[i * 4 + 2] = mb;
      arrowColors[i * 4 + 3] = 1;
    }
    this.arrowsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(arrowPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.arrowsGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(arrowColors, 4).setUsage(THREE.DynamicDrawUsage),
    );
    // Not populated here — the host always follows `setTopology` with `updatePositions`
    // (immediately, or via the next transition/physics frame), which computes real arrow
    // triangles from real node positions if the toggle is on.
  }

  /** Re-tints existing points/edges for a new theme without touching topology or positions. */
  setTheme(theme: ThemeColors): void {
    this.theme = theme;

    if (this.scene.fog) {
      const [fr, fg, fb] = hexToRgb01(theme.background);
      (this.scene.fog as THREE.Fog).color.setRGB(fr, fg, fb);
      // Scene fog auto-feeds `linesMaterial`/`LineBasicMaterial` (fog:true by three.js default),
      // but `pointsMaterial`'s manually-declared fogColor uniform (see POINT_FRAGMENT) needs an
      // explicit re-sync — it isn't wired to `scene.fog` by three.js internals for custom shaders.
      (this.pointsMaterial.uniforms.fogColor.value as THREE.Color).setRGB(fr, fg, fb);
    }

    const topology = this.topology;
    if (!topology) return;

    const colorAttr = this.pointsGeometry.getAttribute("aColor") as THREE.BufferAttribute | undefined;
    if (colorAttr) {
      const arr = colorAttr.array as Float32Array;
      for (let i = 0; i < topology.nodes.length; i++) {
        const node = topology.nodes[i];
        const [r, g, b] = hexToRgb01(theme.accents[node.accent] ?? theme.text);
        const dim = node.ghost ? 0.55 : 1;
        arr[i * 3] = r * dim;
        arr[i * 3 + 1] = g * dim;
        arr[i * 3 + 2] = b * dim;
      }
      colorAttr.needsUpdate = true;
    }

    const [mr, mg, mb] = hexToRgb01(theme.muted);
    for (let i = 0; i < this.edgeBaseColors.length / 3; i++) {
      this.edgeBaseColors[i * 3] = mr;
      this.edgeBaseColors[i * 3 + 1] = mg;
      this.edgeBaseColors[i * 3 + 2] = mb;
    }
    this.applyEdgeHighlight(this.lastHoverIndex);

    for (const sprite of this.constellationLabelSprites) {
      (sprite.material as THREE.SpriteMaterial).color.set(theme.muted);
    }
    this.syntheticEdgesMaterial.color.set(theme.muted);
  }

  /** White-on-transparent text baked once per distinct name+percent pair, tinted at draw time via
   * `SpriteMaterial.color` (same trick `previewLine`/`previewGlow` use) so a theme switch never
   * needs to re-rasterize. The match percentage is its own smaller, dimmer second line — not
   * folded into the name's own line — so the constellation's name stays the prominent read and
   * the confidence score reads as a quiet footnote underneath it. */
  private getConstellationLabelTexture(name: string, matchPercent: number): THREE.Texture {
    const key = `${name}|${matchPercent}`;
    const cached = this.constellationLabelTextures.get(key);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 88;
    const ctx = canvas.getContext("2d")!;
    ctx.textAlign = "center";

    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    // Small-caps-ish: full caps with letter-spacing reads as a quiet star-chart label without
    // needing a second (small) font size per character.
    const caps = chineseConstellation(name);
    // The canvas is a fixed 256px and the longest real IAU names are long — CAMELOPARDALIS at 26px
    // plus 4px tracking overflows it and renders clipped at BOTH ends (centred text), which showed
    // up on screen as "AMELOPARDALI". Shrink the type to fit rather than clipping or ellipsising: a
    // constellation's name is the one piece of text this mode has, so it has to be readable whole.
    const MAX_TEXT_WIDTH = canvas.width - 12;
    let fontPx = 26;
    const setNameFont = () => {
      ctx.font = `600 ${fontPx}px -apple-system, BlinkMacSystemFont, sans-serif`;
      if ("letterSpacing" in ctx) {
        (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${fontPx >= 20 ? 4 : 2}px`;
      }
    };
    setNameFont();
    while (ctx.measureText(caps).width > MAX_TEXT_WIDTH && fontPx > 11) {
      fontPx -= 1;
      setNameFont();
    }
    ctx.fillText(caps, canvas.width / 2, 32);

    ctx.font = "500 15px -apple-system, BlinkMacSystemFont, sans-serif";
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "1px";
    ctx.globalAlpha = 0.55;
    ctx.fillText(`${matchPercent}% 相似度`, canvas.width / 2, 66);
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    this.constellationLabelTextures.set(key, tex);
    return tex;
  }

  /**
   * Pooled constellation-name sprites for the clusters `ConstellationLayout` mapped onto a named
   * pattern this generation (fallback BFS clusters produce none). Pass an empty array to remove
   * every label — used when leaving Constellation Mode, per docs/CONSTELLATION.md: fallback
   * clusters and Force mode alike show no labels. `fadeStartMs` anchors the opacity ramp so labels
   * finish fading in exactly as their cluster's `LayoutTransition` settles.
   */
  setConstellationLabels(labels: ReadonlyArray<ConstellationLabel>, fadeStartMs: number): void {
    this.constellationLabelFadeStart = fadeStartMs;

    while (this.constellationLabelSprites.length < labels.length) {
      const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.scene.add(sprite);
      this.constellationLabelSprites.push(sprite);
    }

    for (let i = 0; i < this.constellationLabelSprites.length; i++) {
      const sprite = this.constellationLabelSprites[i];
      const label = labels[i];
      if (!label) {
        sprite.visible = false;
        continue;
      }
      const material = sprite.material as THREE.SpriteMaterial;
      const texture = this.getConstellationLabelTexture(label.text, label.matchPercent);
      if (material.map !== texture) material.map = texture;
      material.color.set(this.theme.muted);
      sprite.position.set(label.position[0], label.position[1], label.position[2]);
      // World-unit size tuned against RING_SPACING so the label reads clearly next to a cluster
      // without dwarfing it — see docs/CONSTELLATION.md. Height follows the texture's 256x88
      // aspect (was 256x64 before the match-percent line was added below the name).
      sprite.scale.set(112, 38.5, 1);
      sprite.visible = true;
    }
  }

  /** Sets Constellation Mode's dim "shape completion" guide lines — see the field's own doc
   * comment. Rebuilds the position buffer at the new pair count; positions themselves are filled
   * in by the very next `updatePositions` call, same as `setTopology`'s own edge buffer ("not
   * populated here"). Pass an empty array to hide (Force mode, or leaving Constellation Mode). */
  setSyntheticEdges(pairs: ReadonlyArray<readonly [number, number]>): void {
    this.syntheticEdgePairs = pairs;
    this.syntheticEdgesGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3),
    );
    this.syntheticEdgesMesh.visible = pairs.length > 0;
  }

  /**
   * Constellation Mode's brightness pass: stars shine uniformly brighter (`CONSTELLATION_NODE_MULT`)
   * a link between two stars of the SAME constellation reads brighter (`CONSTELLATION_EDGE_SAME_MULT`),
   * and a link crossing into a DIFFERENT constellation is hidden outright (see that constant's own
   * doc comment for why hidden rather than dimmed) — all three compose multiplicatively with
   * hover/select and the Filters section's dimming, never replace them (the hide is itself just the
   * existing alpha-zeroing mechanism, same as a Filters-hidden endpoint). Pass
   * `ConstellationLayout.clusterOf` when entering/regenerating Constellation Mode; pass `null` when
   * leaving it (GraphView3D's Force-mode branch) to fall back to Force mode's exact historical look
   * — verified by `applyPointHighlight`/`applyEdgeHighlight` both treating `null` as "skip the
   * constellation logic entirely", not "compute it from a stale array".
   */
  setConstellationEmphasis(clusterOf: Int32Array | null, figureEdgeKeys?: ReadonlySet<number>): void {
    this.constellationClusterOf = clusterOf;
    // Empty (not stale) when leaving the mode, so a later Force-mode edge pass can't consult last
    // session's figure — `clusterOf === null` already short-circuits, this is belt and braces.
    this.figureEdgeKeys = clusterOf ? (figureEdgeKeys ?? EMPTY_FIGURE_EDGES) : EMPTY_FIGURE_EDGES;
    this.applyPointHighlight();
    this.applyEdgeHighlight(this.lastHoverIndex);
  }

  /**
   * Positions the camera along its fixed viewing direction (or, in 2D, straight down the z axis —
   * see `applyCameraMode`) at `distance` from `centroid` (or the graph's currently-tracked
   * `centroid` field if omitted). Called once when a fresh graph loads, so small vaults open
   * framed close-up instead of adrift in empty space — never during a Force/Constellation switch,
   * which per docs/CONSTELLATION.md must leave the camera untouched. Cancels any in-flight 2D/3D
   * camera ease: this is an authoritative reframe, so it should win outright rather than fight a
   * transition mid-flight.
   *
   * `centroid` should be passed explicitly on initial load: at that moment `updatePositions` has
   * only ever run against the entrance reveal's bunched starting positions (see
   * `GraphView3D`'s initial-load effect), so `this.centroid` is still near the origin rather than
   * where the just-computed target layout actually sits. The caller passes the target layout's own
   * centroid instead so the very first frame is already aimed at the real content.
   */
  frameCamera(distance: number, centroid?: readonly [number, number, number]): void {
    this.cameraDistance = distance;
    this.cameraTransition = null;
    if (centroid) this.centroid.set(centroid[0], centroid[1], centroid[2]);
    const direction = this.dimension === "2d" ? new THREE.Vector3(0, 0, 1) : this.cameraDirection;
    this.camera.position.copy(this.centroid).addScaledVector(direction, distance);
    this.controls.target.copy(this.centroid);
    this.controls.update();
  }

  /** Fit only on entering 2D; ordinary re-settles leave the user's zoom/pan alone. */
  fitPlanar(positions: Float32Array): void {
    if (this.dimension !== "2d" || positions.length === 0 || this.interacting) return;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for (let i=0;i<positions.length;i+=3) {
      minX=Math.min(minX,positions[i]);maxX=Math.max(maxX,positions[i]);
      minY=Math.min(minY,positions[i+1]);maxY=Math.max(maxY,positions[i+1]);
    }
    const tan=Math.tan(this.camera.fov*Math.PI/360);
    const distance=Math.min(9500,Math.max(460,Math.max((maxY-minY+100)/(2*tan),(maxX-minX+100)/(2*tan*this.camera.aspect))*1.18));
    const target=new THREE.Vector3((minX+maxX)/2,(minY+maxY)/2,0);
    this.camera.far=Math.max(5000,distance*3);this.camera.updateProjectionMatrix();
    this.cameraTransition={fromPos:this.camera.position.clone(),toPos:target.clone().add(new THREE.Vector3(0,0,distance)),fromTarget:this.controls.target.clone(),toTarget:target,startMs:performance.now()};
  }

  /**
   * Starts the initial-load "opening" reveal: stars and edges ramp from near-invisible up to full
   * brightness/size over `durationMs`, in lockstep with `GraphView3D`'s own `LayoutTransition` that
   * bursts node positions outward from a bunched point near the origin to their real layout (see
   * the initial-load effect in GraphView3D.tsx) — together they read as the sky being born, rather
   * than a vault's graph just popping into view fully formed. `render()` advances the ramp every
   * frame while active; call once, right after the first `setTopology`/`updatePositions`.
   */
  startEntrance(nowMs: number, durationMs: number = ENTRANCE_DURATION_MS): void {
    this.entranceActive = true;
    this.entranceStartMs = nowMs;
    this.entranceDurationMs = durationMs;
    this.pointsMaterial.uniforms.uEntrance.value = 0;
    this.entranceOpacityFactor = 0;
    this.recomputeLineOpacity();
  }

  /** Disabled while dragging/link-dragging a star, so orbiting the camera and repositioning a
   * node never fight over the same pointer gesture. Also gates auto-rotate/sway the same way an
   * OrbitControls 'start'/'end' pair would, since this drag never touches OrbitControls itself. */
  setControlsEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
    if (enabled) this.markInteractionEnd();
    else this.markInteractionStart();
  }

  private markInteractionStart(): void {
    this.interacting = true;
    this.idle = false;
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private markInteractionEnd(): void {
    this.interacting = false;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.idle = true;
      // Resume sway from a fresh dt baseline instead of one stale by the whole idle wait, which
      // would otherwise show up as one big jump on the very next swaying frame.
      this.swayLastMs = null;
    }, IDLE_RESUME_MS);
  }

  /**
   * The one entry point GraphView3D calls whenever `graphDimension`, `graphMode`, or
   * `graphAnimating` changes. Updates the OrbitControls flags for the new dimension/mode and, only
   * when the *dimension* actually changed, eases the camera to (2D) or from (3D) the face-on
   * position over `CAMERA_EASE_MS` — switching Force↔Constellation alone never moves the camera,
   * matching docs/CONSTELLATION.md. Auto-rotate/sway themselves are recomputed every frame in
   * `render()` from the flags set here plus idle/interacting state.
   */
  applyCameraMode(dimension: GraphDimension, mode: CameraPresentationMode, animating: boolean): void {
    const dimensionChanged = dimension !== this.dimension;
    this.dimension = dimension;
    this.pointsMaterial.uniforms.uMinSize.value = dimension === "2d" ? 6 : 0;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dimension === "2d" ? 20000 : FOG_NEAR;
    fog.far = dimension === "2d" ? 40000 : FOG_FAR;
    this.pointsMaterial.uniforms.fogNear.value = fog.near;
    this.pointsMaterial.uniforms.fogFar.value = fog.far;
    this.controls.maxDistance = dimension === "2d" ? 10000 : CAMERA_MAX_DISTANCE;
    if (dimensionChanged) this.applyEdgeHighlight(this.lastHoverIndex);
    this.presentationMode = mode;
    this.animating = animating;

    // 2D locks to a true flat pan+zoom: orbiting a flat plane from an angle still reveals it's a
    // 3D scene (perspective foreshortening), which read as "still feels like 3D" — so rotation is
    // off entirely here, not just constrained. Panning is pinned to the plane in `render()`.
    this.controls.enableRotate = dimension !== "2d";
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    if (dimension === "2d") this.controls.autoRotate = false;

    // OrbitControls' left mouse button defaults to ROTATE — with rotate disabled in 2D that leaves
    // a left-drag on empty space doing nothing at all, since PAN stays mapped to the right button
    // only. Remap left-drag to PAN in 2D (dragging empty space moves the view, like Obsidian's flat
    // graph) and back to ROTATE in 3D, where orbiting is the primary way to move the camera; 3D pan
    // remains reachable via the right button/middle-drag, unchanged.
    this.controls.mouseButtons.LEFT = dimension === "2d" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.controls.touches.ONE = dimension === "2d" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;

    if (dimensionChanged) {
      const distance = Math.max(
        this.controls.minDistance,
        this.camera.position.distanceTo(this.controls.target),
      );
      const toPos =
        dimension === "2d"
          ? new THREE.Vector3(0, 0, distance)
          : this.cameraDirection.clone().multiplyScalar(distance);
      this.cameraTransition = {
        fromPos: this.camera.position.clone(),
        toPos,
        fromTarget: this.controls.target.clone(),
        toTarget: new THREE.Vector3(0, 0, 0),
        startMs: performance.now(),
      };
    }
  }

  /** Advances the in-flight 2D/3D camera ease, if any. Returns whether one is still running. */
  private stepCameraTransition(nowMs: number): boolean {
    const t = this.cameraTransition;
    if (!t) return false;
    const progress = Math.min(1, (nowMs - t.startMs) / CAMERA_EASE_MS);
    const eased = easeInOutCubic(progress);
    this.camera.position.lerpVectors(t.fromPos, t.toPos, eased);
    this.controls.target.lerpVectors(t.fromTarget, t.toTarget, eased);
    if (progress >= 1) this.cameraTransition = null;
    return true;
  }

  /** Idle-only easing of `controls.target` toward the graph `centroid` — see that field's doc
   * comment for why (pan displaces the pivot, autoRotate then orbits the displaced point). Uses
   * the same idle gate as autoRotate/sway so it never fights an in-progress pan or star-drag
   * (`setControlsEnabled(false)` sets `interacting`), and is skipped during a 2D/3D camera ease or
   * the initial entrance reveal, both of which already own `target` for their own animation. 2D is
   * excluded entirely: panning is the primary way to move around there, and recentering would just
   * undo it. Frame-rate independent via exponential decay rather than a fixed per-frame step. */
  private recenterTarget(nowMs: number): void {
    const shouldRecenter =
      this.dimension === "3d" && this.idle && !this.interacting && !this.entranceActive;
    if (!shouldRecenter) {
      this.recenterLastMs = null;
      return;
    }
    const dt = this.recenterLastMs === null ? 0 : Math.min(0.1, (nowMs - this.recenterLastMs) / 1000);
    this.recenterLastMs = nowMs;
    if (dt === 0) return;
    if (this.controls.target.distanceTo(this.centroid) < RECENTER_EPSILON) return;
    this.controls.target.lerp(this.centroid, 1 - Math.exp(-dt * RECENTER_RATE));
  }

  /** 3D Constellation's idle-only azimuth sway — a gentle ±`SWAY_AMPLITUDE_RAD` oscillation around
   * the face-on direction, keeping the polar angle fixed so the asterism and its labels stay
   * legible (a full orbit would show the dome from behind with mirrored labels). Sets the camera
   * position directly, the same way `frameCamera` does; OrbitControls picks it back up as its new
   * baseline on the next `update()` since nothing here touches its internal spherical delta. */
  private updateConstellationSway(nowMs: number): void {
    const shouldSway =
      this.dimension === "3d" &&
      this.presentationMode === "constellation" &&
      this.animating &&
      this.idle &&
      !this.interacting;
    if (!shouldSway) {
      this.swayLastMs = null;
      return;
    }
    const dt = this.swayLastMs === null ? 0 : (nowMs - this.swayLastMs) / 1000;
    this.swayLastMs = nowMs;
    this.swayPhase += dt * ((2 * Math.PI) / SWAY_PERIOD_S);

    const theta = this.swayBaseTheta + Math.sin(this.swayPhase) * SWAY_AMPLITUDE_RAD;
    const distance = Math.max(
      this.controls.minDistance,
      this.camera.position.distanceTo(this.controls.target),
    );
    this.swayVector.setFromSphericalCoords(distance, this.swayBasePhi, theta);
    this.camera.position.copy(this.controls.target).add(this.swayVector);
  }

  /** Test/debug snapshot of camera/controls state — see `window.__graph3d` in GraphView3D.tsx;
   * never used by product code. */
  getCameraDebug(): {
    dimension: GraphDimension;
    position: [number, number, number];
    target: [number, number, number];
    azimuth: number;
    polar: number;
    distance: number;
    autoRotate: boolean;
    enableRotate: boolean;
  } {
    return {
      dimension: this.dimension,
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
      azimuth: this.controls.getAzimuthalAngle(),
      polar: this.controls.getPolarAngle(),
      distance: this.controls.getDistance(),
      autoRotate: this.controls.autoRotate,
      enableRotate: this.controls.enableRotate,
    };
  }

  setQuality(settings: QualitySettings): void {
    this.labelCount = settings.labelCount;
    this.twinkleEnabled = settings.twinkle;
    // What the quality tier *wants*; density can still overrule it (see `recomputeDensity`), so it
    // is remembered rather than applied straight to the material and lost.
    this.additiveEdgesRequested = settings.edgeGlow;
    this.linesMaterial.blending =
      settings.edgeGlow && this.edgeCountForDensity <= EDGE_ADDITIVE_CEILING
        ? THREE.AdditiveBlending
        : THREE.NormalBlending;
    if (settings.dprCap !== this.dprCap) {
      this.dprCap = settings.dprCap;
      this.applySize();
    }
  }

  /** Display section's "Node size" slider — a uniform multiplier on every star's point size (see
   * `uSizeMult` in `POINT_VERTEX`). 1.0 (the default) reproduces the pre-Phase-18 size exactly. */
  setNodeSizeMult(mult: number): void {
    this.pointsMaterial.uniforms.uSizeMult.value = mult;
  }

  /**
   * Display section's "Link thickness" slider. WebGL's `lineWidth` is clamped to 1px by most
   * drivers (ANGLE on Windows, and effectively everywhere on ES contexts) regardless of the value
   * passed here, so `linesMaterial.linewidth` is set as a harmless best-effort but the *visible*
   * proxy for thickness is edge brightness: both the material's overall opacity and each edge's
   * per-vertex color intensity (via `applyEdgeHighlight`'s `mult`) scale with `mult`.
   */
  setLinkThickness(mult: number): void {
    this.linkThicknessMult = mult;
    this.linesMaterial.linewidth = mult;
    this.recomputeLineOpacity();
    this.applyEdgeHighlight(this.lastHoverIndex);
  }

  /** Combines the Display section's "Link thickness" slider with the entrance-reveal ramp (both
   * multiplicative on `EDGE_BASE_OPACITY`) into `linesMaterial`'s single opacity value — called
   * whenever either factor changes, so neither overwrites the other's effect. */
  private recomputeLineOpacity(): void {
    this.linesMaterial.opacity = Math.min(
      1,
      Math.max(0.04, EDGE_BASE_OPACITY * this.linkThicknessMult * this.entranceOpacityFactor * this.edgeDensityFactor),
    );
  }

  /**
   * Rescales how loud the graph is drawn for how much of it there is. Inverse-square-root, so
   * brightness falls off gently rather than stepping: doubling the edge count dims each edge by
   * ~30%, which is roughly what keeps total on-screen luminance flat while the overlaps pile up.
   * Floors stop a sparse vault from being dimmed for no reason, and a hard lower bound stops a
   * huge one from fading to nothing.
   */
  private recomputeDensity(nodeCount: number, edgeCount: number): void {
    this.edgeCountForDensity = edgeCount;
    this.edgeDensityFactor = Math.max(0.25, Math.min(1, Math.sqrt(EDGE_DENSITY_FLOOR / Math.max(1, edgeCount))));
    this.labelDensityFactor = Math.max(0.15, Math.min(1, Math.sqrt(LABEL_DENSITY_FLOOR / Math.max(1, nodeCount))));
    // Past the ceiling, no per-line opacity can save additive blending from summing to white.
    this.linesMaterial.blending =
      edgeCount > EDGE_ADDITIVE_CEILING ? THREE.NormalBlending : this.additiveEdgesRequested ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.linesMaterial.needsUpdate = true;
    this.recomputeLineOpacity();
  }

  /** Display section's "Text fade" slider — a multiplier on the label-density budget
   * `AdaptiveQuality` otherwise sets via `setQuality`'s `labelCount`, applied in `updateLabels`.
   * 1.0 (the default) reproduces the pre-Phase-18 label count exactly. */
  setLabelDensity(mult: number): void {
    this.labelDensityMult = mult;
  }

  /** Display section's "Arrows" toggle — shows/hides the pooled arrowhead layer (see the
   * `arrowsMesh` fields above). `render` rebuilds the triangles every frame while visible, so
   * there's nothing to recompute here. */
  setArrowsEnabled(enabled: boolean): void {
    this.arrowsMesh.visible = enabled;
  }

  /**
   * Per-node opacity multiplier (0..1) from the Filters section — search dims non-matching stars,
   * "Show orphans"/"Existing notes only" dim degree-0/ghost stars near-to-invisible when off.
   * Filtered-out nodes stay in the simulation and stay pickable (per the Phase 18 plan: "dim,
   * don't hard-remove") — only their visual brightness changes. Combined multiplicatively with
   * hover highlighting (not overwritten by it) in `applyPointHighlight`/`applyEdgeHighlight`, and
   * an edge dims to the dimmer of its two endpoints.
   */
  setFilterDim(nodeDim: Float32Array): void {
    this.filterDim = nodeDim;
    this.applyPointHighlight();
    this.applyEdgeHighlight(this.lastHoverIndex);
  }

  resize(width: number, height: number): void {
    this.lastWidth = width;
    this.lastHeight = height;
    this.applySize();
  }

  private applySize(): void {
    if (this.lastWidth === 0 || this.lastHeight === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.lastWidth, this.lastHeight, false);
    this.camera.aspect = this.lastWidth / this.lastHeight;
    this.camera.updateProjectionMatrix();
    this.pointsMaterial.uniforms.uPixelRatio.value = dpr;
    this.pointsMaterial.uniforms.uSizeScale.value =
      this.lastHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360));

    this.labelCanvas.width = this.lastWidth * dpr;
    this.labelCanvas.height = this.lastHeight * dpr;
    this.labelCanvas.style.width = `${this.lastWidth}px`;
    this.labelCanvas.style.height = `${this.lastHeight}px`;
    this.labelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Writes new node positions into the GPU buffers (and recomputes edge endpoints from them). */
  updatePositions(positions: Float32Array): void {
    const posAttr = this.pointsGeometry.getAttribute("position") as THREE.BufferAttribute;
    (posAttr.array as Float32Array).set(positions);
    posAttr.needsUpdate = true;
    this.pointsGeometry.computeBoundingSphere();

    // Refresh the recentering pivot (see `centroid`'s doc comment) — cheap sum/n over the same
    // buffer, no allocation.
    const nodeCount = positions.length / 3;
    if (nodeCount > 0) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let i = 0; i < nodeCount; i++) {
        sx += positions[i * 3];
        sy += positions[i * 3 + 1];
        sz += positions[i * 3 + 2];
      }
      this.centroid.set(sx / nodeCount, sy / nodeCount, sz / nodeCount);
    }

    const topology = this.topology;
    if (!topology) return;
    const edgeAttr = this.linesGeometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = edgeAttr.array as Float32Array;
    for (let i = 0; i < topology.edges.length; i++) {
      const { a, b } = topology.edges[i];
      const o = i * 6;
      arr[o] = positions[a * 3];
      arr[o + 1] = positions[a * 3 + 1];
      arr[o + 2] = positions[a * 3 + 2];
      arr[o + 3] = positions[b * 3];
      arr[o + 4] = positions[b * 3 + 1];
      arr[o + 5] = positions[b * 3 + 2];
    }
    edgeAttr.needsUpdate = true;

    if (this.syntheticEdgePairs.length > 0) {
      const synAttr = this.syntheticEdgesGeometry.getAttribute("position") as THREE.BufferAttribute;
      const synArr = synAttr.array as Float32Array;
      for (let i = 0; i < this.syntheticEdgePairs.length; i++) {
        const [a, b] = this.syntheticEdgePairs[i];
        const o = i * 6;
        // Constellation's guide-line pairs are shape geometry, computed independent of the
        // Filters section's `filterDim` — a pair can touch a node "Existing notes only" just
        // dimmed to ~3% (ghost ring). `syntheticEdgesMaterial` has no per-vertex alpha (a single
        // flat color/opacity), so collapse to a zero-length degenerate segment instead of drawing
        // a stray line to a node that's supposed to read as gone.
        if ((this.filterDim[a] ?? 1) < 0.05 || (this.filterDim[b] ?? 1) < 0.05) {
          synArr.fill(0, o, o + 6);
          continue;
        }
        synArr[o] = positions[a * 3];
        synArr[o + 1] = positions[a * 3 + 1];
        synArr[o + 2] = positions[a * 3 + 2];
        synArr[o + 3] = positions[b * 3];
        synArr[o + 4] = positions[b * 3 + 1];
        synArr[o + 5] = positions[b * 3 + 2];
      }
      synAttr.needsUpdate = true;
    }
  }

  /** Normalized device coords for a client point, or null if the canvas has no layout yet. */
  private ndc(clientX: number, clientY: number): THREE.Vector2 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
  }

  /** Raycast against the star field; returns the nearest node index within the pick threshold, or null. */
  pick(clientX: number, clientY: number): number | null {
    const ndc = this.ndc(clientX, clientY);
    if (!ndc) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.points, false);
    return hits.length > 0 ? (hits[0].index ?? null) : null;
  }

  /** Raycast against edges; returns the nearest topology edge index within the pick threshold, or
   * null. Skips edges with a filtered-out (invisible) endpoint, and (Constellation Mode only) a
   * cross-constellation edge, since `applyEdgeHighlight` hides both the same way (zero alpha) — a
   * fully-invisible edge can't intercept a click/hover meant for whatever's behind it, falling
   * through to the next-nearest hit (or the next edge/node) instead. */
  pickEdge(clientX: number, clientY: number): number | null {
    const ndc = this.ndc(clientX, clientY);
    if (!ndc) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.lines, false);
    const topology = this.topology;
    for (const hit of hits) {
      if (hit.index === undefined) continue;
      // LineSegments raycasting reports the start vertex index of the hit segment; each edge
      // owns exactly 2 vertices (see updatePositions), so dividing recovers the edge index.
      const edgeIndex = Math.floor(hit.index / 2);
      if (!topology) return edgeIndex;
      const { a, b } = topology.edges[edgeIndex];
      if ((this.filterDim[a] ?? 1) < 0.05 || (this.filterDim[b] ?? 1) < 0.05) continue;
      const clusterOf = this.constellationClusterOf;
      if (clusterOf && clusterOf[a] !== clusterOf[b]) continue;
      return edgeIndex;
    }
    return null;
  }

  /**
   * Intersects the pointer ray with a camera-facing plane through `point` —
   * the drag/link-drag primitive from docs/WORKSPACE-3D.md ("drag on a
   * camera-facing plane through the node"). Returns null only if the canvas
   * has no layout yet or the ray is exactly parallel to the plane.
   */
  raycastPlaneThroughPoint(clientX: number, clientY: number, point: [number, number, number]): [number, number, number] | null {
    const ndc = this.ndc(clientX, clientY);
    if (!ndc) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    this.camera.getWorldDirection(this.cameraForward);
    this.raycastPlane.setFromNormalAndCoplanarPoint(this.cameraForward, new THREE.Vector3(...point));
    const hit = this.raycaster.ray.intersectPlane(this.raycastPlane, this.raycastHit);
    return hit ? [hit.x, hit.y, hit.z] : null;
  }

  /** Same as `raycastPlaneThroughPoint`, anchored at the orbit target — the depth used for
   * "empty space" gestures (double-click, shift-drag-to-empty) that have no node to anchor to. */
  raycastPlaneAtTarget(clientX: number, clientY: number): [number, number, number] | null {
    const t = this.controls.target;
    return this.raycastPlaneThroughPoint(clientX, clientY, [t.x, t.y, t.z]);
  }

  /** Shows (or hides, passing nulls) the shift-drag link preview: a line from `from` to `to`
   * plus a small glow at the cursor end, tinted `color` (a `--color-accent-*` hex). */
  setPreviewLine(from: [number, number, number] | null, to: [number, number, number] | null, color?: string): void {
    if (!from || !to) {
      this.previewLine.visible = false;
      this.previewGlow.visible = false;
      return;
    }
    const posAttr = this.previewLineGeometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    arr[0] = from[0];
    arr[1] = from[1];
    arr[2] = from[2];
    arr[3] = to[0];
    arr[4] = to[1];
    arr[5] = to[2];
    posAttr.needsUpdate = true;
    this.previewLineGeometry.computeBoundingSphere();
    if (color) {
      const [r, g, b] = hexToRgb01(color);
      this.previewLineMaterial.color.setRGB(r, g, b);
      this.previewGlowMaterial.color.setRGB(r, g, b);
    }
    this.previewGlow.position.set(to[0], to[1], to[2]);
    this.previewLine.visible = true;
    this.previewGlow.visible = true;
  }

  /** Marks which nodes show the pinned ring — see docs/WORKSPACE-3D.md's "Pinned stars". */
  setPinned(indices: ReadonlySet<number>): void {
    const attr = this.pointsGeometry.getAttribute("aPinned") as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = indices.has(i) ? 1 : 0;
    attr.needsUpdate = true;
  }

  /** Marks the one selected star (or clears it, given null) — the ring Delete/Backspace acts on. */
  setSelected(index: number | null): void {
    if (index === this.lastSelectedIndex) return;
    this.lastSelectedIndex = index;
    const attr = this.pointsGeometry.getAttribute("aSelected") as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    arr.fill(0);
    if (index !== null) arr[index] = 1;
    attr.needsUpdate = true;
  }

  setHover(index: number | null): void {
    if (index === this.lastHoverIndex) return;
    this.lastHoverIndex = index;
    if (!this.topology) return;
    this.applyPointHighlight();
    this.applyEdgeHighlight(index);
  }

  /** Recomputes `aHighlight` from the current hover index (`lastHoverIndex`) combined
   * (multiplied, not overwritten) with the Filters section's per-node `filterDim` and Constellation
   * Mode's uniform brightness boost (`constellationClusterOf` non-null — see
   * `setConstellationEmphasis`) — called on every hover change, every `setFilterDim`, and every
   * `setConstellationEmphasis`, so whichever changed last, all three stay reflected. */
  private applyPointHighlight(): void {
    const topology = this.topology;
    if (!topology) return;
    const highlightAttr = this.pointsGeometry.getAttribute("aHighlight") as THREE.BufferAttribute | undefined;
    if (!highlightAttr) return;
    const arr = highlightAttr.array as Float32Array;
    const index = this.lastHoverIndex;
    const neighbors = index !== null ? new Set(topology.neighbors[index]) : null;
    const constellationMult = this.constellationClusterOf ? CONSTELLATION_NODE_MULT : 1;
    for (let i = 0; i < arr.length; i++) {
      const base = index === null ? 1 : i === index ? 1.35 : neighbors?.has(i) ? 1.1 : 0.16;
      arr[i] = base * (this.filterDim[i] ?? 1) * constellationMult;
    }
    highlightAttr.needsUpdate = true;
  }

  /** Recomputes edge (and arrowhead) colors from hover + the Filters section's `filterDim` (an
   * edge dims to the dimmer of its two endpoints) + the Display section's `linkThicknessMult`.
   * Called on hover change, `setFilterDim`, and `setLinkThickness`. Unlike a filtered-out star
   * (dimmed to ~3% but left in the simulation and clickable — see `setFilterDim`'s "dim, don't
   * hard-remove" note), an edge touching one gets zeroed outright — but as vertex ALPHA, not RGB:
   * multiplying visibility into color used to bottom out at (0,0,0), which is invisible only under
   * AdditiveBlending (dark background adds nothing) and rendered as a solid black line once
   * `setQuality` drops to `NormalBlending` (mid/low tiers' `edgeGlow: false`) — exactly the light
   * theme regression. Real per-vertex alpha (both `linesGeometry`/`arrowsGeometry`'s "color"
   * attributes are RGBA now) hides the edge under either blending mode. Hover brightening stays in
   * RGB, matching the pre-existing look. Constellation Mode reuses this same alpha-zeroing
   * mechanism for a cross-constellation edge (see `CONSTELLATION_EDGE_SAME_MULT`'s doc comment for
   * why hidden rather than dimmed) — `pickEdge` mirrors the same condition so an invisible edge
   * can't still be clicked/unlinked. */
  private applyEdgeHighlight(index: number | null): void {
    const topology = this.topology;
    if (!topology) return;
    const colorAttr = this.linesGeometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    const arrowColorAttr = this.arrowsGeometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!colorAttr) return;
    const arr = colorAttr.array as Float32Array;
    const arrowArr = arrowColorAttr?.array as Float32Array | undefined;
    const clusterOf = this.constellationClusterOf;
    for (let i = 0; i < topology.edges.length; i++) {
      const { a, b } = topology.edges[i];
      const touches = index !== null && (a === index || b === index);
      const hoverMult = index === null ? 1 : touches ? 1.8 : 0.08;
      const aDim = this.filterDim[a] ?? 1;
      const bDim = this.filterDim[b] ?? 1;
      const crossConstellation = clusterOf !== null && clusterOf[a] !== clusterOf[b];
      const filterMult = crossConstellation || aDim < 0.05 || bDim < 0.05 ? 0 : Math.min(aDim, bDim);
      // Constellation Mode only (clusterOf null otherwise, see setConstellationEmphasis). Three
      // tiers, not two: an edge that traces the drawn figure is the constellation and gets the full
      // boost; a same-constellation edge that doesn't is real information the user may still want,
      // but a dozen of them crossing a figure is what turned Orion into a scribble on a real vault,
      // so it stays faint; a cross-constellation edge is hidden outright via filterMult above, so
      // its RGB multiplier here is moot (alpha 0 either way).
      const constellationMult = !clusterOf
        ? 1
        : crossConstellation
          ? 1
          : this.figureEdgeKeys.has(figureEdgeKey(a, b))
            ? CONSTELLATION_EDGE_SAME_MULT
            : CONSTELLATION_EDGE_OFF_FIGURE_MULT;
      const mult = hoverMult * this.linkThicknessMult * constellationMult;
      const o = i * 6; // edgeBaseColors: 2 verts * 3 comps (RGB)
      const attrO = i * 8; // color attribute: 2 verts * 4 comps (RGBA)
      for (let v = 0; v < 2; v++) {
        arr[attrO + v * 4] = this.edgeBaseColors[o + v * 3] * mult;
        arr[attrO + v * 4 + 1] = this.edgeBaseColors[o + v * 3 + 1] * mult;
        arr[attrO + v * 4 + 2] = this.edgeBaseColors[o + v * 3 + 2] * mult;
        arr[attrO + v * 4 + 3] = filterMult;
      }

      if (arrowArr) {
        const arrowIndex = this.arrowIndexByEdge[i];
        if (arrowIndex >= 0) {
          const ao = arrowIndex * 12; // 3 verts * 4 comps
          for (let v = 0; v < 3; v++) {
            arrowArr[ao + v * 4] = this.edgeBaseColors[o] * mult;
            arrowArr[ao + v * 4 + 1] = this.edgeBaseColors[o + 1] * mult;
            arrowArr[ao + v * 4 + 2] = this.edgeBaseColors[o + 2] * mult;
            arrowArr[ao + v * 4 + 3] = filterMult;
          }
        }
      }
    }
    colorAttr.needsUpdate = true;
    if (arrowColorAttr) arrowColorAttr.needsUpdate = true;
  }

  /**
   * Rebuilds every edge's arrowhead triangle from the current node positions (read straight off
   * `pointsGeometry`'s position attribute, so no positions param is needed — see
   * `updatePositions`). Each triangle's apex sits just outside the target star's radius, pointing
   * back along the edge; its base is billboarded (perpendicular to both the edge and the direction
   * to the camera) so the head always presents face-on instead of collapsing to a sliver, and it is
   * sized in screen pixels rather than world units. No-op with zero edges.
   */
  private updateArrows(): void {
    const topology = this.topology;
    if (!topology || this.arrowEdgeIndices.length === 0) return;
    const posAttr = this.pointsGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const arrowPosAttr = this.arrowsGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr || !arrowPosAttr) return;
    const positions = posAttr.array as Float32Array;
    const arr = arrowPosAttr.array as Float32Array;
    // World units per screen pixel at camera distance 1 — the same projection factor the star
    // shader uses (see `applySize`), inverted here.
    const pxScale = this.pointsMaterial.uniforms.uSizeScale.value as number;
    const cam = this.camera.position;

    for (let j = 0; j < this.arrowEdgeIndices.length; j++) {
      const { a, b } = topology.edges[this.arrowEdgeIndices[j]];
      const ax = positions[a * 3];
      const ay = positions[a * 3 + 1];
      const az = positions[a * 3 + 2];
      const bx = positions[b * 3];
      const by = positions[b * 3 + 1];
      const bz = positions[b * 3 + 2];
      this.arrowDir.set(bx - ax, by - ay, bz - az);
      const dist = this.arrowDir.length();
      const o = j * 9;
      if (dist < 1e-4) {
        arr.fill(0, o, o + 9);
        continue;
      }
      this.arrowDir.multiplyScalar(1 / dist);

      const targetRadius = starSize(topology.nodes[b].degree) + 3;
      const tipDist = Math.min(dist, Math.max(0, dist - targetRadius));
      this.arrowTip.set(ax + this.arrowDir.x * tipDist, ay + this.arrowDir.y * tipDist, az + this.arrowDir.z * tipDist);

      const worldPerPx = Math.max(this.arrowTip.distanceTo(cam), 1e-3) / pxScale;
      const length = Math.min(ARROW_PX_LENGTH * worldPerPx, dist * ARROW_MAX_EDGE_FRACTION);
      const halfWidth = length * (ARROW_PX_HALF_WIDTH / ARROW_PX_LENGTH);

      this.arrowBase.set(
        this.arrowTip.x - this.arrowDir.x * length,
        this.arrowTip.y - this.arrowDir.y * length,
        this.arrowTip.z - this.arrowDir.z * length,
      );
      this.arrowToCam.subVectors(cam, this.arrowTip);
      this.arrowPerp.crossVectors(this.arrowDir, this.arrowToCam);
      if (this.arrowPerp.lengthSq() < 1e-10) {
        this.arrowPerp.crossVectors(this.arrowDir, Math.abs(this.arrowDir.y) < 0.98 ? ARROW_REF_UP : ARROW_REF_SIDE);
      }
      this.arrowPerp.normalize().multiplyScalar(halfWidth);

      arr[o] = this.arrowTip.x;
      arr[o + 1] = this.arrowTip.y;
      arr[o + 2] = this.arrowTip.z;
      arr[o + 3] = this.arrowBase.x + this.arrowPerp.x;
      arr[o + 4] = this.arrowBase.y + this.arrowPerp.y;
      arr[o + 5] = this.arrowBase.z + this.arrowPerp.z;
      arr[o + 6] = this.arrowBase.x - this.arrowPerp.x;
      arr[o + 7] = this.arrowBase.y - this.arrowPerp.y;
      arr[o + 8] = this.arrowBase.z - this.arrowPerp.z;
    }
    arrowPosAttr.needsUpdate = true;
  }

  /** Advances damping/time uniforms and draws one frame. `nowSec` should be a continuously increasing seconds clock. */
  render(nowSec: number): void {
    const nowMs = nowSec * 1000;
    this.pointsMaterial.uniforms.uTime.value = nowSec;
    this.pointsMaterial.uniforms.uTwinkle.value = this.twinkleEnabled ? 1 : 0;

    if (this.entranceActive) {
      const t = Math.min(1, (nowMs - this.entranceStartMs) / this.entranceDurationMs);
      const eased = easeInOutCubic(t);
      this.pointsMaterial.uniforms.uEntrance.value = eased;
      this.entranceOpacityFactor = eased;
      this.recomputeLineOpacity();
      if (t >= 1) this.entranceActive = false;
    }

    if (this.constellationLabelSprites.some((s) => s.visible)) {
      const t = Math.min(1, (nowMs - this.constellationLabelFadeStart) / CONSTELLATION_LABEL_FADE_MS);
      const opacity = Math.max(0, t) * CONSTELLATION_LABEL_OPACITY;
      for (const sprite of this.constellationLabelSprites) {
        if (sprite.visible) (sprite.material as THREE.SpriteMaterial).opacity = opacity;
      }
    }

    // A 2D/3D camera ease takes priority over — and suppresses — auto-rotate/sway, so the
    // transition never fights OrbitControls damping (see `applyCameraMode`).
    const transitioning = this.stepCameraTransition(nowMs);
    if (!transitioning) {
      this.recenterTarget(nowMs);
      this.updateConstellationSway(nowMs);
    } else {
      this.swayLastMs = null;
      this.recenterLastMs = null;
    }
    this.controls.autoRotate =
      !transitioning &&
      this.dimension === "3d" &&
      this.presentationMode === "force" &&
      this.animating &&
      this.idle &&
      !this.interacting;

    this.controls.update();
    // 2D keeps movement on the graph's plane: the orbit pivot is pinned to z=0 so panning slides
    // along the (flattened) plane instead of drifting off it along the plane's normal, while
    // rotation around the plane stays free. No-op in 3D, where the camera moves freely in XYZ.
    if (this.dimension === "2d") this.controls.target.z = 0;
    // Arrowheads are billboarded and pixel-sized, so they follow the camera, not just node
    // positions — rebuild them after the controls have settled for this frame.
    if (this.arrowsMesh.visible) this.updateArrows();
    this.renderer.render(this.scene, this.camera);
  }

  /** Projects node `index`'s current position to on-screen client coordinates, or null if it's
   * behind the camera. Test/debug only (see `window.__graph3d` in GraphView3D.tsx) — lets the
   * Playwright verification pass click a specific star by title; never used by product code. */
  projectToScreen(index: number): { x: number; y: number } | null {
    const posAttr = this.pointsGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return null;
    const arr = posAttr.array as Float32Array;
    const v = new THREE.Vector3(arr[index * 3], arr[index * 3 + 1], arr[index * 3 + 2]);
    v.project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (1 - (v.y * 0.5 + 0.5)) * rect.height,
    };
  }

  /** CPU-projected label overlay for the top-N stars by degree (plus the hovered node and its
   * neighbors) — except in Constellation Mode, where note titles are suppressed entirely and the
   * only text on the sky is each constellation's own name and match percentage (drawn as sprites
   * by `setConstellationLabels`, not here). See the `titlesHidden` local below. */
  updateLabels(hoverIndex: number | null): void {
    const ctx = this.labelCtx;
    const width = this.labelCanvas.clientWidth;
    const height = this.labelCanvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    const topology = this.topology;
    if (!topology || width === 0 || height === 0) return;

    // Constellation Mode: a star chart's text is constellation names, not a caption on every star.
    // Dozens of note titles over a figure is precisely what stopped the figures reading as figures.
    // The hovered star keeps its own title and nothing else — with every other label gone it is the
    // only way left to find out which note a given star is, and one label cannot re-clutter the sky.
    const titlesHidden = this.constellationClusterOf !== null;
    if (titlesHidden && hoverIndex === null) return;

    // Display section's "Text fade" slider scales the adaptive-quality label budget; the hovered
    // node and its neighbors are always shown regardless (a hover with zero labels would be
    // confusing), matching the pre-Phase-18 behavior at the slider's 1.0 default.
    // `labelDensityFactor` is the vault-size term; `labelDensityMult` stays the user's own "Text
    // fade" slider, so they can still ask for more (or none) on top of whatever the size implies.
    const effectiveLabelCount = Math.max(
      0,
      Math.round(this.labelCount * this.labelDensityMult * this.labelDensityFactor),
    );
    // Below the count cap every label was always drawn at full opacity regardless of the slider,
    // so a small vault (where the cap never binds) saw no effect at all. Slider range is 0-2: at
    // or below 1 it also scales each label's drawn alpha (0 = fully invisible); above 1 there's
    // nothing left to scale up, so it stays a pure count/no-op like before.
    const labelAlphaMult = Math.min(1, Math.max(0, this.labelDensityMult));
    const candidates: number[] = [];
    const seen = new Set<number>();
    if (hoverIndex !== null) {
      candidates.push(hoverIndex);
      seen.add(hoverIndex);
      // Neighbors are deliberately skipped in Constellation Mode: they are what turns one hover
      // into a paragraph of overlapping text across a figure.
      if (!titlesHidden) {
        for (const nb of topology.neighbors[hoverIndex]) {
          if (!seen.has(nb)) {
            candidates.push(nb);
            seen.add(nb);
          }
        }
      }
    }
    if (!titlesHidden) {
      for (const idx of this.rankedByDegree) {
        if (candidates.length >= effectiveLabelCount) break;
        if (seen.has(idx)) continue;
        candidates.push(idx);
        seen.add(idx);
      }
    }

    const posAttr = this.pointsGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const sizeAttr = this.pointsGeometry.getAttribute("aSize") as THREE.BufferAttribute | undefined;
    if (!posAttr || !sizeAttr) return;
    const positions = posAttr.array as Float32Array;
    const sizes = sizeAttr.array as Float32Array;
    const v = new THREE.Vector3();

    const occupancy = this.dimension === "2d" ? new LabelOccupancy() : null;
    if (occupancy) {
      for (let i = 0; i < topology.nodes.length; i++) {
        if ((this.filterDim[i] ?? 1) < .05) continue;
        v.set(positions[i*3],positions[i*3+1],positions[i*3+2]).project(this.camera);
        if(v.z < -1 || v.z > 1) continue;
        const x=(v.x*.5+.5)*width,y=(1-(v.y*.5+.5))*height;
        const r=Math.max(5, sizes[i]);
        occupancy.add({left:x-r,top:y-r,right:x+r,bottom:y+r});
      }
    }
    ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const idx of candidates) {
      v.set(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]);
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * width;
      const sy = (1 - (v.y * 0.5 + 0.5)) * height;
      if (sx < -40 || sx > width + 40 || sy < -20 || sy > height + 40) continue;
      const node = topology.nodes[idx];
      const dim = this.filterDim[idx] ?? 1;
      if (dim < 0.05) continue;
      ctx.globalAlpha = (idx === hoverIndex ? 1 : 0.82) * dim * labelAlphaMult;
      ctx.fillStyle = node.ghost ? this.theme.muted : this.theme.text;
      // Folder path only on hover — every label carrying it all the time would clutter a busy
      // graph; hovering is already how a star's other details (highlight) surface.
      const label = idx === hoverIndex && node.folder ? `${node.folder}/${node.title}` : node.title;
      if (occupancy) {
        const text = ctx.measureText(label).width > 230 ? label.slice(0, 18) + "…" : label;
        const rect = placeGraphLabel(occupancy,sx,sy,Math.max(5,sizes[idx]),ctx.measureText(text).width,width,height)
          ?? (idx === hoverIndex ? { left: 8, top: height-28, right: Math.min(width-8,ctx.measureText(text).width+16), bottom: height-8 } : null);
        if (!rect) continue;
        // A subdued backing keeps unrelated connecting lines out of the title glyphs.
        ctx.fillStyle=this.theme.background;ctx.fillRect(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);
        ctx.fillStyle=node.ghost?this.theme.muted:this.theme.text;
        ctx.fillText(text,(rect.left+rect.right)/2,rect.top+3);
      } else ctx.fillText(label, sx, sy + sizes[idx] + 4);
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.controls.dispose();
    this.pointsGeometry.dispose();
    this.pointsMaterial.dispose();
    this.linesGeometry.dispose();
    this.linesMaterial.dispose();
    this.syntheticEdgesGeometry.dispose();
    this.syntheticEdgesMaterial.dispose();
    this.arrowsGeometry.dispose();
    this.arrowsMaterial.dispose();
    this.previewLineGeometry.dispose();
    this.previewLineMaterial.dispose();
    this.previewGlowMaterial.dispose();
    this.sprite.dispose();
    for (const sprite of this.constellationLabelSprites) (sprite.material as THREE.SpriteMaterial).dispose();
    for (const texture of this.constellationLabelTextures.values()) texture.dispose();
    this.renderer.dispose();
  }
}
