// the old single-file webui module, now a re-export shim: "./webui.ts" importers (the
// orchestrator's config load, the hub's reloadable module path and the tests) keep working
export * from "./webui/index.ts";
