import "../test/setup";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { t } from "@onepercent/copy";
import { Turnstile } from "./Turnstile";
import { useXray, XRAY_REQUEST_TIMEOUT_MS } from "./use-xray";
import rawResult from "./__fixtures__/result.json";

const owner = rawResult.address;
const source =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const challenge = () =>
  new Response(JSON.stringify({ error: "turnstile_required" }), {
    status: 403,
  });
function Harness({ input = owner }: { input?: string }) {
  const { state, submitToken, challengeError } = useXray(input);
  return (
    <>
      <output data-testid="state">{state.status}</output>
      {state.status === "challenge" && (
        <Turnstile onToken={submitToken} onError={challengeError} />
      )}
      {state.status === "error" && <p role="alert">{state.message}</p>}
    </>
  );
}
type Options = Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
function installWidget() {
  const callbacks: Options[] = [];
  const remove = vi.fn();
  const render = vi.fn((_container: HTMLElement, options: Options) => {
    callbacks.push(options);
    return "test-widget";
  });
  window.turnstile = { render, remove };
  return { callbacks, render, remove };
}
beforeEach(() => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "fixture-site-key");
  delete window.turnstile;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete window.turnstile;
  document
    .querySelectorAll(`script[src="${source}"]`)
    .forEach((node) => node.remove());
});

it("does not load the widget before a 403 challenge", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(rawResult)));
  render(<Harness />);
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("done"),
  );
  expect(document.querySelector(`script[src="${source}"]`)).toBeNull();
});
it("retries once with the token and ignores duplicate callbacks", async () => {
  const widget = installWidget();
  vi.mocked(fetch)
    .mockResolvedValueOnce(challenge())
    .mockResolvedValueOnce(new Response(JSON.stringify(rawResult)));
  const mounted = render(<Harness />);
  await waitFor(() => expect(widget.render).toHaveBeenCalledTimes(1));
  await act(async () => {
    widget.callbacks[0]!.callback("first-token");
    widget.callbacks[0]!.callback("duplicate-token");
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith(
    `/api/xray/${owner}`,
    expect.objectContaining({
      headers: { "cf-turnstile-response": "first-token" },
    }),
  );
  expect(screen.getByTestId("state")).toHaveTextContent("done");
  expect(widget.remove).toHaveBeenCalledExactlyOnceWith("test-widget");
  mounted.unmount();
  widget.callbacks[0]!.callback("late-token");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("shows approved copy after the single resend still returns 403", async () => {
  const widget = installWidget();
  vi.mocked(fetch).mockImplementation(async () => challenge());
  render(<Harness />);
  await waitFor(() => expect(widget.render).toHaveBeenCalledTimes(1));
  await act(async () => widget.callbacks[0]!.callback("rejected-token"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    t("xray.error.turnstile_required"),
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(widget.render).toHaveBeenCalledTimes(1);
});
it.each(["error-callback", "expired-callback"] as const)(
  "fails the widget closed on %s without resending",
  async (event) => {
    const widget = installWidget();
    vi.mocked(fetch).mockResolvedValueOnce(challenge());
    render(<Harness />);
    await waitFor(() => expect(widget.render).toHaveBeenCalledTimes(1));
    await act(async () => widget.callbacks[0]![event]());
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("xray.error.turnstile_required"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("fails closed when the public site key is unavailable", async () => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
  vi.mocked(fetch).mockResolvedValueOnce(challenge());
  render(<Harness />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    t("xray.error.turnstile_required"),
  );
  expect(document.querySelector(`script[src="${source}"]`)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("reports the configured scan timeout and aborts the request", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementationOnce((_url, options) => {
    signal = options?.signal ?? undefined;
    return new Promise(() => {});
  });
  const { result } = renderHook(() => useXray(owner));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(XRAY_REQUEST_TIMEOUT_MS - 1);
  });
  expect(result.current.state.status).toBe("loading");
  expect(signal?.aborted).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(result.current.state).toEqual({
    status: "error",
    message: t("xray.error.scan_timeout"),
  });
  expect(signal?.aborted).toBe(true);
});
it("reports a failed script load and allows a subsequent script request", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(challenge());
  const mounted = render(<Harness />);
  const script = document.querySelector<HTMLScriptElement>(
    `script[src="${source}"]`,
  );
  await waitFor(() =>
    expect(document.querySelector(`script[src="${source}"]`)).not.toBeNull(),
  );
  await act(async () =>
    fireEvent.error(
      script ?? document.querySelector(`script[src="${source}"]`)!,
    ),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    t("xray.error.turnstile_required"),
  );
  expect(document.querySelector(`script[src="${source}"]`)).toBeNull();
  mounted.unmount();
});
it("loads the external script once across simultaneous widget mounts after a challenge", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(challenge());
  render(<Harness />);
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("challenge"),
  );
  const extra = render(<Turnstile onToken={vi.fn()} onError={vi.fn()} />);
  expect(document.querySelectorAll(`script[src="${source}"]`)).toHaveLength(1);
  const widget = installWidget();
  await act(async () =>
    fireEvent.load(document.querySelector(`script[src="${source}"]`)!),
  );
  expect(widget.render).toHaveBeenCalledTimes(2);
  expect(document.querySelectorAll(`script[src="${source}"]`)).toHaveLength(1);
  extra.unmount();
});
