// The manifest describes requests; the module inventory proves which packages
// are in those requests after tree shaking. Neither gate infers from file names.
export function assertBrowserConfigModules(chunks) {
  for (const [chunk, modules] of Object.entries(chunks)) {
    for (const id of modules) {
      const config = id
        .replaceAll("\\", "/")
        .match(
          /\/(?:packages\/config|node_modules\/@onepercent\/config)\/(?:src|dist)\/([^?]+)(?:\?.*)?$/,
        );
      // The browser entry, its constants and the Feed back estimate (pure, no zod).
      if (config && !/^(?:web|constants|feed-back)\.(?:ts|js)$/.test(config[1]))
        throw new Error(
          `Browser chunk ${chunk} includes server config: ${id}. Use @onepercent/config/web.`,
        );
    }
  }
}

export function buildMetadata() {
  return {
    name: "onepercent-build-metadata",
    generateBundle(_options, bundle) {
      const chunks = Object.fromEntries(
        Object.values(bundle)
          .filter((output) => output.type === "chunk")
          .map((chunk) => [
            chunk.fileName,
            Object.entries(chunk.modules)
              .filter(([, metadata]) => metadata.renderedLength > 0)
              .map(([id]) => id.replaceAll("\\", "/")),
          ]),
      );
      assertBrowserConfigModules(chunks);
      this.emitFile({
        type: "asset",
        fileName: ".vite/modules.json",
        source: JSON.stringify(chunks),
      });
    },
  };
}
