/* eslint-disable */
// Synced from experience/lab/src/rip/card-worker.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/** Card-face painting Worker: OffscreenCanvas in, flipped ImageBitmaps out (transferred). */
import { ensureFonts, type FontFiles } from "./assets";
import { paintJob, type PaintJob } from "./painter-jobs";

interface Msg {
  id: number;
  job: PaintJob;
  fonts: FontFiles[];
  assetsBase: string;
}
const scope = self as unknown as {
  onmessage: (e: MessageEvent<Msg>) => void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

function flipped(c: OffscreenCanvas): ImageBitmap {
  const o = new OffscreenCanvas(c.width, c.height);
  const x = o.getContext("2d")!;
  x.translate(0, c.height);
  x.scale(1, -1);
  x.drawImage(c, 0, 0);
  return o.transferToImageBitmap();
}

scope.onmessage = async (e) => {
  const { id, job, fonts, assetsBase } = e.data;
  try {
    await ensureFonts(fonts);
    const canvases = (await paintJob(job, assetsBase)) as OffscreenCanvas[];
    const images = canvases.map(flipped);
    scope.postMessage({ id, ok: true, images }, images);
  } catch (err) {
    scope.postMessage({
      id,
      ok: false,
      error: String((err as Error)?.message ?? err),
    });
  }
};
