/// <reference lib="webworker" />
// Decodes EXT_meshopt_compression buffers off the main thread with meshoptimizer's
// pure-JS reference decoder: no WebAssembly, so it runs under script-src 'self'.
import { MeshoptDecoder } from "./vendor/meshopt_decoder_reference.js";

interface Job {
  id: number;
  count: number;
  size: number;
  source: Uint8Array;
  mode: string;
  filter?: string;
}
self.onmessage = (event: MessageEvent<Job>) => {
  const { id, count, size, source, mode, filter } = event.data;
  try {
    const target = new Uint8Array(count * size);
    MeshoptDecoder.decodeGltfBuffer(target, count, size, source, mode, filter);
    (self as unknown as Worker).postMessage({ id, target }, [target.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: String(error) });
  }
};
