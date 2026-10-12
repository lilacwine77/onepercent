/* eslint-disable */
// Synced from experience/lab/src/rip/pack-worker.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/** Builds pack geometry off the main thread (height field + two sheets + normals). */
import { buildPackGeometry, packGeometryTransfer } from "./pack-geometry";
import type { EditionInfo } from "./brand";

const scope = self as unknown as {
  onmessage: (e: MessageEvent) => void;
  postMessage(m: unknown, t?: Transferable[]): void;
};
scope.onmessage = async (
  e: MessageEvent<{ id: number; url: string; tear: EditionInfo["tear"] }>,
) => {
  const { id, url, tear } = e.data;
  try {
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const geo = buildPackGeometry(bmp, { tear });
    bmp.close();
    scope.postMessage({ id, geo }, packGeometryTransfer(geo));
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
