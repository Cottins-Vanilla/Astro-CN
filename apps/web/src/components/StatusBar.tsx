import { useStore } from "../store";

/**
 * Bottom-of-window strip. Left: live node/edge counts fed by GraphView3D's
 * `setGraphStats` (ephemeral — never persisted). Right: a clickable
 * Force/Constellation indicator (mirrors the graph's own pill toggle) plus
 * a static "Local vault" badge, a reminder that everything here lives in
 * this browser's IndexedDB.
 */
export function StatusBar() {
  const { nodeCount, edgeCount } = useStore((s) => s.graphStats);
  const graphMode = useStore((s) => s.graphMode);
  const toggleGraphMode = useStore((s) => s.toggleGraphMode);

  return (
    <div className="status-bar">
      <span>
        {nodeCount} 篇笔记 · {edgeCount} 条关联
      </span>
      <div className="status-bar-right">
        <button
          onClick={toggleGraphMode}
          className={`status-mode-btn ${graphMode === "constellation" ? "active" : ""}`}
        >
          {graphMode === "constellation" ? "星座排列" : "自由排列"}
        </button>
        <span className="status-badge">本地知识库</span>
      </div>
    </div>
  );
}
