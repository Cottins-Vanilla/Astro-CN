import type { SolenPlugin } from "./types.js";

/**
 * Identity helper for plugin authors — wrapping a plugin object in
 * `definePlugin(...)` gives editors type-checking and autocomplete on
 * `onload`'s `api` parameter without writing an explicit `SolenPlugin`
 * annotation.
 */
export function definePlugin(plugin: SolenPlugin): SolenPlugin {
  return plugin;
}
