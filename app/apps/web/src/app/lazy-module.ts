import { lazy, type ComponentType } from "react";

// Modules already in, by loader. React.lazy suspends on a first render even when
// its module is already loaded, and React then holds the fallback for a beat (its
// reveal throttle): a page or a slot would flash its loading state, and what
// follows it would move (layout shift). A lazy from `lazyModule` renders a module
// that `preloadModule` brought in at once.
const loaded = new WeakMap<object, unknown>();

/** Loads a module ahead of its first render: a route's `ready`, a page's mount. */
export function preloadModule<M>(load: () => Promise<M>): Promise<M> {
  return load().then((module) => {
    loaded.set(load, module);
    return module;
  });
}

/** React.lazy that renders without suspending once its module is in. */
export function lazyModule<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
) {
  return lazy(() => {
    const module = loaded.get(load) as
      { default: ComponentType<P> } | undefined;
    if (!module) return preloadModule(load);
    // A thenable that resolves synchronously, which React.lazy reads without
    // suspending (as AppShell's lazyRoute does for route chunks).
    return {
      then: (done: (value: typeof module) => void) => done(module),
    } as never;
  });
}
