import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, RefreshCw, ExternalLink } from "lucide-react";
import { type BrowserTabState } from "../browserTypes";
import { useStore } from "../store";
import { resolveAddress, resolveEngine } from "../searchEngines";

/**
 * Slim address/back-forward bar shown under the tab strip while the active tab is a web tab —
 * lifted almost verbatim from the old BrowserPanel.tsx's `BrowserView` toolbar JSX (see
 * docs/ARCH-TAB-WORKSPACE.md §5). Its trailing "close browser" (×) button is gone — closing a web
 * tab is now the tab's own × in the strip, not the toolbar's job.
 */
export function WebToolbar(props: {
  nativeId: string;
  state: BrowserTabState | undefined;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  onOpenExternally: () => void;
}) {
  const { state } = props;
  const searchEngine = useStore((s) => s.searchEngine);
  const customSearchUrl = useStore((s) => s.customSearchUrl);
  const engine = resolveEngine(searchEngine, customSearchUrl);
  const [address, setAddress] = useState(state?.url ?? "");
  const addressEditedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!addressEditedRef.current) setAddress(state?.url ?? "");
  }, [state?.url, props.nativeId]);

  // Auto-focus the address bar when this toolbar mounts for a blank tab (the "Apri visualizzatore
  // web" quick action turns a newtab into a web tab and expects the address input ready to type
  // into — see NewTabPage.tsx).
  useEffect(() => {
    if (!state?.url) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  return (
    <>
    <div className="browser-toolbar nodrag">
      <button className="browser-nav-btn" disabled={!state?.canGoBack} onClick={props.onBack} title="后退" aria-label="后退">
        <ChevronLeft size={15} />
      </button>
      <button className="browser-nav-btn" disabled={!state?.canGoForward} onClick={props.onForward} title="前进" aria-label="前进">
        <ChevronRight size={15} />
      </button>
      <button
        className="browser-nav-btn"
        onClick={props.onReloadOrStop}
        title={state?.loading ? "停止回复" : "重新加载"}
        aria-label={state?.loading ? "停止回复" : "重新加载"}
      >
        {state?.loading ? <X size={14} /> : <RefreshCw size={14} />}
      </button>
      <input
        ref={inputRef}
        className="browser-address"
        value={address}
        onChange={(e) => {
          addressEditedRef.current = true;
          setAddress(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            addressEditedRef.current = false;
            props.onNavigate(resolveAddress((e.target as HTMLInputElement).value, engine));
          } else if (e.key === "Escape") {
            // Esc here just blurs the address bar (old muscle memory); it must NOT also bubble up
            // to App.tsx's Esc-returns-to-graph handler in the same keypress — see docs/
            // ARCH-TAB-WORKSPACE.md §7.
            (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }
        }}
        spellCheck={false}
        placeholder={`使用 ${engine.label} 搜索，或输入网址`}
        aria-label="网址或搜索关键词"
      />
      <button
        className="browser-nav-btn"
        onClick={props.onOpenExternally}
        title="使用系统浏览器打开"
        aria-label="使用系统浏览器打开"
      >
        <ExternalLink size={14} />
      </button>
    </div>
    <div className={`browser-progress ${state?.loading ? "loading" : ""}`} />
    </>
  );
}
