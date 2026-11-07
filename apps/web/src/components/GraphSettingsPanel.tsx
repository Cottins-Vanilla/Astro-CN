import { useStore } from "../store";
import { usePanelMount } from "../usePanelMount";

/** min/max/step tuned by eye against the physics defaults in store.ts's `DEFAULT_GRAPH_SETTINGS` —
 * each slider's default sits comfortably inside its range, not pinned to an edge. */
interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (value: number) => void;
}

function formatDefault(v: number): string {
  // Trims to at most 2 decimals without trailing zeros (2 -> "2", 0.5 -> "0.5", 0.25 -> "0.25").
  return (Math.round(v * 100) / 100).toString();
}

function GraphSettingsSlider({ label, value, min, max, step, format = formatDefault, onChange }: SliderProps) {
  return (
    <label className="graph-settings-slider-field">
      <span className="graph-settings-slider-label">
        <span>{label}</span>
        <span className="graph-settings-slider-value">{format(value)}</span>
      </span>
      <input
        type="range"
        className="graph-settings-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/**
 * Floating "Graph settings" panel, anchored top-left over the graph (top-right is the floating
 * dock's territory — see App.tsx's .floating-dock and index.css) — opened from the ribbon's
 * sliders icon or the Command Palette. Adapts the familiar "Filters / Display / Forces" shape of
 * a graph-view control panel to Astro's own model: no Groups section (deferred, see the Phase 18
 * plan) and no Attachments filter (Astro has no attachment concept). Every control here writes
 * straight to `graphSettings` in store.ts; GraphView3D.tsx is the one place that reads it back out
 * and pushes it into physics.ts/renderer.ts — this component never touches the scene directly.
 */
export function GraphSettingsPanel() {
  const open = useStore((s) => s.graphPanelOpen);
  const { mounted, visible } = usePanelMount(open);
  const togglePanel = useStore((s) => s.toggleGraphPanel);
  const graphSettings = useStore((s) => s.graphSettings);
  const setGraphForces = useStore((s) => s.setGraphForces);
  const setGraphDisplay = useStore((s) => s.setGraphDisplay);
  const setGraphFilters = useStore((s) => s.setGraphFilters);
  const graphAnimating = useStore((s) => s.graphAnimating);
  const toggleGraphAnimating = useStore((s) => s.toggleGraphAnimating);

  if (!mounted) return null;

  const { forces, display, filters } = graphSettings;

  return (
    <div className={`graph-settings-panel ${visible ? "panel-open" : "panel-closed"}`} onMouseDown={(e) => e.stopPropagation()}>
      <div className="dock-panel-header">
        <span>星图设置</span>
        <button className="graph-settings-close" onClick={togglePanel} aria-label="关闭星图设置">
          ×
        </button>
      </div>

      <div className="graph-settings-body">
        <details className="graph-settings-section" open>
          <summary>筛选</summary>
          <div className="graph-settings-section-body">
            <label className="settings-field">
              <span>搜索</span>
              <input
                type="text"
                value={filters.search}
                placeholder="输入笔记标题，筛选星星…"
                onChange={(e) => setGraphFilters({ search: e.target.value })}
              />
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={filters.orphans}
                onChange={(e) => setGraphFilters({ orphans: e.target.checked })}
              />
              <span>显示没有关联的笔记</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={filters.existingOnly}
                onChange={(e) => setGraphFilters({ existingOnly: e.target.checked })}
              />
              <span>只显示已创建的笔记</span>
            </label>
          </div>
        </details>

        <details className="graph-settings-section" open>
          <summary>显示效果</summary>
          <div className="graph-settings-section-body">
            <GraphSettingsSlider
              label="星星大小"
              value={display.nodeSize}
              min={0.5}
              max={2}
              step={0.05}
              onChange={(v) => setGraphDisplay({ nodeSize: v })}
            />
            <GraphSettingsSlider
              label="连线粗细"
              value={display.linkThickness}
              min={0.25}
              max={2.5}
              step={0.05}
              onChange={(v) => setGraphDisplay({ linkThickness: v })}
            />
            <GraphSettingsSlider
              label="文字淡出程度"
              value={display.textFade}
              min={0}
              max={2}
              step={0.05}
              onChange={(v) => setGraphDisplay({ textFade: v })}
            />
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={display.arrows}
                onChange={(e) => setGraphDisplay({ arrows: e.target.checked })}
              />
              <span>连线箭头</span>
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={graphAnimating} onChange={toggleGraphAnimating} />
              <span>动画</span>
            </label>
          </div>
        </details>

        <details className="graph-settings-section" open>
          <summary>星星排列</summary>
          <div className="graph-settings-section-body">
            <GraphSettingsSlider
              label="向中心聚拢"
              value={forces.center}
              min={0}
              max={2}
              step={0.05}
              onChange={(v) => setGraphForces({ center: v })}
            />
            {/* Shown as a positive "pull apart" amount even though the underlying d3-force-3d
                charge strength is negative (repulsion) — see physics.ts's setForces. */}
            <GraphSettingsSlider
              label="星星之间的排斥力"
              value={-forces.repel}
              min={0}
              max={400}
              step={5}
              onChange={(v) => setGraphForces({ repel: -v })}
            />
            <GraphSettingsSlider
              label="关联笔记的吸引力"
              value={forces.linkForce}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setGraphForces({ linkForce: v })}
            />
            <GraphSettingsSlider
              label="关联笔记的间距"
              value={forces.linkDistance}
              min={10}
              max={200}
              step={5}
              format={(v) => Math.round(v).toString()}
              onChange={(v) => setGraphForces({ linkDistance: v })}
            />
          </div>
        </details>
      </div>
    </div>
  );
}
