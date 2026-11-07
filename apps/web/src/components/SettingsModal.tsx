import { useEffect, useRef, useState } from "react";
import { PenLine, Palette, Keyboard, Globe, CircleUser, RefreshCw, Plug, Sparkles, Blocks, Info, LogIn, LogOut, Copy, Check, RotateCcw } from "lucide-react";
import { useStore, type SettingsTab } from "../store";
import { usePanelMount } from "../usePanelMount";
import { usePluginStore } from "../plugins/store";
import { setPluginEnabled } from "../plugins/manager";
import type { AIProviderConfig } from "../ai/types";
import { connectionKindOf, switchConnectionKind, DEEPSEEK_MODELS, type ConnectionKind } from "../ai/presets";
import { testAIConnection } from "../ai/testConnection";
import type { GoogleProfile, McpClientStatus, McpListResult, McpTestResult, McpUnverifiedClient } from "../browserTypes";
import { HOTKEYS } from "../hotkeys";
import { tildeHome } from "../mcpPaths";
import { SEARCH_ENGINES } from "../searchEngines";
import { version as webVersion } from "../../package.json";

/** Preset accent swatches (docs/ARCH-APPEARANCE.md §2.2) — the existing star-accent palette hexes
 * from index.css's `--color-accent-*` tokens, plus a `null` "default" swatch that clears the
 * override so the active theme's own accent returns. */
const ACCENT_PRESETS: { hex: string | null; label: string }[] = [
  { hex: null, label: "默认" },
  { hex: "#4cc2ff", label: "蓝色" },
  { hex: "#8fa8ff", label: "紫色" },
  { hex: "#3ecfa5", label: "绿色" },
  { hex: "#e3b25c", label: "琥珀色" },
  { hex: "#ef6b78", label: "红色" },
];

/** Sample body for the Editor tab's preview — deliberately plain Markdown with one long line, so
 * the readable-line-length cap has something to actually wrap. */
const EDITOR_PREVIEW_LINES = [
  "# 知识星空",
  "",
  "每篇笔记都是一颗星，笔记之间的关联把它们连成一片知识星空。",
  "另见 [[星座排列]]。",
];

const SETTINGS_SECTIONS: { id: SettingsTab; label: string; icon: typeof PenLine }[] = [
  { id: "editor", label: "笔记编辑", icon: PenLine },
  { id: "appearance", label: "界面外观", icon: Palette },
  { id: "hotkeys", label: "快捷键", icon: Keyboard },
  { id: "web", label: "网页浏览", icon: Globe },
  { id: "account", label: "账号", icon: CircleUser },
  { id: "sync", label: "同步与备份", icon: RefreshCw },
  { id: "connections", label: "连接其他工具", icon: Plug },
  { id: "ai", label: "智能助手", icon: Sparkles },
  { id: "plugins", label: "插件", icon: Blocks },
  { id: "about", label: "关于", icon: Info },
];

/** Solen AI's own link list (verified from solenai.app's Follow section) — Settings → About's
 * "About us" section. One-place edit if a handle or URL ever changes. */
const SOLEN_LINKS: { label: string; url: string }[] = [
  { label: "官方网站", url: "https://www.solenai.app" },
  { label: "GitHub", url: "https://github.com/Solen-AI-org" },
  { label: "Hugging Face", url: "https://huggingface.co/Solen-AI-org" },
  { label: "X", url: "https://x.com/solenai_os/" },
  { label: "Instagram", url: "https://www.instagram.com/solenai_os/" },
  { label: "TikTok", url: "https://www.tiktok.com/@solen_ai" },
  { label: "LinkedIn", url: "https://www.linkedin.com/in/solen-ai-a938a8409/" },
  { label: "Discord", url: "https://discord.gg/tnrA4BtKZ" },
];

/** Opens an external link from a plain button rather than an `<a>`: the main window's
 * `setWindowOpenHandler` denies every new-window request outright (apps/desktop/src/main.ts), and
 * App.tsx's own external-link routing only intercepts anchors inside `.markdown-body` — neither of
 * which this (Settings → About) is, so a bare `<a target="_blank">` would silently do nothing
 * under Electron. Same isDesktop check App.tsx's interceptor uses: route into Astro's own browser
 * tab there, fall back to a normal new tab in the plain-browser build (no window.browserAPI). */
function openExternal(url: string) {
  if (/\bElectron\//i.test(navigator.userAgent)) useStore.getState().openBrowser(url);
  else window.open(url, "_blank", "noopener");
}

/** Human-readable label for an `McpClientStatus.state` — Connections tab. Deliberately about the
 * config file, not the client: Astro writes a file, it never observes the agent running. */
const MCP_STATE_LABEL: Record<McpClientStatus["state"], string> = {
  "not-configured": "尚未连接",
  configured: "已配置连接",
};


/** The JSON snippet shown for an unverified client (Cline, Antigravity, Pi) — the same
 * `mcpServers.astro` shape `mcpConnections.ts` writes for verified clients, just never written by
 * Astro itself since the path/schema isn't confirmed. `null` when there's nothing to paste
 * (ChatGPT Desktop has no local config at all). */
function mcpSnippet(client: McpUnverifiedClient, entryPath: string | null): string | null {
  if (client.snippetFormat === "none" || !entryPath) return null;
  return JSON.stringify({ mcpServers: { astro: { command: "node", args: [entryPath] } } }, null, 2);
}

/** Splits a HOTKEYS key combo ("Ctrl+K") into individual `<kbd>` keycaps joined by a muted "+",
 * so the Hotkeys tab reads like real keycaps rather than one long label. */
function Keycaps({ combo }: { combo: string }) {
  const keys = combo.split("+");
  return (
    <span className="settings-keycap-row">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="settings-keycap-plus">+</span>}
          <kbd className="settings-keycap">{k}</kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * Settings modal: AI provider configuration and the plugin list with
 * enable/disable toggles. Reachable from the sidebar's gear button, the
 * command palette, or the AI panel's "not configured" pointer.
 */
export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const { mounted, visible } = usePanelMount(open);
  const tab = useStore((s) => s.settingsTab);
  const setTab = useStore((s) => s.setSettingsTab);
  const close = useStore((s) => s.closeSettings);
  const aiConfig = useStore((s) => s.aiConfig);
  const setAIConfig = useStore((s) => s.setAIConfig);
  const loadedPlugins = usePluginStore((s) => s.loaded);
  const pluginPanels = usePluginStore((s) => s.panels);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const accentColor = useStore((s) => s.accentColor);
  const setAccentColor = useStore((s) => s.setAccentColor);
  const uiZoom = useStore((s) => s.uiZoom);
  const setUiZoom = useStore((s) => s.setUiZoom);
  const lineNumbers = useStore((s) => s.lineNumbers);
  const setLineNumbers = useStore((s) => s.setLineNumbers);
  const readableLineLength = useStore((s) => s.readableLineLength);
  const setReadableLineLength = useStore((s) => s.setReadableLineLength);
  const editorFontSize = useStore((s) => s.editorFontSize);
  const setEditorFontSize = useStore((s) => s.setEditorFontSize);
  const searchEngine = useStore((s) => s.searchEngine);
  const setSearchEngine = useStore((s) => s.setSearchEngine);
  const customSearchUrl = useStore((s) => s.customSearchUrl);
  const setCustomSearchUrl = useStore((s) => s.setCustomSearchUrl);
  const googleClientId = useStore((s) => s.googleClientId);
  const setGoogleClientId = useStore((s) => s.setGoogleClientId);
  const exportVault = useStore((s) => s.exportVault);

  const [draft, setDraft] = useState<AIProviderConfig>(aiConfig);
  const [saved, setSaved] = useState(false);
  const [aiTest, setAiTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const aiTestController = useRef<AbortController | null>(null);
  const connectionKind = connectionKindOf(draft);
  // Nothing to save, and — since `saved` otherwise latches true forever — the signal that clears
  // "Saved." the moment any field is edited again after a save (see `save()`/the AI tab's row).
  const aiUnchanged =
    draft.provider === aiConfig.provider &&
    draft.apiKey === aiConfig.apiKey &&
    draft.model === aiConfig.model &&
    draft.baseUrl === aiConfig.baseUrl &&
    !!draft.deepSeekThinking === !!aiConfig.deepSeekThinking;

  useEffect(() => {
    aiTestController.current?.abort();
    aiTestController.current = null;
    setAiTesting(false);
    setAiTest(null);
    return () => { aiTestController.current?.abort(); aiTestController.current = null; };
  }, [draft, open, tab]);

  async function runAITest() {
    if (aiTestController.current) return;
    const controller = new AbortController();
    aiTestController.current = controller;
    setAiTesting(true); setAiTest(null);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
    try {
      await testAIConnection(draft, controller.signal);
      if (aiTestController.current === controller) setAiTest({ ok: true, message: "连接成功，模型可以正常回复。" });
    } catch (error) {
      if (aiTestController.current === controller) setAiTest({ ok: false, message: timedOut ? "连接超时，请检查网络后重试。"
        : controller.signal.aborted ? "已取消连接测试。" : error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
      if (aiTestController.current === controller) { aiTestController.current = null; setAiTesting(false); }
    }
  }


  // Google sign-in state lives here, not in the store: the session is owned by the main process
  // (googleAuth.ts keeps the token), so this is a view of it, re-read whenever the modal opens.
  const [hasGoogleApi] = useState(() => typeof window !== "undefined" && !!window.googleAuthAPI);
  const [googleProfile, setGoogleProfile] = useState<GoogleProfile | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasGoogleApi || !open) return;
    void window.googleAuthAPI?.getProfile().then(setGoogleProfile);
  }, [hasGoogleApi, open]);

  async function signInWithGoogle() {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      setGoogleProfile(await window.googleAuthAPI!.signIn(googleClientId));
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : String(err));
    } finally {
      setGoogleBusy(false);
    }
  }

  // Same `window.vaultAPI` presence guard as Ribbon.tsx — undefined in the browser build, which
  // has no folder-backed vault to name a path for (see the `sync` tab's "Current vault" row).
  const [hasVaultApi] = useState(() => typeof window !== "undefined" && !!window.vaultAPI);
  const [currentVault, setCurrentVault] = useState<{ name: string; path: string } | null>(null);
  useEffect(() => {
    if (!hasVaultApi || !open) return;
    void window.vaultAPI?.getCurrentVault().then(setCurrentVault);
  }, [hasVaultApi, open]);

  // window.mcpAPI only exists under Electron (see apps/desktop/src/preload.mts) — the browser build
  // has no filesystem vault an external agent could point at, so the Connections tab never renders,
  // same guard style as hasTerminalApi in Ribbon.tsx.
  const [hasMcpApi] = useState(() => typeof window !== "undefined" && !!window.mcpAPI);
  const [mcpData, setMcpData] = useState<McpListResult | null>(null);
  const [mcpBusyId, setMcpBusyId] = useState<string | null>(null);
  const [mcpCopiedId, setMcpCopiedId] = useState<string | null>(null);
  /** Client id whose "we couldn't find this one — add anyway?" prompt is showing. Adding an entry
   * for a client Astro can't find is allowed (detection is advisory and does miss real installs)
   * but it shouldn't happen silently: saying "not detected" and then reporting "Configured" without
   * a word in between reads as the app contradicting itself. */
  const [mcpConfirmId, setMcpConfirmId] = useState<string | null>(null);
  const [mcpTest, setMcpTest] = useState<McpTestResult | null>(null);
  const [mcpTesting, setMcpTesting] = useState(false);

  function refreshMcpClients() {
    void window.mcpAPI?.listClients().then(setMcpData);
  }

  useEffect(() => {
    if (!hasMcpApi || !open) return;
    refreshMcpClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshMcpClients is stable enough; only re-run on open
  }, [hasMcpApi, open]);

  async function mcpToggle(client: McpClientStatus) {
    if (client.state === "not-configured" && !client.detected && mcpConfirmId !== client.id) {
      setMcpConfirmId(client.id);
      return;
    }
    setMcpConfirmId(null);
    setMcpBusyId(client.id);
    try {
      // A stale entry is still "configured", but the useful action there is rewriting it, not
      // removing it — the button says Update, so it must connect rather than disconnect.
      if (client.state === "configured" && !client.stale) await window.mcpAPI?.disconnect(client.id);
      else await window.mcpAPI?.connect(client.id);
      refreshMcpClients();
    } finally {
      setMcpBusyId(null);
    }
  }

  async function mcpRunTest() {
    setMcpTesting(true);
    setMcpTest(null);
    try {
      setMcpTest((await window.mcpAPI?.test()) ?? null);
    } finally {
      setMcpTesting(false);
    }
  }

  function mcpCopy(id: string, text: string) {
    void navigator.clipboard.writeText(text);
    setMcpCopiedId(id);
    setTimeout(() => setMcpCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  useEffect(() => {
    if (open) {
      setDraft(aiConfig);
      setSaved(false);
      // A pending "add anyway?" must not survive the modal closing — reopening on a row already
      // asking for confirmation would make the next Add click write without ever asking.
      setMcpConfirmId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset the draft when the modal (re)opens
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!mounted) return null;

  function save() {
    setAIConfig(draft);
    setSaved(true);
  }

  const activeSection = SETTINGS_SECTIONS.find((s) => s.id === tab);

  return (
    <div className={`overlay-backdrop ${visible ? "panel-open" : "panel-closed"}`} onMouseDown={close}>
      <div className="palette-panel settings-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-header-title">设置</span>
          {activeSection && (
            <>
              <span className="settings-header-sep">/</span>
              <span className="settings-header-section">{activeSection.label}</span>
            </>
          )}
          <button className="settings-close" onClick={close} title="关闭（Esc）">
            ×
          </button>
        </div>
        <div className="settings-shell">
          <nav className="settings-nav">
            {SETTINGS_SECTIONS.filter((section) => section.id !== "connections" || hasMcpApi).map((section) => (
              <button
                key={section.id}
                className={`settings-nav-item ${tab === section.id ? "active" : ""}`}
                onClick={() => setTab(section.id)}
              >
                <section.icon size={16} />
                {section.label}
              </button>
            ))}
          </nav>

        {tab === "editor" && (
          <div className="settings-body">
            <section className="settings-section">
              <span className="settings-section-label">笔记编辑</span>
              <div className="settings-group">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">显示行号</span>
                    <span className="settings-row-desc">在笔记左侧显示每行的编号。</span>
                  </div>
                  <div className="settings-row-control">
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={lineNumbers}
                        onChange={(e) => setLineNumbers(e.target.checked)}
                      />
                      <span>{lineNumbers ? "开启" : "关闭"}</span>
                    </label>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">限制正文宽度</span>
                    <span className="settings-row-desc">让每行文字保持适合阅读的长度，避免铺满整个窗口。</span>
                  </div>
                  <div className="settings-row-control">
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={readableLineLength}
                        onChange={(e) => setReadableLineLength(e.target.checked)}
                      />
                      <span>{readableLineLength ? "开启" : "关闭"}</span>
                    </label>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">正文字号</span>
                    <span className="settings-row-desc">调整笔记中的文字大小（11～22 像素）。</span>
                  </div>
                  <div className="settings-row-control">
                    <input
                      type="range"
                      min={11}
                      max={22}
                      step={1}
                      value={editorFontSize}
                      onChange={(e) => setEditorFontSize(Number(e.target.value))}
                    />
                    <span className="settings-row-desc">{editorFontSize}px</span>
                  </div>
                </div>

                {/* All three controls above act on the note editor — which this modal's own
                    full-screen backdrop (`.overlay-backdrop`, index.css) covers while Settings is
                    open, so toggling them looked like nothing happened at all. This sample carries
                    the same three rules, so the effect is visible next to the switch that causes
                    it. Its width cap is proportional, not the editor's literal 700px: that cap
                    could never bind inside a panel this narrow. */}
                <div className="settings-row settings-editor-preview">
                  <span className="settings-row-desc">效果预览</span>
                  <div
                    className={`editor-preview-surface ${readableLineLength ? "readable" : ""}`}
                    style={{ fontSize: `${editorFontSize}px` }}
                  >
                    {EDITOR_PREVIEW_LINES.map((line, i) => (
                      <div className="editor-preview-line" key={i}>
                        {lineNumbers && <span className="editor-preview-gutter">{i + 1}</span>}
                        <span className="editor-preview-text">{line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === "appearance" && (
          <div className="settings-body">
            <section className="settings-section">
              <span className="settings-section-label">界面外观</span>
              <div className="settings-group">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">界面主题</span>
                    <span className="settings-row-desc">选择深色或浅色界面。</span>
                  </div>
                  <div className="settings-row-control">
                    <button
                      className={`connection-chip ${theme === "dark" ? "active" : ""}`}
                      onClick={() => setTheme("dark")}
                    >
                      深色
                    </button>
                    <button
                      className={`connection-chip ${theme === "light" ? "active" : ""}`}
                      onClick={() => setTheme("light")}
                    >
                      浅色
                    </button>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">主题强调色</span>
                    <span className="settings-row-desc">调整按钮、链接和选中内容的颜色。</span>
                  </div>
                  <div className="settings-row-control">
                    <div className="accent-swatches">
                      {ACCENT_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          className={`accent-swatch ${accentColor === preset.hex || (!accentColor && preset.hex === null) ? "active" : ""}`}
                          style={{ background: preset.hex ?? "var(--color-accent)" }}
                          title={preset.label}
                          onClick={() => setAccentColor(preset.hex ?? undefined)}
                        />
                      ))}
                      <input
                        type="color"
                        value={accentColor ?? "#4cc2ff"}
                        onChange={(e) => setAccentColor(e.target.value)}
                        title="自选主题色"
                      />
                    </div>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">界面缩放</span>
                    <span className="settings-row-desc">调整整个界面的大小（80%～130%）。</span>
                  </div>
                  <div className="settings-row-control">
                    <input
                      type="range"
                      min={0.8}
                      max={1.3}
                      step={0.05}
                      value={uiZoom}
                      onChange={(e) => setUiZoom(Number(e.target.value))}
                    />
                    <span className="settings-row-desc">{Math.round(uiZoom * 100)}%</span>
                    <button
                      className="settings-icon-btn"
                      disabled={uiZoom === 1}
                      title="恢复为原始大小（100%）"
                      onClick={() => setUiZoom(1)}
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === "hotkeys" && (
          <div className="settings-body">
            <p className="settings-hint">以下快捷键目前仅供查看，暂时不能修改。</p>
            <section className="settings-section">
              <span className="settings-section-label">快捷操作</span>
              <div className="settings-group">
                {HOTKEYS.map((hotkey) => (
                  <div className="settings-row" key={hotkey.keys}>
                    <span className="settings-row-title">{hotkey.label}</span>
                    <Keycaps combo={hotkey.keys} />
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "web" && (
          <div className="settings-body">
            <p className="settings-hint">
              在内置浏览器的地址栏中输入关键词时，使用下方的搜索引擎。
            </p>
            <section className="settings-section">
              <span className="settings-section-label">搜索</span>
              <div className="settings-group">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">搜索引擎</span>
                    <span className="settings-row-desc">用于地址栏搜索和新建网页标签。</span>
                  </div>
                  <div className="settings-row-control">
                    <select value={searchEngine} onChange={(e) => setSearchEngine(e.target.value)}>
                      {SEARCH_ENGINES.map((engine) => (
                        <option key={engine.id} value={engine.id}>
                          {engine.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {searchEngine === "custom" && (
                  <label className="settings-field">
                    <span>自定义搜索网址</span>
                    <input
                      value={customSearchUrl}
                      onChange={(e) => setCustomSearchUrl(e.target.value)}
                      placeholder="https://example.com/search?q=%s"
                      spellCheck={false}
                    />
                    <span className="settings-row-desc">
                      使用 <code>%s</code> 代替搜索关键词。可以直接使用 Chrome 或 Firefox 中的自定义搜索网址。
                    </span>
                  </label>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === "account" && (
          <div className="settings-body">
            {!hasGoogleApi && (
              <p className="settings-hint">
                登录功能需要桌面版，网页版暂不支持。
              </p>
            )}
            <section className="settings-section">
              <span className="settings-section-label">Google 账号</span>
              <div className="settings-group">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">Google 账号</span>
                    <span className="settings-row-desc">
                      {googleProfile
                        ? `已登录：${googleProfile.name || googleProfile.email}${googleProfile.name ? ` (${googleProfile.email})` : ""}.`
                        : "通过 Google 账号登录。授权会在系统浏览器中进行，Astro 不会读取你的密码。云端同步目前尚未开放。"}
                    </span>
                  </div>
                  <div className="settings-row-control">
                    {googleProfile ? (
                      <button
                        className="connection-chip"
                        onClick={() => {
                          void window.googleAuthAPI?.signOut();
                          setGoogleProfile(null);
                        }}
                      >
                        <LogOut size={14} />
                        退出登录
                      </button>
                    ) : (
                      <button
                        className="connection-chip connect"
                        disabled={!hasGoogleApi || googleBusy || !googleClientId.trim()}
                        onClick={() => void signInWithGoogle()}
                      >
                        <LogIn size={14} />
                        {googleBusy ? "等待浏览器完成登录…" : "使用 Google 账号登录"}
                      </button>
                    )}
                  </div>
                </div>

                {!googleProfile && (
                  <label className="settings-field">
                    <span>Google 登录应用编号（OAuth 客户端 ID）</span>
                    <input
                      value={googleClientId}
                      onChange={(e) => setGoogleClientId(e.target.value)}
                      placeholder="…apps.googleusercontent.com"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <span className="settings-row-desc">
                      此功能需要你在 Google Cloud 控制台自行创建登录应用，类型选择 <em>桌面应用</em> ，再把应用编号粘贴到这里。这里不需要填写客户端密钥。
                    </span>
                  </label>
                )}
              </div>
            </section>

            {googleError && <p className="settings-error">{googleError}</p>}
          </div>
        )}

        {tab === "sync" && (
          <div className="settings-body">
            <section className="settings-section">
              <span className="settings-section-label">知识库</span>
              <div className="settings-group">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">云端知识库</span>
                    <span className="settings-row-desc">
                      目前笔记只保存在本机，云端知识库尚未开放。
                    </span>
                  </div>
                  <div className="settings-row-control">
                    <span className="settings-badge-soon">暂未开放</span>
                    <button className="connection-chip" disabled>
                      连接
                    </button>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">当前知识库</span>
                    <span className="settings-row-desc">
                      {hasVaultApi ? currentVault?.path ?? "…" : "浏览器本地存储"}
                    </span>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">备份</span>
                    <span className="settings-row-desc">
                      将整个知识库导出为一个备份文件，可用于保存副本或迁移到其他电脑。
                    </span>
                  </div>
                  <div className="settings-row-control">
                    <button className="connection-chip" onClick={() => void exportVault()}>
                      导出知识库备份
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === "connections" && hasMcpApi && (
          <div className="settings-body">
            <p className="settings-hint">
              允许电脑上的智能助手通过 MCP（工具连接协议）读取和编辑当前知识库。连接会跟随 Astro 当前打开的知识库。
            </p>

            {mcpData && !mcpData.entryPath && (
              <p className="settings-error">
                工具连接服务尚未构建，请运行： <code>pnpm --filter @solen/mcp-server build</code>
              </p>
            )}

            {/* The one thing Astro can prove. It cannot watch a client read its config, so instead
                it runs the exact command those configs contain and reports what came back — and
                says plainly which part of the chain that does not cover. */}
            {mcpData && (
              <section className="settings-section">
                <span className="settings-section-label">检查连接是否可用</span>
                <div className="settings-group">
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-row-title">模拟外部工具连接知识库</span>
                      <span className="settings-row-desc">
                        {mcpTesting
                          ? "正在启动连接服务…"
                          : mcpTest?.ok
                            ? `服务已启动，已找到知识库并读取 ${mcpTest.noteCount} 篇笔记。已经运行的外部工具需要重新启动，才能读取新配置。`
                            : mcpTest
                              ? mcpTest.error
                              : "启动连接服务并尝试读取笔记列表，检查其他工具能否访问当前知识库。"}
                      </span>
                      {mcpTest?.ok && mcpTest.vaultPath && (
                        <span className="settings-row-path" title={tildeHome(mcpTest.vaultPath)}>
                          {tildeHome(mcpTest.vaultPath)}
                        </span>
                      )}
                    </div>
                    <div className="settings-row-control">
                      <button
                        className="connection-chip connect"
                        disabled={!mcpData.entryPath || mcpTesting}
                        onClick={() => void mcpRunTest()}
                      >
                        {mcpTesting ? "正在检查…" : "检查连接"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {mcpData && mcpData.clients.length > 0 && (
              <section className="settings-section">
                <span className="settings-section-label">可连接的工具</span>
                <div className="settings-group">
                  {mcpData.clients.map((client) => (
                    <div className="settings-row" key={client.id}>
                      <div className="settings-row-info">
                        <span className="settings-row-title">
                          {client.name}
                          {/* Advisory, never a blocker: a config folder outlives an uninstall and a
                              fresh install may not have written one yet, so the row stays actionable
                              and just says what Astro could and couldn't find. */}
                          {!client.detected && <span className="settings-row-tag">未检测到安装</span>}
                          {client.stale && <span className="settings-row-tag warn">旧版配置</span>}
                        </span>
                        <span className="settings-row-desc">
                          {mcpConfirmId === client.id
                            ? `电脑上没有找到 ${client.name}。仍然添加配置后，安装该工具即可使用。`
                            : client.error
                              ? client.error
                              : client.stale
                                ? "当前配置是旧版本，请重新添加以更新。"
                                : client.state === "configured"
                                  ? MCP_STATE_LABEL[client.state]
                                  : client.detected
                                    ? "将写入以下配置文件"
                                    : // The path below is where Astro *would* write, not something
                                      // it found — without this the row read as "found the file,
                                      // but says not detected", which is a contradiction.
                                      "未在安装目录、卸载记录和开始菜单中找到此工具。仍然添加后，配置将写入："}
                        </span>
                        {/* Home collapsed to `~`: the full path overflowed onto a second line and got
                            clipped, and it put the account name on screen for anyone the user shows
                            this pane to. */}
                        <span className="settings-row-path" title={tildeHome(client.configPath)}>
                          {tildeHome(client.configPath)}
                        </span>
                      </div>
                      <div className="settings-row-control">
                        {mcpConfirmId === client.id && (
                          <button className="connection-chip" onClick={() => setMcpConfirmId(null)}>
                            取消
                          </button>
                        )}
                        {/* An unparseable config file used to be a dead end: Add disabled, no way
                            forward. Reveal stays enabled precisely then, since fixing the file by
                            hand is the only route out. */}
                        {(client.error || client.state === "configured") && (
                          <button className="connection-chip" onClick={() => void window.mcpAPI?.revealConfig(client.id)}>
                            打开所在文件夹
                          </button>
                        )}
                        <button
                          className={`connection-chip ${client.state === "configured" && !client.stale ? "" : "connect"}`}
                          disabled={!mcpData.entryPath || !!client.error || mcpBusyId === client.id}
                          onClick={() => void mcpToggle(client)}
                        >
                          {client.stale
                            ? "更新配置"
                            : client.state === "configured"
                              ? "移除连接"
                              : mcpConfirmId === client.id
                                ? "仍然添加"
                                : "添加"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Only clients with an actual pasteable snippet render here — one with neither a
                Connect button nor a snippet (e.g. `snippetFormat: "none"`) is a dead end, so it's
                filtered out rather than shown as an inert row (see docs/DESIGN.md's Connections
                tab requirement: every row offers an action). */}
            {mcpData &&
              (() => {
                const withSnippet = mcpData.unverified
                  .map((client) => ({ client, snippet: mcpSnippet(client, mcpData.entryPath) }))
                  .filter((entry): entry is { client: McpUnverifiedClient; snippet: string } => entry.snippet !== null);
                if (withSnippet.length === 0) return null;
                return (
                  <section className="settings-section">
                    <span className="settings-section-label">手动配置</span>
                    <p className="settings-hint">
                      这些工具的配置位置或格式尚未确认，请复制下方内容，手动添加到对应配置文件。
                    </p>
                    <div className="settings-group">
                      {withSnippet.map(({ client, snippet }) => (
                        <div className="settings-row settings-row--mcp-unverified" key={client.id}>
                          <div className="settings-row-info">
                            <span className="settings-row-title">{client.name}</span>
                            <span className="settings-row-desc">
                              {client.pathHint ? `${client.pathHint} — ` : ""}
                              {client.note}
                            </span>
                            <pre className="settings-mcp-snippet">{snippet}</pre>
                          </div>
                          <div className="settings-row-control">
                            <button className="connection-chip" onClick={() => mcpCopy(client.id, snippet)}>
                              {mcpCopiedId === client.id ? <Check size={14} /> : <Copy size={14} />}
                              {mcpCopiedId === client.id ? "已复制" : "复制"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })()}
          </div>
        )}

        {tab === "ai" && (
          <div className="settings-body settings-ai-body">
            <div className="settings-ai-scroll">
            <p className="settings-hint">服务密钥保存在当前知识库中，仅发送给你选择的模型服务。</p>
            <section className="settings-section">
              <span className="settings-section-label">模型服务</span>
              <div className="settings-group">
                <label className="settings-field">
                  <span>模型服务</span>
                  <select aria-label="模型服务" value={connectionKind}
                    onChange={e => setDraft(switchConnectionKind(draft, e.target.value as ConnectionKind))}>
                    <option value="deepseek">DeepSeek</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai-compatible">兼容 OpenAI 接口的在线服务</option>
                    <option value="local">本地模型（Ollama、LM Studio 等）</option>
                  </select>
                </label>
                {connectionKind === "deepseek" && <div className="settings-deepseek-help">
                  <span>官方接口地址已自动填写，填入你的 DeepSeek 密钥即可使用。</span>
                  <button type="button" className="connection-chip" onClick={() => openExternal("https://platform.deepseek.com/")}>获取 DeepSeek 密钥</button>
                </div>}
                {connectionKind !== "local" && <label className="settings-field">
                  <span>服务密钥（API Key）</span>
                  <input aria-label="服务密钥" type="password" value={draft.apiKey}
                    onChange={e => setDraft({ ...draft, apiKey: e.target.value })} placeholder="在这里粘贴你的 API 密钥" autoComplete="off" spellCheck={false} />
                </label>}
                {connectionKind === "deepseek" ? <>
                  <label className="settings-field">
                    <span>使用的模型</span>
                    <select aria-label="DeepSeek 模型" value={DEEPSEEK_MODELS.some(m => m.id === draft.model) ? draft.model : "custom"}
                      onChange={e => setDraft({ ...draft, model: e.target.value === "custom" ? "" : e.target.value })}>
                      {DEEPSEEK_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      <option value="custom">其他模型（手动填写）</option>
                    </select>
                  </label>
                  {!DEEPSEEK_MODELS.some(m => m.id === draft.model) && <label className="settings-field">
                    <span>自定义模型名称</span>
                    <input aria-label="自定义模型名称" value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} placeholder="填写开放平台提供的模型名称" />
                  </label>}
                  <div className="settings-row">
                    <div className="settings-row-info"><span className="settings-row-title">深入思考</span><span className="settings-row-desc">适合复杂代码和排错，回复通常需要更长时间。</span></div>
                    <label className="settings-toggle"><input aria-label="深入思考" type="checkbox" checked={!!draft.deepSeekThinking} onChange={e => setDraft({ ...draft, deepSeekThinking: e.target.checked })} /><span>{draft.deepSeekThinking ? "已开启" : "已关闭"}</span></label>
                  </div>
                </> : <>
                  <label className="settings-field">
                    <span>模型名称</span>
                    <input aria-label="模型名称" value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })}
                      placeholder={draft.provider === "anthropic" ? "claude-sonnet-5" : connectionKind === "local" ? "llama3, mistral, …" : "gpt-4o-mini"} />
                  </label>
                  <label className="settings-field">
                    <span>{connectionKind === "local" ? "本地模型服务地址" : "服务接口地址"} {draft.provider === "anthropic" ? "（选填）" : ""}</span>
                    <input aria-label="服务接口地址" value={draft.baseUrl} onChange={e => setDraft({ ...draft, baseUrl: e.target.value })}
                      placeholder={draft.provider === "anthropic" ? "https://api.anthropic.com" : connectionKind === "local" ? "http://localhost:11434/v1" : "https://api.openai.com/v1"} />
                  </label>
                </>}

              </div>
            </section>
            </div>
            <div className="settings-ai-footer">
                <div className="settings-row">
                  <div className="settings-row-control settings-ai-actions">
                    <button type="button" className="connection-chip" disabled={aiTesting} onClick={() => void runAITest()}>{aiTesting ? "正在测试…" : "测试连接"}</button>
                    {aiTesting && <button type="button" className="connection-chip" onClick={() => aiTestController.current?.abort()}>取消测试</button>}
                    <button className="connection-chip connect" disabled={aiUnchanged} onClick={save}>保存设置</button>
                  </div>
                </div>
                {aiTest && <p className={"settings-ai-result " + (aiTest.ok ? "success" : "error")} role={aiTest.ok ? "status" : "alert"}>{aiTest.message}</p>}
                {saved && aiUnchanged && <p className="settings-ai-result" role="status">{connectionKind === "deepseek" && !draft.apiKey.trim() ? "设置已保存，填入 DeepSeek 密钥后即可使用。" : "设置已保存，返回智能助手即可开始对话。"}</p>}
            </div>
          </div>
        )}


        {tab === "plugins" && (
          <div className="settings-body">
            {loadedPlugins.length === 0 ? (
              <p className="settings-plugin-empty">尚未安装插件</p>
            ) : (
              <section className="settings-section">
                <span className="settings-section-label">已安装</span>
                <div className="settings-group">
                  {loadedPlugins.map((p) => {
                    // A plugin only gets an Open button if it actually registered a panel (see
                    // plugins/manager.ts's `solen:plugin-panel-open` listener) — reusing that same
                    // event rather than inventing a second way to surface a panel.
                    const panel = Object.values(pluginPanels).find((pnl) => pnl.pluginId === p.id);
                    return (
                      <div className="settings-row" key={p.id}>
                        <div className="settings-row-info">
                          <span className="settings-row-title">{p.name}</span>
                          <span className="settings-row-desc">
                            {p.id}
                            {p.version ? ` · v${p.version}` : ""}
                          </span>
                        </div>
                        <div className="settings-row-control">
                          {panel && (
                            <button
                              className="connection-chip"
                              onClick={() => {
                                // Close first: the drawer opens *behind* this modal, so without
                                // this the button looks like it does nothing at all.
                                close();
                                window.dispatchEvent(new CustomEvent("solen:plugin-panel-open", { detail: { id: panel.id } }));
                              }}
                            >
                              打开
                            </button>
                          )}
                          <label className="settings-toggle">
                            <input
                              type="checkbox"
                              checked={p.enabled}
                              onChange={(e) => void setPluginEnabled(p.id, e.target.checked)}
                            />
                            <span>{p.enabled ? "已启用" : "已停用"}</span>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === "about" && (
          <div className="settings-body">
            <section className="settings-section">
              <span className="settings-section-label">关于 Astro 中文版</span>
              <div className="settings-group">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">Astro</span>
                    <span className="settings-row-desc">
                      本地保存的知识笔记软件，支持 Markdown 笔记、立体知识星图、插件和智能助手。此版本为本地汉化版。
                    </span>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">版本</span>
                    <span className="settings-row-desc">{webVersion}</span>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">数据保存方式</span>
                    <span className="settings-row-desc">
                      笔记以 Markdown 和 JSON 文件保存在自己的电脑上，无需注册账号即可使用。
                    </span>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">开源许可</span>
                    <span className="settings-row-desc">MIT</span>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">项目源码</span>
                    <span className="settings-row-desc">在 GitHub 上查看文档和源码。</span>
                  </div>
                  <div className="settings-row-control">
                    <button className="connection-chip" onClick={() => openExternal("https://github.com/Solen-AI-org")}>
                      GitHub
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <span className="settings-section-label">原项目开发团队</span>
              <div className="settings-group">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">Solen AI</span>
                    <span className="settings-row-desc">
                      Solen AI 开发能够理解上下文、规划任务和操作工具的智能助手 Jarvis。Astro 是该团队的开源项目之一。
                    </span>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-about-links">
                    {SOLEN_LINKS.map((link) => (
                      <button key={link.url} className="connection-chip" onClick={() => openExternal(link.url)}>
                        {link.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
