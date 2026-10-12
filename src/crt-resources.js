// Network preparation only: safe during the entrance, with no Three.js or GPU work.
export const CRT_MODEL_URL = '/models/onepercent-crt.glb?v=3';
export const CRT_STUDIO_URL = '/assets/crt-studio-v1.bin.gz';

function fetchBytes(url) {
  const task = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Could not load CRT resource (${response.status}): ${url}`);
    return response.arrayBuffer();
  });
  // A preview may finish before the lazy renderer starts consuming the promise.
  // Its rejection still reaches the renderer's poster fallback when awaited.
  task.catch(() => {});
  return task;
}

export function preloadCRTResources() {
  return { model: fetchBytes(CRT_MODEL_URL), studio: fetchBytes(CRT_STUDIO_URL) };
}
