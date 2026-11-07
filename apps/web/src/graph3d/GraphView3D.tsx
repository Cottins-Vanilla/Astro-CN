import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, SAVE_DEBOUNCE_MS, type GraphFilterSettings, type GraphSettings } from "../store";
import { loadLinkIndex } from "../linkIndex";
import { vaultEvents } from "../events";
import { GraphSettingsPanel } from "../components/GraphSettingsPanel";
import { buildTopology, hashString, mulberry32, type GraphTopology } from "./topology";
import { GraphPhysics } from "./physics";
import { ForceLayout } from "./layouts/force";
import { ConstellationLayout, type ConstellationLabel } from "./layouts/constellation";
import { LayoutTransition } from "./transition";
import { AdaptiveQuality } from "./quality";
import { SceneRenderer, readThemeColors, ENTRANCE_DURATION_MS, type ThemeColors } from "./renderer";

/**
 * Per-node visibility multiplier (0..1) for the Graph settings panel's Filters section — fed
 * straight into `SceneRenderer.setFilterDim`. Search dims titles that don't match (case-
 * insensitive substring); "Show orphans" off dims degree-0 nodes; "Existing notes only" dims
 * ghost (unresolved wiki-link target) nodes. Multiple active filters combine via the minimum, so a
 * node hidden by any one of them stays hidden. See the Phase 18 plan's "dim, don't hard-remove" —
 * filtered-out nodes stay in the simulation and stay clickable, just visually near-invisible.
 */
function computeFilterDim(topology: GraphTopology, filters: GraphFilterSettings): Float32Array {
  const dim = new Float32Array(topology.nodes.length).fill(1);
  const query = filters.search.trim().toLowerCase();
  for (let i = 0; i < topology.nodes.length; i++) {
    const node = topology.nodes[i];
    let visible = 1;
    if (query && !node.title.toLowerCase().includes(query)) visible = Math.min(visible, 0.1);
    if (!filters.orphans && node.degree === 0) visible = Math.min(visible, 0.03);
    if (filters.existingOnly && node.ghost) visible = Math.min(visible, 0.03);
    dim[i] = visible;
  }
  return dim;
}

/** Constellation Mode's rigid-body drag step: translates every listed member by the same (dx, dy,
 * dz), leaving every other node in `positions` untouched — the core of "dragging a star drags its
 * whole constellation" (see onPointerMove's "cluster" drag case), pulled out as a pure function so
 * it's unit-testable without a pointer-event/DOM harness. Mutates `positions` in place, matching
 * every other position-writer in this file (`updatePositions`, physics ticks, …). */
export function translateClusterMembers(positions: Float32Array, members: readonly number[], dx: number, dy: number, dz: number): void {
  for (const m of members) {
    positions[m * 3] += dx;
    positions[m * 3 + 1] += dy;
    positions[m * 3 + 2] += dz;
  }
}

/** Small movement budget before a pointerdown→pointerup is treated as a drag rather than a click. */
const CLICK_DRAG_THRESHOLD = 4;
/** How long to wait, after the vault last changed, before rebuilding topology from an external
 * edit (typing `[[links]]` in the editor, a plugin, an import) — see the "smooth" requirement in
 * docs/WORKSPACE-3D.md. Gestures inside this component refresh immediately instead of waiting.
 * Must exceed the store's note-save debounce, or `refreshTopology`'s `loadLinkIndex()` can read a
 * title/body straight out of IndexedDB before the edit that triggered it has actually landed there. */
const EXTERNAL_REFRESH_DEBOUNCE_MS = SAVE_DEBOUNCE_MS + 200;

type DragState =
  | { kind: "idle" }
  | { kind: "maybe"; nodeIndex: number; startX: number; startY: number }
  | { kind: "node"; nodeIndex: number }
  /** Constellation Mode's drag: the whole figure moves as one rigid body. Dragging a single star
   * out of a constellation would tear apart the very shape this mode exists to draw, so the grabbed
   * star's entire cluster travels with it — `members` is resolved once on grab (membership can't
   * change mid-drag) and `lastPoint` carries the previous frame's world position so each move
   * applies a delta rather than snapping every member onto the cursor. */
  | { kind: "cluster"; nodeIndex: number; members: number[]; lastPoint: [number, number, number] }
  | { kind: "link"; nodeIndex: number };

interface PinPopoverState {
  x: number;
  y: number;
  nodeIndex: number;
}

interface EdgePopoverState {
  x: number;
  y: number;
  edgeIndex: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/** Test/debug hook read by the Playwright verification pass — never used by product code. */
interface Graph3DDebug {
  nodeCount: number;
  mode: string;
  settled: boolean;
  tickCount: number;
  frameCount: number;
  /** On-demand snapshot of current node positions [x0,y0,z0,x1,...] — computed only when called. */
  getPositions: () => number[];
  /** On-demand snapshot of node titles in index order, matching getPositions(). */
  getTitles: () => string[];
  /** Note (or ghost) ids in index order, matching getPositions()/getTitles(). */
  getIds: () => string[];
  /** Ids of every currently-pinned star. */
  getPinnedIds: () => string[];
  /** Screen coordinates for node `index`, or null if off-camera — for clicking a specific star. */
  projectToScreen: (index: number) => { x: number; y: number } | null;
  /** "2d" | "3d" — mirrors `graphDimension`, for Playwright's 2D/3D verification pass. */
  dimension: string;
  /** Camera/OrbitControls snapshot (position, target, azimuth, polar, distance, autoRotate,
   * enableRotate) — see `SceneRenderer.getCameraDebug`. Null before the scene exists. */
  getCamera: () => ReturnType<SceneRenderer["getCameraDebug"]> | null;
  /** Constellation-name labels for the current layout (empty outside Constellation Mode) — see
   * `ConstellationLayout.labels` in docs/CONSTELLATION.md's "Named patterns" section. */
  getConstellationLabels: () => ConstellationLabel[];
}
declare global {
  interface Window {
    __graph3d?: Graph3DDebug;
  }
}

/**
 * The app's main surface: a real 3D force-directed graph in XYZ with an
 * orbit camera, directly editable per docs/WORKSPACE-3D.md — click opens a
 * note, drag pins a star, shift-drag links two notes (or spawns a new one),
 * double-click empty space creates a note, Delete removes the selection, and
 * clicking an edge offers Unlink. Constellation Mode (Ctrl+G) re-lays-out
 * the same graph as a star chart — see docs/CONSTELLATION.md.
 */
export function GraphView3D() {
  const graphMode = useStore((s) => s.graphMode);
  const setGraphMode = useStore((s) => s.setGraphMode);
  const graphDimension = useStore((s) => s.graphDimension);
  const setGraphDimension = useStore((s) => s.setGraphDimension);
  const graphAnimating = useStore((s) => s.graphAnimating);
  const graphSettings = useStore((s) => s.graphSettings);
  const theme = useStore((s) => s.theme);
  const openNote = useStore((s) => s.openNote);
  const openOrCreateNoteByTitle = useStore((s) => s.openOrCreateNoteByTitle);
  const createNote = useStore((s) => s.createNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const moveNote = useStore((s) => s.moveNote);
  const linkNotes = useStore((s) => s.linkNotes);
  const unlinkNotePair = useStore((s) => s.unlinkNotePair);
  const requestTitleFocus = useStore((s) => s.requestTitleFocus);
  const setGraphStats = useStore((s) => s.setGraphStats);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const rendererRef = useRef<SceneRenderer | null>(null);
  const topologyRef = useRef<GraphTopology | null>(null);
  const positionsRef = useRef<Float32Array>(new Float32Array(0));
  const physicsRef = useRef<GraphPhysics | null>(null);
  const fitPlanarPending = useRef(graphDimension === "2d");
  const forceLayoutRef = useRef<ForceLayout | null>(null);
  const constellationLayoutRef = useRef(new ConstellationLayout());
  const transitionRef = useRef<LayoutTransition | null>(null);
  const qualityRef = useRef(new AdaptiveQuality());
  const pinnedIndicesRef = useRef<Set<number>>(new Set());
  const themeColorsRef = useRef<ThemeColors>(readThemeColors());

  const modeRef = useRef(graphMode);
  modeRef.current = graphMode;
  const dimensionRef = useRef(graphDimension);
  dimensionRef.current = graphDimension;
  // Read inside `refreshTopology`/the initial-load effect (both stable-deps callbacks) to
  // re-apply the *current* Forces/Filters to a freshly-swapped physics sim / rebuilt topology —
  // same reason `dimensionRef` exists for `setFlatten`. The live-reactive effects further down
  // read `graphSettings` directly instead, since they re-run on every change anyway.
  const graphSettingsRef = useRef<GraphSettings>(graphSettings);
  graphSettingsRef.current = graphSettings;
  const hoverRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const dragRef = useRef<DragState>({ kind: "idle" });
  const debugRef = useRef<Graph3DDebug>({
    nodeCount: 0,
    mode: graphMode,
    settled: true,
    tickCount: 0,
    frameCount: 0,
    getPositions: () => Array.from(positionsRef.current),
    getTitles: () => (topologyRef.current?.nodes ?? []).map((n) => n.title),
    getIds: () => (topologyRef.current?.nodes ?? []).map((n) => n.id),
    getPinnedIds: () =>
      [...pinnedIndicesRef.current]
        .map((i) => topologyRef.current?.nodes[i]?.id)
        .filter((id): id is string => Boolean(id)),
    projectToScreen: (index) => rendererRef.current?.projectToScreen(index) ?? null,
    dimension: graphDimension,
    getCamera: () => rendererRef.current?.getCameraDebug() ?? null,
    getConstellationLabels: () => constellationLayoutRef.current.labels,
  });

  const [loading, setLoading] = useState(false);
  // Selection drives only the renderer's ring (GPU) and the Delete-key guard, never JSX — a ref
  // avoids a re-render on every star click.
  const selectedIndexRef = useRef<number | null>(null);
  const [pinPopover, setPinPopover] = useState<PinPopoverState | null>(null);
  const [edgePopover, setEdgePopover] = useState<EdgePopoverState | null>(null);

  /**
   * Rebuilds topology from the vault and re-renders it in place: existing
   * nodes keep their live position (no re-scatter, no camera move), a
   * freshly-created node takes `spawn`'s point if given, and anything else
   * new gets a deterministic id-seeded spot. In Constellation Mode this regenerates the asterism with the
   * existing short transition; in Force mode it just reheats. See the
   * "incremental and smooth" requirement in docs/WORKSPACE-3D.md.
   */
  const refreshTopology = useCallback(async (spawn?: { id: string; pos: [number, number, number] }) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const index = await loadLinkIndex();
    const topology = buildTopology(index);
    setGraphStats({ nodeCount: topology.nodes.length, edgeCount: topology.edges.length });
    const oldTopology = topologyRef.current;
    const oldPositions = positionsRef.current;
    const n = topology.nodes.length;
    const positions = new Float32Array(n * 3);

    const oldIndexById = new Map<string, number>();
    oldTopology?.nodes.forEach((node, i) => oldIndexById.set(node.id, i));
    // Nodes with no counterpart in the old topology (a just-created note) — the only ones that
    // should move during this settle; the rest are anchored so the layout doesn't reshuffle.
    const newIndices = new Set<number>();

    // Dropped-pin positions are no longer read or applied here (Phase 16: dragging repositions a
    // star but never freezes it — see docs/WORKSPACE-3D.md; the persisted-pins mechanism itself
    // was removed in Phase 18). `pinnedIndices` stays permanently empty; it's kept only because
    // `GraphPhysics`/`renderer.setPinned` still take a pinned-set parameter.
    const pinnedIndices = new Set<number>();

    for (let i = 0; i < n; i++) {
      const id = topology.nodes[i].id;
      const oldIdx = oldIndexById.get(id);
      if (oldIdx !== undefined) {
        positions[i * 3] = oldPositions[oldIdx * 3];
        positions[i * 3 + 1] = oldPositions[oldIdx * 3 + 1];
        positions[i * 3 + 2] = oldPositions[oldIdx * 3 + 2];
      } else if (spawn && spawn.id === id) {
        newIndices.add(i);
        positions[i * 3] = spawn.pos[0];
        positions[i * 3 + 1] = spawn.pos[1];
        positions[i * 3 + 2] = spawn.pos[2];
      } else {
        newIndices.add(i);
        const rnd = mulberry32(hashString(id));
        positions[i * 3] = (rnd() - 0.5) * 80;
        positions[i * 3 + 1] = (rnd() - 0.5) * 80;
        positions[i * 3 + 2] = (rnd() - 0.5) * 80;
      }
    }

    physicsRef.current?.dispose();
    const physics = new GraphPhysics(topology, positions, pinnedIndices);
    // A topology rebuild swaps in a brand-new sim, so the 2D "flatten" force (see
    // physics.ts's setFlatten) — and the Graph settings panel's Forces sliders — have to be
    // re-applied to it; neither carries over from the disposed sim.
    physics.setFlatten(dimensionRef.current === "2d");
    physics.setForces(graphSettingsRef.current.forces);
    // Incremental update (a note created/deleted/linked, not the first load of this vault) — anchor
    // everything except the genuinely new node(s) so the already-settled layout doesn't reshuffle
    // (see physics.ts's anchorExcept). A first load has no old topology to preserve, so every node
    // is "new" and the full free settle from setForces above stands.
    if (oldTopology && dimensionRef.current !== "2d") physics.anchorExcept(newIndices);
    physicsRef.current = physics;
    forceLayoutRef.current = new ForceLayout(physics);
    topologyRef.current = topology;
    positionsRef.current = positions;
    pinnedIndicesRef.current = pinnedIndices;
    transitionRef.current?.resize(n * 3);
    debugRef.current.nodeCount = n;

    renderer.setTopology(topology, readThemeColors());
    // setTopology resets every node to fully-visible — re-apply the Filters section's current
    // search/orphans/existingOnly state, same reapply-on-rebuild reason as setForces above.
    renderer.setFilterDim(computeFilterDim(topology, graphSettingsRef.current.filters));
    renderer.setPinned(pinnedIndices);
    renderer.setSelected(null);
    selectedIndexRef.current = null;
    setPinPopover(null);
    setEdgePopover(null);

    if (modeRef.current === "constellation") {
      const target = new Float32Array(n * 3);
      constellationLayoutRef.current.generate(topology, positions, target);
      for (const i of pinnedIndices) {
        target[i * 3] = positions[i * 3];
        target[i * 3 + 1] = positions[i * 3 + 1];
        target[i * 3 + 2] = positions[i * 3 + 2];
      }
      transitionRef.current?.start(positions.slice(), target, performance.now());
      renderer.setConstellationLabels(constellationLayoutRef.current.labels, performance.now());
      renderer.setSyntheticEdges(constellationLayoutRef.current.syntheticEdges);
      renderer.setConstellationEmphasis(constellationLayoutRef.current.clusterOf, constellationLayoutRef.current.figureEdgeKeys);
    } else {
      renderer.updatePositions(positions);
      physics.reheat(0.3);
      renderer.setConstellationLabels([], performance.now());
      renderer.setSyntheticEdges([]);
      renderer.setConstellationEmphasis(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads everything it needs through
    // refs and useStore.getState(); the setters it calls are referentially stable.
  }, []);

  // Scene + rAF loop + all direct-manipulation input, for the app's lifetime.
  useEffect(() => {
    const container = containerRef.current;
    const glCanvas = glCanvasRef.current;
    const labelCanvas = labelCanvasRef.current;
    if (!container || !glCanvas || !labelCanvas) return;

    // Constructed with the persisted dimension so a vault saved in 2D opens flat & face-on from
    // frame one, instead of flashing the 3D angled default and then easing to 2D.
    const renderer = new SceneRenderer(glCanvas, labelCanvas, readThemeColors(), dimensionRef.current);
    rendererRef.current = renderer;

    function resize() {
      renderer.resize(container!.clientWidth, container!.clientHeight);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    function frame(now: number) {
      rafRef.current = requestAnimationFrame(frame);
      const topology = topologyRef.current;
      const physics = physicsRef.current;
      const transition = transitionRef.current;
      if (!topology || !physics || !transition) return;

      const frameMs = lastFrameRef.current ? now - lastFrameRef.current : 16.7;
      lastFrameRef.current = now;
      qualityRef.current.update(frameMs);
      renderer.setQuality(qualityRef.current.settings);

      const positions = positionsRef.current;
      let dirty = false;
      if (transition.isActive) {
        dirty = transition.step(now, positions);
      } else if (modeRef.current === "force" && !physics.isSettled) {
        physics.tick();
        forceLayoutRef.current?.generate(topology, positions, positions);
        dirty = true;
        debugRef.current.tickCount++;
      }
      if (dirty) renderer.updatePositions(positions);
      if (fitPlanarPending.current && dimensionRef.current === "2d" && modeRef.current === "force" && physics.isSettled && !transition.isActive) {
        renderer.fitPlanar(positions); fitPlanarPending.current = false;
      }

      renderer.render(now / 1000);
      renderer.updateLabels(hoverRef.current);

      debugRef.current.frameCount++;
      debugRef.current.mode = modeRef.current;
      debugRef.current.dimension = dimensionRef.current;
      // An in-flight transition (including the initial-load entrance reveal) means positions are
      // still animating regardless of mode/physics state — settled must reflect that, or a
      // screenshot/e2e pass polling this flag could snap a photo mid-reveal.
      debugRef.current.settled = !transition.isActive && (modeRef.current === "constellation" || physics.isSettled);
      window.__graph3d = debugRef.current;
    }
    rafRef.current = requestAnimationFrame(frame);

    function updateHover(clientX: number, clientY: number) {
      const idx = renderer.pick(clientX, clientY);
      if (idx !== hoverRef.current) {
        hoverRef.current = idx;
        renderer.setHover(idx);
        if (dragRef.current.kind === "idle") glCanvas!.style.cursor = idx !== null ? "pointer" : "grab";
      }
    }

    async function resolveNoteId(title: string): Promise<string> {
      const existing = useStore.getState().noteList.find((n) => n.title.toLowerCase() === title.toLowerCase());
      if (existing) return existing.id;
      const note = await createNote(title);
      return note.id;
    }

    /** Shift-drag star → empty space: new note, structural link, editor open on the title. Spawns
     * at `pos` (via `refreshTopology`'s `spawn` param) but, like every other star, isn't frozen
     * there — it joins the simulation immediately. */
    async function createLinkedNoteAt(fromId: string, pos: [number, number, number]) {
      const note = await createNote("未命名");
      await linkNotes(fromId, note.id);
      await refreshTopology({ id: note.id, pos });
      requestTitleFocus(note.id);
      await openNote(note.id);
    }

    /** Double-click empty space: new note at that point, editor open on the title, joins the
     * simulation immediately (not frozen there). */
    async function createNoteAtPoint(pos: [number, number, number]) {
      const note = await createNote("未命名");
      await refreshTopology({ id: note.id, pos });
      requestTitleFocus(note.id);
      await openNote(note.id);
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      const topology = topologyRef.current;
      if (!topology) return;
      const idx = renderer.pick(e.clientX, e.clientY);
      if (idx === null) {
        dragRef.current = { kind: "idle" };
        return;
      }
      const node = topology.nodes[idx];
      if (e.shiftKey && !node.ghost) {
        dragRef.current = { kind: "link", nodeIndex: idx };
        renderer.setControlsEnabled(false);
        glCanvas!.style.cursor = "crosshair";
        return;
      }
      dragRef.current = { kind: "maybe", nodeIndex: idx, startX: e.clientX, startY: e.clientY };
    }

    function onPointerMove(e: PointerEvent) {
      const topology = topologyRef.current;
      if (!topology) return;
      const drag = dragRef.current;

      if (drag.kind === "maybe") {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) {
          const node = topology.nodes[drag.nodeIndex];
          if (node.ghost) {
            // Ghosts (unresolved wiki-link targets) aren't real notes — nothing to drag.
            dragRef.current = { kind: "idle" };
          } else {
            renderer.setControlsEnabled(false);
            glCanvas!.style.cursor = "grabbing";
            const clusterOf =
              useStore.getState().graphMode === "constellation"
                ? constellationLayoutRef.current.clusterOf
                : null;
            if (clusterOf) {
              const cluster = clusterOf[drag.nodeIndex];
              const members: number[] = [];
              for (let i = 0; i < clusterOf.length; i++) if (clusterOf[i] === cluster) members.push(i);
              const positions = positionsRef.current;
              const i3 = drag.nodeIndex * 3;
              dragRef.current = {
                kind: "cluster",
                nodeIndex: drag.nodeIndex,
                members,
                lastPoint: [positions[i3], positions[i3 + 1], positions[i3 + 2]],
              };
            } else {
              dragRef.current = { kind: "node", nodeIndex: drag.nodeIndex };
            }
          }
        }
        updateHover(e.clientX, e.clientY);
        return;
      }

      if (drag.kind === "node") {
        const positions = positionsRef.current;
        const idx = drag.nodeIndex;
        const anchor: [number, number, number] = [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
        const point = renderer.raycastPlaneThroughPoint(e.clientX, e.clientY, anchor);
        if (point) {
          positions[idx * 3] = point[0];
          positions[idx * 3 + 1] = point[1];
          positions[idx * 3 + 2] = point[2];
          physicsRef.current?.pin(idx, point[0], point[1], point[2]);
          physicsRef.current?.reheat(0.15);
          renderer.updatePositions(positions);
        }
        return;
      }

      if (drag.kind === "cluster") {
        const positions = positionsRef.current;
        const point = renderer.raycastPlaneThroughPoint(e.clientX, e.clientY, drag.lastPoint);
        if (point) {
          const dx = point[0] - drag.lastPoint[0];
          const dy = point[1] - drag.lastPoint[1];
          const dz = point[2] - drag.lastPoint[2];
          translateClusterMembers(positions, drag.members, dx, dy, dz);
          drag.lastPoint = point;
          // No physics pin/reheat here, unlike the Force-mode branch below: in Constellation Mode
          // the simulation isn't driving these positions at all — ConstellationLayout wrote them
          // and nothing else touches them until the next topology rebuild — so pinning would file
          // a constraint with a solver that is not running, and reheating would fight the layout.
          renderer.updatePositions(positions);
        }
        return;
      }

      if (drag.kind === "link") {
        const idx = drag.nodeIndex;
        const positions = positionsRef.current;
        const from: [number, number, number] = [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
        const point = renderer.raycastPlaneThroughPoint(e.clientX, e.clientY, from);
        const node = topology.nodes[idx];
        const color = themeColorsRef.current.accents[node.accent];
        if (point) renderer.setPreviewLine(from, point, color);
        updateHover(e.clientX, e.clientY);
        return;
      }

      updateHover(e.clientX, e.clientY);
    }

    function onPointerUp(e: PointerEvent) {
      const topology = topologyRef.current;
      const drag = dragRef.current;
      dragRef.current = { kind: "idle" };
      if (!topology) return;

      if (drag.kind === "maybe") {
        const node = topology.nodes[drag.nodeIndex];
        selectedIndexRef.current = drag.nodeIndex;
        renderer.setSelected(drag.nodeIndex);
        if (node.ghost) void openOrCreateNoteByTitle(node.title);
        else void openNote(node.id);
        return;
      }

      if (drag.kind === "cluster") {
        renderer.setControlsEnabled(true);
        glCanvas!.style.cursor = "grab";
        // Nothing to settle: the figure keeps exactly where it was dropped until the next topology
        // rebuild regenerates the sky. Note this can push a constellation into a neighbour's berth,
        // breaking `placeClusters`' no-overlap guarantee — accepted deliberately, because that
        // guarantee exists to stop the *generated* sky overlapping itself, not to overrule where a
        // person chose to put something by hand.
        return;
      }

      if (drag.kind === "node") {
        renderer.setControlsEnabled(true);
        glCanvas!.style.cursor = "grab";
        const idx = drag.nodeIndex;
        // Obsidian-like: releasing a dragged star does NOT pin it — clear its fixed position and
        // reheat so the simulation carries it from here. See docs/WORKSPACE-3D.md.
        physicsRef.current?.unpin(idx);
        physicsRef.current?.reheat(0.4);
        return;
      }

      if (drag.kind === "link") {
        renderer.setControlsEnabled(true);
        renderer.setPreviewLine(null, null);
        glCanvas!.style.cursor = "grab";
        const fromNode = topology.nodes[drag.nodeIndex];
        const targetIdx = renderer.pick(e.clientX, e.clientY);
        if (targetIdx !== null && targetIdx !== drag.nodeIndex) {
          const targetNode = topology.nodes[targetIdx];
          void (async () => {
            const targetId = targetNode.ghost ? await resolveNoteId(targetNode.title) : targetNode.id;
            await linkNotes(fromNode.id, targetId);
            await refreshTopology();
          })();
        } else if (targetIdx === null) {
          const point = renderer.raycastPlaneAtTarget(e.clientX, e.clientY);
          if (point) void createLinkedNoteAt(fromNode.id, point);
        }
        return;
      }

      // Idle release: either an edge click (open its Unlink popover) or empty space (clear selection).
      const edgeIdx = renderer.pickEdge(e.clientX, e.clientY);
      if (edgeIdx !== null) {
        setPinPopover(null);
        setEdgePopover({ x: e.clientX, y: e.clientY, edgeIndex: edgeIdx });
      } else {
        selectedIndexRef.current = null;
        renderer.setSelected(null);
      }
    }

    function onDoubleClick(e: MouseEvent) {
      if (renderer.pick(e.clientX, e.clientY) !== null) return;
      const point = renderer.raycastPlaneAtTarget(e.clientX, e.clientY);
      if (point) void createNoteAtPoint(point);
    }

    function onContextMenu(e: MouseEvent) {
      const topology = topologyRef.current;
      if (!topology) return;
      const idx = renderer.pick(e.clientX, e.clientY);
      if (idx === null) return;
      const node = topology.nodes[idx];
      if (node.ghost) return;
      e.preventDefault();
      selectedIndexRef.current = idx;
      renderer.setSelected(idx);
      setEdgePopover(null);
      setPinPopover({ x: e.clientX, y: e.clientY, nodeIndex: idx });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (isEditableTarget(e.target)) return;
      const idx = selectedIndexRef.current;
      if (idx === null) return;
      const node = topologyRef.current?.nodes[idx];
      if (!node || node.ghost) return;
      e.preventDefault();
      if (!window.confirm(`删除“${node.title || "未命名"}”？删除后无法恢复。`)) return;
      void (async () => {
        await deleteNote(node.id);
        await refreshTopology();
      })();
    }

    function onWindowPointerDownForPopovers(e: PointerEvent) {
      const target = e.target as Element | null;
      if (target?.closest(".graph-popover")) return;
      setPinPopover(null);
      setEdgePopover(null);
    }

    glCanvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    glCanvas.addEventListener("dblclick", onDoubleClick);
    glCanvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onWindowPointerDownForPopovers);
    glCanvas.style.cursor = "grab";

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafRef.current);
      glCanvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      glCanvas.removeEventListener("dblclick", onDoubleClick);
      glCanvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onWindowPointerDownForPopovers);
      physicsRef.current?.dispose();
      physicsRef.current = null;
      renderer.dispose();
      rendererRef.current = null;
      topologyRef.current = null;
      transitionRef.current = null;
      forceLayoutRef.current = null;
      hoverRef.current = null;
      lastFrameRef.current = 0;
      qualityRef.current = new AdaptiveQuality();
      delete window.__graph3d;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effect owns its own mutable refs and
    // runs once for the app's lifetime; the store actions/refreshTopology it closes over are stable.
  }, [
    openNote,
    openOrCreateNoteByTitle,
    createNote,
    deleteNote,
    linkNotes,
    requestTitleFocus,
    refreshTopology,
  ]);

  // Initial load: seed positions on a small sphere (not a single point, so the first few force
  // ticks don't explode outward at once), then frame the camera once, then play the "opening"
  // reveal — an entrance `LayoutTransition` from a bunched point near the origin out to that
  // sphere/constellation target, with the renderer's brightness ramp (`startEntrance`) timed to
  // match — so the sky is born rather than popping into view fully formed. Any dropped-pin data an
  // older vault persisted is intentionally ignored — see the comment below.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void loadLinkIndex().then((index) => {
      if (cancelled) return;
      const topology = buildTopology(index);
      setGraphStats({ nodeCount: topology.nodes.length, edgeCount: topology.edges.length });
      const n = topology.nodes.length;
      const positions = new Float32Array(n * 3);

      // Genuine 3D ball seed (Fibonacci sphere directions × cube-root radius). The old
      // r·(cos t, 0.6·sin t, sin t) form put every node on the plane y = 0.6·z, and the symmetric
      // repel/link/center forces preserve any planar configuration exactly — so 3D never gained
      // real Z depth and the graph looked squashed onto a sheet. See docs/WORKSPACE-3D.md.
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const rad = 90 * Math.cbrt((i + 1) / Math.max(1, n));
        const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
        const ringR = Math.sqrt(Math.max(0, 1 - y * y));
        const t = golden * i;
        positions[i * 3] = rad * Math.cos(t) * ringR;
        positions[i * 3 + 1] = rad * y;
        positions[i * 3 + 2] = rad * Math.sin(t) * ringR;
      }

      // Any dropped-pin positions an older version of the app persisted are intentionally not read
      // here — Phase 16 retired drag-to-pin, so old pins must not keep nodes frozen on load (and
      // Phase 18 removed the mechanism that stored them at all). `pinnedIndices` stays empty; kept
      // only because `GraphPhysics`/`renderer.setPinned` still take a pinned set.
      const pinnedIndices = new Set<number>();

      const physics = new GraphPhysics(topology, positions, pinnedIndices);
      // A vault saved in 2D should flatten immediately, even before the user touches anything —
      // see physics.ts's setFlatten and the dimension-effect below (which handles later toggles).
      physics.setFlatten(dimensionRef.current === "2d");
      // Persisted Forces sliders should apply from the very first frame too, not just after the
      // user next touches one — see physics.ts's setForces.
      physics.setForces(graphSettingsRef.current.forces);
      if (modeRef.current === "constellation") {
        const target = new Float32Array(n * 3);
        constellationLayoutRef.current.generate(topology, positions, target);
        for (const i of pinnedIndices) {
          target[i * 3] = positions[i * 3];
          target[i * 3 + 1] = positions[i * 3 + 1];
          target[i * 3 + 2] = positions[i * 3 + 2];
        }
        positions.set(target);
        physics.setPositions(positions);
        rendererRef.current?.setConstellationLabels(constellationLayoutRef.current.labels, performance.now());
        rendererRef.current?.setSyntheticEdges(constellationLayoutRef.current.syntheticEdges);
        rendererRef.current?.setConstellationEmphasis(constellationLayoutRef.current.clusterOf, constellationLayoutRef.current.figureEdgeKeys);
      }

      // The reveal's starting point: every star bunched in a tiny jittered cluster near the
      // origin (distinct positions, not a single stacked point, so the very first frame already
      // shows individual stars rather than one dot) — id-hash-seeded so it's deterministic like
      // every other placement in this module.
      const entryPositions = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const rnd = mulberry32(hashString(topology.nodes[i].id) ^ 0x9e3779b9);
        const r = 3 + rnd() * 5;
        const theta = rnd() * Math.PI * 2;
        const phi = Math.acos(2 * rnd() - 1);
        entryPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        entryPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        entryPositions[i * 3 + 2] = r * Math.cos(phi);
      }

      topologyRef.current = topology;
      positionsRef.current = entryPositions;
      physicsRef.current = physics;
      forceLayoutRef.current = new ForceLayout(physics);
      transitionRef.current = new LayoutTransition(n * 3);
      pinnedIndicesRef.current = pinnedIndices;
      debugRef.current.nodeCount = n;

      rendererRef.current?.setTopology(topology, readThemeColors());
      // Same reason as the physics.setForces call above — persisted Filters should be visible
      // from the first frame, not just after the panel's first edit.
      rendererRef.current?.setFilterDim(computeFilterDim(topology, graphSettingsRef.current.filters));
      rendererRef.current?.setPinned(pinnedIndices);
      rendererRef.current?.updatePositions(entryPositions);
      // Frame the camera to the graph's rough size once, on load — never on a mode switch, which
      // must leave the camera untouched. Small vaults open close-up instead of adrift in space.
      const estimatedRadius = 34 + Math.sqrt(n) * 40;
      // Aim at the just-computed TARGET layout's centroid (`positions`), not wherever the
      // renderer's own tracked centroid happens to sit — at this point only the entrance reveal's
      // bunched-near-origin positions have ever been pushed to the renderer (see `updatePositions`
      // below), so its centroid is still near the origin rather than where the real layout (dome
      // placement in Constellation mode, or plain drift) actually is.
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < n; i++) {
        cx += positions[i * 3];
        cy += positions[i * 3 + 1];
        cz += positions[i * 3 + 2];
      }
      if (n > 0) {
        cx /= n;
        cy /= n;
        cz /= n;
      }
      rendererRef.current?.frameCamera(Math.max(150, Math.min(700, estimatedRadius * 2.6)), [cx, cy, cz]);
      // Kick off the reveal: the frame loop's transition.step() takes it from here (physics never
      // ticks while a transition is active), landing exactly on `positions` — the same target
      // `physics` was already constructed against, so Force mode's simulation picks up right where
      // the reveal left off with no snap. `positions` still holds the pre-reveal target here (only
      // `positionsRef.current`, not this local variable, was swapped to `entryPositions` above).
      const now = performance.now();
      transitionRef.current.start(entryPositions, positions, now, ENTRANCE_DURATION_MS);
      rendererRef.current?.startEntrance(now);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // React to external vault changes (editor wiki-links, imports, plugins) with a debounced
  // incremental refresh; gesture-driven changes above already refresh immediately. Deferred
  // entirely while a drag/link-drag is in flight, so it never yanks physics out from under one.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (dragRef.current.kind !== "idle") {
          schedule();
          return;
        }
        void refreshTopology();
      }, EXTERNAL_REFRESH_DEBOUNCE_MS);
    }
    vaultEvents.on("note:created", schedule);
    vaultEvents.on("note:updated", schedule);
    vaultEvents.on("note:deleted", schedule);
    vaultEvents.on("canvas:changed", schedule);
    return () => {
      if (timer) clearTimeout(timer);
      vaultEvents.off("note:created", schedule);
      vaultEvents.off("note:updated", schedule);
      vaultEvents.off("note:deleted", schedule);
      vaultEvents.off("canvas:changed", schedule);
    };
  }, [refreshTopology]);

  // React to Constellation/Graph toggles: snapshot → generate target → animate, per docs/CONSTELLATION.md.
  useEffect(() => {
    const topology = topologyRef.current;
    const transition = transitionRef.current;
    const physics = physicsRef.current;
    if (!topology || !transition || !physics) return;

    const positions = positionsRef.current;
    const current = positions.slice();
    if (graphMode === "constellation") {
      const target = new Float32Array(positions.length);
      constellationLayoutRef.current.generate(topology, current, target);
      for (const i of pinnedIndicesRef.current) {
        target[i * 3] = current[i * 3];
        target[i * 3 + 1] = current[i * 3 + 1];
        target[i * 3 + 2] = current[i * 3 + 2];
      }
      transition.start(current, target, performance.now());
      rendererRef.current?.setConstellationLabels(constellationLayoutRef.current.labels, performance.now());
      rendererRef.current?.setSyntheticEdges(constellationLayoutRef.current.syntheticEdges);
      rendererRef.current?.setConstellationEmphasis(constellationLayoutRef.current.clusterOf, constellationLayoutRef.current.figureEdgeKeys);
    } else {
      // No separate "force target" exists to animate toward — sync physics to the static layout
      // it's resuming from and reheat it, so the simulation itself carries the motion from here.
      // Cancel any in-flight transition so it can't hold positions frozen while physics is ticking.
      physics.setPositions(current);
      physics.reheat(0.4);
      transition.cancel();
      // Labels/guide-lines/brightness boost are Constellation Mode only — removed entirely (not
      // just faded out) in Force mode, which must look exactly as it did before this feature.
      rendererRef.current?.setConstellationLabels([], performance.now());
      rendererRef.current?.setSyntheticEdges([]);
      rendererRef.current?.setConstellationEmphasis(null);
    }
  }, [graphMode]);

  // 2D/3D: flatten (or un-flatten) the force simulation toward z=0 — see physics.ts's
  // setFlatten. A no-op in Constellation Mode until the user switches back to Force (physics only
  // ticks in Force mode — see the frame loop above), which is fine: constellation's dome is a
  // static layout, not read from the sim, so it only needs the camera lock below.
  useEffect(() => {
    fitPlanarPending.current = graphDimension === "2d";
    physicsRef.current?.setFlatten(graphDimension === "2d");
  }, [graphDimension]);

  // 2D/3D + Force/Constellation + animating: the one call into the renderer's camera behavior —
  // auto-rotate (3D Force), sway (3D Constellation), and the face-on lock (2D) all live there. See
  // docs/WORKSPACE-3D.md's "2D / 3D" and docs/CONSTELLATION.md's "sway".
  useEffect(() => {
    rendererRef.current?.applyCameraMode(graphDimension, graphMode, graphAnimating);
  }, [graphDimension, graphMode, graphAnimating]);

  // Theme-aware: re-tint stars/edges/background without rebuilding the scene.
  useEffect(() => {
    const colors = readThemeColors();
    themeColorsRef.current = colors;
    rendererRef.current?.setTheme(colors);
  }, [theme]);

  // Graph settings panel — Forces: live-adjusts the running sim on every slider change. The
  // reapply-on-rebuild half (a topology rebuild swaps the sim wholesale) lives in refreshTopology
  // and the initial-load effect above, via `graphSettingsRef`.
  useEffect(() => {
    physicsRef.current?.setForces(graphSettings.forces);
  }, [graphSettings.forces]);

  // Graph settings panel — Display: node size, link thickness, text fade, arrows. All apply
  // directly to persistent renderer state (a uniform, a material property, a multiplier field, a
  // mesh's visibility) that a topology rebuild never resets, so — unlike Forces/Filters — no
  // separate reapply-on-rebuild call is needed anywhere else.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setNodeSizeMult(graphSettings.display.nodeSize);
    renderer.setLinkThickness(graphSettings.display.linkThickness);
    renderer.setLabelDensity(graphSettings.display.textFade);
    renderer.setArrowsEnabled(graphSettings.display.arrows);
  }, [graphSettings.display]);

  // Graph settings panel — Filters: recomputes the per-node dim array on every search/orphans/
  // existingOnly change. The reapply-on-rebuild half lives in refreshTopology and the initial-load
  // effect above (setTopology resets every node to fully-visible), via `graphSettingsRef`.
  useEffect(() => {
    const renderer = rendererRef.current;
    const topology = topologyRef.current;
    if (!renderer || !topology) return;
    renderer.setFilterDim(computeFilterDim(topology, graphSettings.filters));
  }, [graphSettings.filters]);

  async function handleUnlink(edgeIndex: number) {
    const topology = topologyRef.current;
    const edge = topology?.edges[edgeIndex];
    setEdgePopover(null);
    if (!topology || !edge) return;
    const a = topology.nodes[edge.a];
    const b = topology.nodes[edge.b];
    // Fully disconnects the pair — every wiki-link and every canvas edge between them, regardless
    // of which one this particular edge happened to represent (see store.ts's unlinkNotePair).
    await unlinkNotePair(a.id, b.id);
    await refreshTopology();
  }

  async function handleDeleteFromPopover(idx: number) {
    const node = topologyRef.current?.nodes[idx];
    setPinPopover(null);
    if (!node || node.ghost) return;
    if (!window.confirm(`删除“${node.title || "未命名"}”？删除后无法恢复。`)) return;
    await deleteNote(node.id);
    await refreshTopology();
  }

  async function handleMoveToFolderFromPopover(idx: number) {
    const node = topologyRef.current?.nodes[idx];
    setPinPopover(null);
    if (!node || node.ghost) return;
    const input = window.prompt(`将“${node.title || "未命名"}”移到文件夹（留空表示知识库根目录）：`, node.folder ?? "");
    if (input === null) return;
    const folder = input.trim() || undefined;
    if (folder === node.folder) return;
    await moveNote(node.id, folder);
    await refreshTopology();
  }

  return (
    <div ref={containerRef} className="graph-main" data-mode={graphMode} data-dimension={graphDimension}>
      <div className="graph-top-bar">
        <div className="graph-mode-toggle" role="tablist" aria-label="星图排列方式">
          <button
            role="tab"
            aria-selected={graphMode === "force"}
            className={`graph-mode-btn ${graphMode === "force" ? "active" : ""}`}
            onClick={() => setGraphMode("force")}
          >
            星图
          </button>
          <button
            role="tab"
            aria-selected={graphMode === "constellation"}
            className={`graph-mode-btn ${graphMode === "constellation" ? "active" : ""}`}
            onClick={() => setGraphMode("constellation")}
          >
            星座排列
          </button>
        </div>
        <div className="graph-dimension-toggle" role="tablist" aria-label="星图维度">
          <button
            role="tab"
            aria-selected={graphDimension === "2d"}
            className={`graph-mode-btn ${graphDimension === "2d" ? "active" : ""}`}
            onClick={() => setGraphDimension("2d")}
          >
            2D
          </button>
          <button
            role="tab"
            aria-selected={graphDimension === "3d"}
            className={`graph-mode-btn ${graphDimension === "3d" ? "active" : ""}`}
            onClick={() => setGraphDimension("3d")}
          >
            3D
          </button>
        </div>
        {graphDimension === "2d" && graphMode === "force" && <button className="graph-arrange-btn" onClick={() => physicsRef.current?.arrange()} title="在当前位置重新分散节点，保留视角">自动整理</button>}
      </div>
      {loading && <div className="graph-loading">正在生成星图…</div>}
      <canvas ref={glCanvasRef} className="graph-canvas" />
      <canvas ref={labelCanvasRef} className="graph-label-canvas" />
      <GraphSettingsPanel />

      {pinPopover && (
        <div className="graph-popover" style={{ left: pinPopover.x, top: pinPopover.y }}>
          <button className="graph-popover-action" onClick={() => void handleMoveToFolderFromPopover(pinPopover.nodeIndex)}>
            移到文件夹…
          </button>
          <button
            className="graph-popover-action danger"
            onClick={() => void handleDeleteFromPopover(pinPopover.nodeIndex)}
          >
            删除笔记
          </button>
        </div>
      )}

      {edgePopover &&
        (() => {
          const topology = topologyRef.current;
          const edge = topology?.edges[edgePopover.edgeIndex];
          if (!topology || !edge) return null;
          const a = topology.nodes[edge.a];
          const b = topology.nodes[edge.b];
          return (
            <div className="graph-popover" style={{ left: edgePopover.x, top: edgePopover.y }}>
              <div className="graph-popover-title">
                {a.title || "未命名"} → {b.title || "未命名"}
              </div>
              <button className="graph-popover-action danger" onClick={() => void handleUnlink(edgePopover.edgeIndex)}>
                取消关联
              </button>
            </div>
          );
        })()}
    </div>
  );
}
