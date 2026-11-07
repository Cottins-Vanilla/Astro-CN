import type {
  CanvasContent,
  CanvasSummary,
  CommandDef,
  NoteContent,
  NoteSummary,
  PanelDef,
  SolenAPI,
  SolenEventName,
  SolenEventPayloads,
  ThemeDef,
} from "@solen/plugin-api";
import { useStore, vault } from "../store";
import { vaultEvents } from "../events";
import { completeOnce } from "../ai/complete";
import { usePluginStore } from "./store";

/**
 * Builds a `SolenAPI` implementation backed by the app's store and vault —
 * the same objects the built-in canvas/editor/sidebar use, so this is the
 * one place a plugin's calls turn into real vault reads/writes. Every
 * registration is tagged with `pluginId` so `teardownPlugin` can undo
 * exactly what a given plugin added when it's disabled.
 */
export function createHostAPI(pluginId: string): SolenAPI {
  const eventUnsubscribes: Array<() => void> = [];

  const api: SolenAPI = {
    commands: {
      register(command: CommandDef) {
        usePluginStore.getState().registerCommand({ ...command, pluginId });
      },
      unregister(id: string) {
        usePluginStore.getState().unregisterCommand(id);
      },
    },

    notes: {
      async list(): Promise<NoteSummary[]> {
        return useStore.getState().noteList;
      },
      async read(id: string): Promise<NoteContent> {
        const cached = useStore.getState().notes[id];
        return cached ?? (await vault.readNote(id));
      },
      async create(title, body): Promise<NoteContent> {
        const note = await useStore.getState().createNote(title);
        if (body) {
          useStore.getState().updateNoteBody(note.id, body);
          return { ...note, body };
        }
        return note;
      },
      async update(id, patch): Promise<void> {
        if (patch.title !== undefined) useStore.getState().updateNoteTitle(id, patch.title);
        if (patch.body !== undefined) useStore.getState().updateNoteBody(id, patch.body);
      },
      async open(id): Promise<void> {
        await useStore.getState().openNote(id);
      },
    },

    canvases: {
      async list(): Promise<CanvasSummary[]> {
        return vault.listCanvases();
      },
      async read(id: string): Promise<CanvasContent> {
        const doc = await vault.readCanvas(id);
        return {
          id: doc.id,
          name: doc.name,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          nodeCount: doc.nodes.length,
          edgeCount: doc.edges.length,
        };
      },
      current(): CanvasSummary | null {
        // The app no longer has a single "open" canvas — canvases are now
        // purely the 3D graph's structural-edge store (see
        // docs/WORKSPACE-3D.md), not something a user browses into.
        return null;
      },
    },

    events: {
      on<K extends SolenEventName>(name: K, handler: (payload: SolenEventPayloads[K]) => void) {
        vaultEvents.on(name, handler);
        eventUnsubscribes.push(() => vaultEvents.off(name, handler));
      },
      off<K extends SolenEventName>(name: K, handler: (payload: SolenEventPayloads[K]) => void) {
        vaultEvents.off(name, handler);
      },
    },

    ui: {
      registerPanel(panel: PanelDef) {
        usePluginStore.getState().registerPanel({ ...panel, pluginId });
      },
      registerTheme(theme: ThemeDef) {
        usePluginStore.getState().registerTheme({ ...theme, pluginId });
      },
    },

    ai: {
      complete(prompt, opts) {
        return completeOnce(prompt, opts);
      },
    },
  };

  // Stashed so `teardownPlugin` can drop every `events.on` subscription this
  // plugin made, in addition to its commands/panels/themes.
  hostSubscriptions.set(pluginId, eventUnsubscribes);
  return api;
}

const hostSubscriptions = new Map<string, Array<() => void>>();

/** Undo every registration a plugin made — called on disable/unload. */
export function teardownPlugin(pluginId: string): void {
  const ps = usePluginStore.getState();
  for (const cmd of Object.values(ps.commands)) if (cmd.pluginId === pluginId) ps.unregisterCommand(cmd.id);
  for (const panel of Object.values(ps.panels)) if (panel.pluginId === pluginId) ps.unregisterPanel(panel.id);
  ps.unregisterPluginThemes(pluginId);
  for (const off of hostSubscriptions.get(pluginId) ?? []) off();
  hostSubscriptions.delete(pluginId);
}
