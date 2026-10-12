import { Component, type ReactNode } from "react";
import { t } from "@onepercent/copy/initial";
import { isChunkError, page } from "./chunk-reload";
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; onError?(error: Error): void },
  { failed: boolean; retry: number; error: unknown }
> {
  state = { failed: false, retry: 0, error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }
  /**
   * Try again: re-render, or reload the page when a chunk of an older deploy is
   * gone (a 404 on a lazy import): only the new build can render.
   */
  private retry = () => {
    if (isChunkError(this.state.error)) {
      page.reload();
      return;
    }
    this.setState(({ retry }) => ({
      failed: false,
      retry: retry + 1,
      error: null,
    }));
  };
  render() {
    if (this.state.failed)
      return (
        <div role="alert">
          {this.props.fallback ?? <p>{t("errors.generic")}</p>}
          <button onClick={this.retry}>{t("common.retry")}</button>
        </div>
      );
    return (
      <div key={this.state.retry} className="boundary-content">
        {this.props.children}
      </div>
    );
  }
}
