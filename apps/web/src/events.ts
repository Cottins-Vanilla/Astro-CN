import type { SolenEventName, SolenEventPayloads } from "@solen/plugin-api";

type Handler<K extends SolenEventName> = (payload: SolenEventPayloads[K]) => void;

/**
 * Tiny hand-rolled event emitter for vault-level events (note/canvas/theme
 * changes) — no dependency needed for a handful of listeners. The store
 * emits here as state changes (see store.ts); plugins subscribe through
 * `SolenAPI.events` (apps/web/src/plugins/host.ts), which just forwards to
 * this singleton.
 */
class VaultEventEmitter {
  private handlers = new Map<SolenEventName, Set<Handler<SolenEventName>>>();

  on<K extends SolenEventName>(name: K, handler: Handler<K>): void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as Handler<SolenEventName>);
  }

  off<K extends SolenEventName>(name: K, handler: Handler<K>): void {
    this.handlers.get(name)?.delete(handler as Handler<SolenEventName>);
  }

  emit<K extends SolenEventName>(name: K, payload: SolenEventPayloads[K]): void {
    for (const handler of this.handlers.get(name) ?? []) handler(payload);
  }
}

export const vaultEvents = new VaultEventEmitter();
