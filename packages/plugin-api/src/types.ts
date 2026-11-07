/**
 * The public plugin surface for Astro (docs/ARCHITECTURE.md's "Plugin
 * system"). This package has no runtime dependencies and no React import —
 * plugins compile against these types alone and receive a `SolenAPI` object
 * at load time. The host implementation lives in
 * apps/web/src/plugins/host.ts and is the same surface the app's own
 * built-in features use.
 */

/** A plugin module — the default export of a plugin entry file. */
export interface SolenPlugin {
  id: string;
  name: string;
  version?: string;
  onload(api: SolenAPI): void | Promise<void>;
  onunload?(): void;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandDef {
  id: string;
  name: string;
  run: () => void | Promise<void>;
  /** Extra terms the command palette's fuzzy search should also match. */
  keywords?: string[];
}

export interface CommandsAPI {
  register(command: CommandDef): void;
  unregister(id: string): void;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** Mirrors `@solen/core`'s `NoteMeta` shape without depending on the package. */
export interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteContent extends NoteSummary {
  body: string;
}

export interface NotesAPI {
  list(): Promise<NoteSummary[]>;
  read(id: string): Promise<NoteContent>;
  create(title?: string, body?: string): Promise<NoteContent>;
  update(id: string, patch: { title?: string; body?: string }): Promise<void>;
  /** Opens a note in the app's editor, replacing whatever is currently open. */
  open(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------

export interface CanvasSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasContent extends CanvasSummary {
  nodeCount: number;
  edgeCount: number;
}

export interface CanvasesAPI {
  list(): Promise<CanvasSummary[]>;
  read(id: string): Promise<CanvasContent>;
  /** The canvas currently open in the app, or `null` if none is. */
  current(): CanvasSummary | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface SolenEventPayloads {
  "note:created": { id: string };
  "note:updated": { id: string };
  "note:deleted": { id: string };
  "canvas:changed": { id: string };
  "theme:changed": { theme: string };
}

export type SolenEventName = keyof SolenEventPayloads;

export interface EventsAPI {
  on<K extends SolenEventName>(name: K, handler: (payload: SolenEventPayloads[K]) => void): void;
  off<K extends SolenEventName>(name: K, handler: (payload: SolenEventPayloads[K]) => void): void;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export interface PanelDef {
  id: string;
  title: string;
  icon?: string;
  /**
   * Called when the panel becomes visible, with an empty container element
   * to render into (framework-agnostic — plain DOM). Return a cleanup
   * function; it runs when the panel is hidden or the plugin is disabled.
   */
  render(el: HTMLElement): () => void;
}

export interface ThemeDef {
  id: string;
  name: string;
  /** CSS custom-property overrides, e.g. `{ "--color-accent": "#ff6f61" }`. */
  vars: Record<string, string>;
}

export interface UIAPI {
  registerPanel(panel: PanelDef): void;
  registerTheme(theme: ThemeDef): void;
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface AICompleteOptions {
  system?: string;
  signal?: AbortSignal;
}

export interface AIAPI {
  /** Non-streaming convenience: the active provider's response, concatenated. */
  complete(prompt: string, opts?: AICompleteOptions): Promise<string>;
}

// ---------------------------------------------------------------------------
// Root API
// ---------------------------------------------------------------------------

export interface SolenAPI {
  commands: CommandsAPI;
  notes: NotesAPI;
  canvases: CanvasesAPI;
  events: EventsAPI;
  ui: UIAPI;
  /** Wired to the active AI provider; present whenever the host supports AI. */
  ai?: AIAPI;
}
