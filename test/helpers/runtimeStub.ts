export function createRuntimeStub(pluginIds: string[]) {
  return {
    listPlugins() {
      return pluginIds.map((id) => ({ id }));
    },
    async invoke(pluginId: string, request: { action: string; input?: unknown }) {
      return { ok: true, data: { pluginId, ...request } };
    }
  };
}
