# Plugin development

Astro plugins are plain JavaScript/TypeScript modules. A plugin
receives a `SolenAPI` object when it loads and registers capabilities against
it — the same surface the app's built-in features use. Types live in the
[`@solen/plugin-api`](../packages/plugin-api) package, which has zero runtime
dependencies and no framework requirement.

## The shape of a plugin

```ts
import type { SolenPlugin } from "@solen/plugin-api";

const myPlugin: SolenPlugin = {
  id: "my-plugin",          // unique, kebab-case
  name: "My Plugin",
  version: "0.1.0",

  onload(api) {
    // register commands, panels, themes, listeners…
  },

  onunload() {
    // optional; unregistration of your registrations is automatic
  },
};

export default myPlugin;
```

`onload` may be async. When a plugin is disabled, the host runs `onunload`
(if present) and then tears down everything the plugin registered.

## API reference

| Namespace  | Member | Purpose |
|------------|--------|---------|
| `commands` | `register({ id, name, run, keywords? })` | Add an action to the Ctrl+K command palette. `keywords` are extra fuzzy-search terms. |
|            | `unregister(id)` | Remove it. |
| `notes`    | `list()` | All notes as `{ id, title, tags, createdAt, updatedAt }`. |
|            | `read(id)` | Full note including `body` (Markdown). |
|            | `create(title?, body?)` | New note in the vault. |
|            | `update(id, { title?, body? })` | Patch a note. |
| `canvases` | `list()` / `read(id)` | Canvas summaries; `read` adds node/edge counts. |
|            | `current()` | The open canvas, or `null`. |
| `events`   | `on(name, handler)` / `off(name, handler)` | Typed events: `note:created`, `note:updated`, `note:deleted`, `canvas:changed`, `theme:changed`. |
| `ui`       | `registerPanel({ id, title, icon?, render })` | A tab in the right-side plugin drawer. `render(el)` gets a plain DOM element and returns a cleanup function — use any rendering approach you like. |
|            | `registerTheme({ id, name, vars })` | A theme as CSS custom-property overrides. |
| `ai?`      | `complete(prompt, { system?, signal? })` | One-shot completion via whichever AI provider the user configured. Optional — check for presence before use. |

## Worked example

The app ships with a reference plugin,
[`wordcount`](../apps/web/src/plugins/builtin/wordcount.ts), that exercises
the whole surface: it registers a palette command, a drawer panel that
renders live vault statistics with plain DOM, and event listeners that
refresh the panel when notes change. Reading that one file is the fastest
way to learn the API.

The essentials, condensed:

```ts
onload(api) {
  api.commands.register({
    id: "my-plugin.stats",
    name: "My Plugin: Show stats",
    run: () => { /* … */ },
  });

  api.ui.registerPanel({
    id: "my-plugin",
    title: "Stats",
    render(el) {
      const refresh = async () => {
        const notes = await api.notes.list();
        el.textContent = `${notes.length} notes`;
      };
      void refresh();
      api.events.on("note:created", refresh);
      return () => api.events.off("note:created", refresh);
    },
  });
}
```

## Ground rules

- **The vault belongs to the user.** Read and write through `api.notes` /
  `api.canvases` only; never assume a storage backend.
- **Panels must clean up.** The function you return from `render` runs when
  the panel is hidden or the plugin is disabled — remove listeners there.
- **Namespace your settings.** If you store anything in vault settings,
  prefix keys with your plugin id (`"my-plugin.someKey"`).
- **Stay additive on the data format.** Custom canvas node payloads go under
  a node's open `data` object (see [DATA-FORMAT.md](./DATA-FORMAT.md)) —
  never invent top-level fields.

## Loading plugins today

Built-in plugins are listed in `apps/web/src/plugins/manager.ts` and can be
toggled per-vault in Settings → Plugins. Runtime installation of community
plugins (from a registry) is on the [roadmap](./ROADMAP.md) for v0.3; the
API you write against today is the one that registry will serve.
