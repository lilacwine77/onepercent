/**
 * A GLTFLoader meshopt decoder that needs no WebAssembly (the production CSP has
 * no 'wasm-unsafe-eval'). Buffers decode in one module Worker, in order; output
 * is byte-identical to the WASM decoder (checked on the CRT and machine GLBs).
 */
type Pending = {
  resolve(target: Uint8Array): void;
  reject(error: Error): void;
};
let worker: Worker | null = null;
let next = 0;
const pending = new Map<number, Pending>();
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./meshopt-worker.ts", import.meta.url), {
    type: "module",
    name: "meshopt-decoder",
  });
  worker.onmessage = (
    event: MessageEvent<{ id: number; target?: Uint8Array; error?: string }>,
  ) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    if (event.data.target) job.resolve(event.data.target);
    else job.reject(new Error(event.data.error ?? "meshopt decode failed"));
  };
  worker.onerror = () => {
    for (const job of pending.values())
      job.reject(new Error("meshopt worker failed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}
export const CspMeshoptDecoder = {
  supported: true,
  ready: Promise.resolve(),
  decodeGltfBufferAsync(
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string,
  ): Promise<Uint8Array> {
    const id = next++;
    const copy = source.slice();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ensureWorker().postMessage(
        { id, count, size, source: copy, mode, filter },
        [copy.buffer],
      );
    });
  },
  /** Synchronous path GLTFLoader falls back to without decodeGltfBufferAsync; unused. */
  decodeGltfBuffer(): void {
    throw new Error("Use decodeGltfBufferAsync");
  },
};
