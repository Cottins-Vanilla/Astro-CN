import { create } from "zustand";
import type { CommandDef, PanelDef, ThemeDef } from "@solen/plugin-api";

export interface RegisteredCommand extends CommandDef {
  pluginId: string;
}

export interface RegisteredPanel extends PanelDef {
  pluginId: string;
}

export interface RegisteredTheme extends ThemeDef {
  pluginId: string;
}

export interface LoadedPluginInfo {
  id: string;
  name: string;
  version?: string;
  enabled: boolean;
}

interface PluginStoreState {
  commands: Record<string, RegisteredCommand>;
  panels: Record<string, RegisteredPanel>;
  themes: Record<string, RegisteredTheme>;
  loaded: LoadedPluginInfo[];
  activePanelId: string | null;
  drawerOpen: boolean;

  registerCommand: (cmd: RegisteredCommand) => void;
  unregisterCommand: (id: string) => void;
  registerPanel: (panel: RegisteredPanel) => void;
  unregisterPanel: (id: string) => void;
  registerTheme: (theme: RegisteredTheme) => void;
  unregisterPluginThemes: (pluginId: string) => void;
  setLoaded: (list: LoadedPluginInfo[]) => void;
  toggleDrawer: () => void;
  setActivePanel: (id: string | null) => void;
}

/**
 * Registries the plugin host (apps/web/src/plugins/host.ts) writes into and
 * the UI (CommandPalette, PluginDrawer, SettingsModal) reads from. Kept as
 * its own small store, separate from the vault-backed app store in
 * ../store.ts, since none of this is vault data — it's rebuilt from plugin
 * `onload` calls on every launch.
 */
export const usePluginStore = create<PluginStoreState>((set, get) => ({
  commands: {},
  panels: {},
  themes: {},
  loaded: [],
  activePanelId: null,
  drawerOpen: false,

  registerCommand(cmd) {
    set({ commands: { ...get().commands, [cmd.id]: cmd } });
  },

  unregisterCommand(id) {
    const commands = { ...get().commands };
    delete commands[id];
    set({ commands });
  },

  registerPanel(panel) {
    const panels = { ...get().panels, [panel.id]: panel };
    set({ panels, activePanelId: get().activePanelId ?? panel.id });
  },

  unregisterPanel(id) {
    const panels = { ...get().panels };
    delete panels[id];
    const activePanelId = get().activePanelId === id ? (Object.keys(panels)[0] ?? null) : get().activePanelId;
    set({ panels, activePanelId });
  },

  registerTheme(theme) {
    set({ themes: { ...get().themes, [theme.id]: theme } });
  },

  unregisterPluginThemes(pluginId) {
    const themes = Object.fromEntries(Object.entries(get().themes).filter(([, t]) => t.pluginId !== pluginId));
    set({ themes });
  },

  setLoaded(list) {
    set({ loaded: list });
  },

  toggleDrawer() {
    set({ drawerOpen: !get().drawerOpen });
  },

  setActivePanel(id) {
    set({ activePanelId: id, drawerOpen: true });
  },
}));
