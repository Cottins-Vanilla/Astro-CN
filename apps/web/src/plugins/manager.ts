import type { SolenAPI, SolenPlugin } from "@solen/plugin-api";
import { useStore } from "../store";
import { createHostAPI, teardownPlugin } from "./host";
import { usePluginStore } from "./store";
import wordcountPlugin from "./builtin/wordcount";
import dailyNotePlugin from "./builtin/dailyNote";
import vaultDoctorPlugin from "./builtin/vaultDoctor";

/** Every plugin the app ships with. A real installer would extend this list at runtime. */
const BUILTIN_PLUGINS: SolenPlugin[] = [wordcountPlugin, dailyNotePlugin, vaultDoctorPlugin];

const activeApis = new Map<string, SolenAPI>();

// Plugins are plain DOM/SolenAPI code with no store import of their own (see
// builtin/wordcount.ts) — a command that wants to surface its panel does so
// by dispatching this event rather than reaching into app internals.
window.addEventListener("solen:plugin-panel-open", (e) => {
  const id = (e as CustomEvent<{ id: string }>).detail?.id;
  if (id) usePluginStore.getState().setActivePanel(id);
});

async function activatePlugin(plugin: SolenPlugin): Promise<void> {
  const api = createHostAPI(plugin.id);
  activeApis.set(plugin.id, api);
  try {
    await plugin.onload(api);
  } catch (err) {
    console.error(`插件“${plugin.id}”加载失败：`, err);
  }
}

function currentLoadedInfo() {
  const enabledMap = useStore.getState().pluginEnabled;
  return BUILTIN_PLUGINS.map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    enabled: enabledMap[p.id] ?? true,
  }));
}

/** Load and activate every enabled built-in plugin. Called once on startup. */
export async function loadPlugins(): Promise<void> {
  const infos = currentLoadedInfo();
  usePluginStore.getState().setLoaded(infos);
  for (const plugin of BUILTIN_PLUGINS) {
    if (infos.find((i) => i.id === plugin.id)?.enabled) await activatePlugin(plugin);
  }
}

/** Toggle a plugin on/off, persisting the choice and running its onload/onunload. */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  useStore.getState().setPluginEnabled(id, enabled);
  usePluginStore.getState().setLoaded(currentLoadedInfo());

  const plugin = BUILTIN_PLUGINS.find((p) => p.id === id);
  if (!plugin) return;

  if (enabled) {
    await activatePlugin(plugin);
  } else {
    plugin.onunload?.();
    teardownPlugin(id);
    activeApis.delete(id);
  }
}
