import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { usePanelMount } from "../usePanelMount";
import { renderMarkdown } from "../markdown";
import { createProvider } from "../ai/providers";
import { connectionKindOf } from "../ai/presets";
import { isAIConfigured, type AIProviderConfig, type ChatMessage } from "../ai/types";
import { loadLinkIndex } from "../linkIndex";

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: string;
  modelLabel?: string;
}

function modelInfo(config: AIProviderConfig) {
  const kind = connectionKindOf(config);
  const service = kind === "deepseek" ? "DeepSeek" : kind === "anthropic" ? "Anthropic" : kind === "local" ? "本地模型" : "兼容接口";
  const model = config.model.trim() || (kind === "deepseek" ? "deepseek-flash" : kind === "anthropic" ? "claude-sonnet-5" : "gpt-4o-mini");
  return { service, model, thinking: kind === "deepseek" ? !!config.deepSeekThinking : undefined };
}

function newId(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * Floating AI chat panel (see App.tsx's .floating-dock). Toggle via the sidebar button, Ctrl+J, or the
 * command palette. Streams the active provider's response token-by-token;
 * when "Context" is on, the system prompt includes the open note's
 * title/body plus the titles of its linked/backlinked notes.
 */
export function AIPanel() {
  const open = useStore((s) => s.aiPanelOpen);
  const { mounted, visible } = usePanelMount(open);
  const toggle = useStore((s) => s.toggleAIPanel);
  const aiConfig = useStore((s) => s.aiConfig);
  const note = useStore((s) => (s.openNoteId ? s.notes[s.openNoteId] : undefined));
  const openSettings = useStore((s) => s.openSettings);

  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [lastInsert, setLastInsert] = useState<{ messageId: string; noteId: string } | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [contextOn, setContextOn] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const configured = isAIConfigured(aiConfig);
  const currentModel = modelInfo(aiConfig);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, toggle]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function buildSystemPrompt(): Promise<string | undefined> {
    if (!contextOn || !note) return undefined;
    let text = `用户当前打开的笔记标题为“${note.title || "未命名"}":\n\n${note.body}`;
    try {
      const index = await loadLinkIndex();
      const titleById = new Map(index.nodes.map((n) => [n.id, n.title]));
      const linked = new Set<string>();
      for (const edge of index.edges) {
        if (edge.from === note.id && edge.to !== note.id) {
          const title = titleById.get(edge.to);
          if (title) linked.add(title);
        }
        if (edge.to === note.id && edge.from !== note.id) {
          const title = titleById.get(edge.from);
          if (title) linked.add(title);
        }
      }
      if (linked.size > 0) text += `\n\n相关笔记：${[...linked].join(", ")}`;
    } catch {
      // Context is best-effort — a link-index failure shouldn't block the chat.
    }
    return text;
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    const requestConfig = { ...aiConfig };
    const requestModel = modelInfo(requestConfig);
    const modelLabel = requestModel.service + " · " + requestModel.model + (requestModel.thinking === undefined ? "" : requestModel.thinking ? " · 深入思考" : " · 普通回复");
    const userEntry: ChatEntry = { id: newId(), role: "user", content: text };
    const assistantId = newId();
    const priorTurns = messages.filter((m) => !m.error);
    setMessages((m) => [...m, userEntry, { id: assistantId, role: "assistant", content: "", modelLabel }]);

    if (!configured) {
      setMessages((m) =>
        m.map((e) => (e.id === assistantId ? { ...e, error: "尚未设置智能助手。" } : e)),
      );
      return;
    }

    const system = await buildSystemPrompt();
    const history: ChatMessage[] = [...priorTurns, userEntry].map((e) => ({ role: e.role, content: e.content }));

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    try {
      const provider = createProvider(requestConfig);
      for await (const chunk of provider.complete({ system, messages: history, signal: controller.signal })) {
        setMessages((m) => m.map((e) => (e.id === assistantId ? { ...e, content: e.content + chunk } : e)));
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setMessages((m) => m.map((e) => (e.id === assistantId ? { ...e, content: e.content || "（已停止）" } : e)));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((m) => m.map((e) => (e.id === assistantId ? { ...e, error: message } : e)));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function insertIntoNote(messageId: string, content: string) {
    const state = useStore.getState();
    const current = state.openNoteId ? state.notes[state.openNoteId] : undefined;
    if (!current) return;
    const trimmed = current.body.replace(/\s+$/, "");
    state.updateNoteBody(current.id, (trimmed ? trimmed + "\n\n" : "") + content + "\n");
    setLastInsert({ messageId, noteId: current.id });
  }

  if (!mounted) return null;

  return (
    <div className={`floating-panel ai-panel ${visible ? "panel-open" : "panel-closed"}`}>
      <div className="dock-panel-header">
        <span>智能助手</span>
        <button className="ai-provider-settings" onClick={() => openSettings("ai")} title="设置模型服务">模型设置</button>
        <button
          onClick={toggle}
          title="关闭（Esc）"
          className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-base leading-none px-1"
        >
          ×
        </button>
      </div>

      <button className="ai-current-model" onClick={() => openSettings("ai")} aria-label="当前模型信息，点击修改模型设置">
        <span className="ai-model-heading"><span>当前模型</span><span className={"ai-model-state " + (configured ? "ready" : "")}>{!configured ? "尚未配置" : streaming ? "正在回复" : "配置已填写"}</span></span>
        <span className="ai-model-name" title={currentModel.model}>{currentModel.model}</span>
        <span className="ai-model-details"><span>{currentModel.service}</span>{currentModel.thinking !== undefined && <span>深入思考：{currentModel.thinking ? "开启" : "关闭"}</span>}<span className="ai-model-change">修改 ›</span></span>
      </button>


      {!configured && (
        <div className="p-4 text-sm text-[var(--color-muted)] flex flex-col gap-2 border-b border-[var(--color-border)]">
          <p>设置服务密钥，或连接电脑上的本地模型，即可开始对话。</p>
          <button className="connection-chip connect self-start" onClick={() => openSettings("ai")}>
            设置智能助手
          </button>
        </div>
      )}

      <div className="flex items-center px-3 py-2 border-b border-[var(--color-border)] text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[var(--color-muted)]">
          <input type="checkbox" checked={contextOn} onChange={(e) => setContextOn(e.target.checked)} disabled={!note} />
          <span>{note ? `参考笔记：“${note.title || "未命名"}”及相关笔记` : "参考内容（尚未打开笔记）"}</span>
        </label>
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-xs text-[var(--color-muted)]">在下方输入问题，回复会逐步显示。</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`ai-bubble ${m.role}`}>
            {m.role === "assistant" ? (
              <div
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content || (streaming ? "正在生成回复，请稍候…" : "")) }}
              />
            ) : (
              <div>{m.content}</div>
            )}
            {m.role === "assistant" && m.modelLabel && <div className="ai-reply-model" title={m.modelLabel}>{m.modelLabel}</div>}
            {m.error && <div className="ai-error">{m.error}</div>}
            {m.role === "assistant" && m.content && !m.error && (
              <button className="ai-insert-btn" onClick={() => insertIntoNote(m.id, m.content)} disabled={!note} title="将这条回复追加到当前笔记末尾">
                {lastInsert?.messageId === m.id && lastInsert.noteId === note?.id ? "已插入笔记末尾" : "插入当前笔记"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--color-border)] p-2 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="输入问题…"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        {streaming ? (
          <button onClick={stop} className="ai-send-btn stop">
            停止回复
          </button>
        ) : (
          <button onClick={() => void send()} disabled={!input.trim()} className="ai-send-btn">
            发送
          </button>
        )}
      </div>
    </div>
  );
}
