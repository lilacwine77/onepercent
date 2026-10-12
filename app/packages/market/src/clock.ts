export interface Clock {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
}

const cancellations = new WeakMap<Promise<void>, () => void>();

export const defaultClock: Clock = {
  nowMs: () => Date.now(),
  random: () => Math.random(),
  sleep(ms) {
    let cancel = () => {};
    const promise = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      cancel = () => clearTimeout(timer);
    });
    cancellations.set(promise, cancel);
    return promise;
  },
};

/** Clears native timeout waits after an attempt completes; custom clocks own their waits. */
export function cancelClockSleep(promise: Promise<void>): void {
  cancellations.get(promise)?.();
  cancellations.delete(promise);
}
