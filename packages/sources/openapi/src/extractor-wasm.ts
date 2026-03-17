import initWasmExtractor, {
  extract_manifest_json_wasm,
} from "./openapi-extractor-wasm/openapi_extractor.js";

let initPromise: Promise<void> | undefined;

const wasmAssetUrl = new URL(
  "./openapi-extractor-wasm/openapi_extractor_bg.wasm",
  import.meta.url,
);

const formatCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const initUsingRuntimeUrl = async (): Promise<void> => {
  await initWasmExtractor({ module_or_path: wasmAssetUrl });
};

const initUsingNodeFileSystem = async (): Promise<void> => {
  const [{ readFile }, { fileURLToPath }] = await Promise.all([
    import("node:fs/promises"),
    import("node:url"),
  ]);

  const wasmPath = fileURLToPath(wasmAssetUrl);
  const wasmBytes = await readFile(wasmPath);
  await initWasmExtractor({ module_or_path: wasmBytes });
};

const ensureWasmReady = (): Promise<void> => {
  if (!initPromise) {
    initPromise = (async () => {
      let runtimeUrlError: unknown;

      try {
        await initUsingRuntimeUrl();
        return;
      } catch (cause) {
        runtimeUrlError = cause;
      }

      try {
        await initUsingNodeFileSystem();
        return;
      } catch (filesystemError) {
        throw new Error(
          [
            "Unable to initialize OpenAPI extractor wasm.",
            `runtime-url failed: ${formatCause(runtimeUrlError)}`,
            `node-fs fallback failed: ${formatCause(filesystemError)}`,
          ].join(" "),
        );
      }
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }

  return initPromise;
};

export const extractOpenApiManifestJsonWithWasm = (
  sourceName: string,
  openApiDocumentText: string,
): Promise<string> =>
  ensureWasmReady().then(() =>
    extract_manifest_json_wasm(sourceName, openApiDocumentText),
  );
