import { useEffect, useSyncExternalStore } from "react";
import { WEB } from "@onepercent/config/web";
export type Snapshot<T> = { data?: T; error?: unknown; loading: boolean };
export class Resource<T> {
  private state: Snapshot<T> = { loading: true };
  private listeners = new Set<() => void>();
  private flight?: Promise<void>;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly load: (signal: AbortSignal) => Promise<T>,
    private readonly interval: number = WEB.machinePollMs,
  ) {}
  snapshot = () => this.state;
  private publish(next: Snapshot<T>) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  refresh = (): Promise<void> => {
    if (this.flight) return this.flight;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const flight = this.load(signal)
      .then(
        (data) => {
          if (!signal.aborted) this.publish({ data, loading: false });
        },
        (error) => {
          if (!signal.aborted)
            this.publish({ data: this.state.data, error, loading: false });
        },
      )
      .finally(() => {
        if (this.flight === flight) {
          this.flight = undefined;
          if (this.listeners.size) this.schedule();
        }
      });
    this.flight = flight;
    return flight;
  };
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.refresh(),
      document.hidden
        ? Math.max(this.interval, WEB.machinePollHiddenMs)
        : this.interval,
    );
  }
  private visible = () => {
    if (!document.hidden) void this.refresh();
    else this.schedule();
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      document.addEventListener("visibilitychange", this.visible);
      void this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearTimeout(this.timer);
        document.removeEventListener("visibilitychange", this.visible);
      }
    };
  };
  invalidate() {
    this.controller?.abort();
    this.flight = undefined;
    this.publish({ loading: true });
    if (this.listeners.size) void this.refresh();
  }
}
const resources = new Map<string, Resource<unknown>>();
export function resource<T>(
  url: string,
  loader: (signal: AbortSignal) => Promise<T>,
  interval?: number,
): Resource<T> {
  if (!resources.has(url)) resources.set(url, new Resource(loader, interval));
  return resources.get(url)! as Resource<T>;
}
export function useResource<T>(item: Resource<T>) {
  useEffect(() => {
    void item.refresh();
  }, [item]);
  return useSyncExternalStore(item.subscribe, item.snapshot);
}
export function invalidateWalletResources() {
  for (const [url, value] of resources)
    if (/\/(me|binder|deck|balance)\//.test(url)) value.invalidate();
}
