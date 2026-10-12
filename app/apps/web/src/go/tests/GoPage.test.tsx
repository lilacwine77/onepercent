import "../../link/tests/setup";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { onCleanup } from "../../link/tests/setup";
import { GoPage } from "../GoPage";
import { COPY } from "../copy";
import { replaceGoTarget } from "../navigation";

vi.mock("../navigation", () => ({ replaceGoTarget: vi.fn() }));

const id = "0123456789abcdef0123456789abcdef";

function reply(body: unknown, status = 200, retryAfter?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(retryAfter === undefined ? {} : { "Retry-After": retryAfter }),
    },
  });
}

function stubApi(response: Response = reply({ target: "/feed" })) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetch);
  vi.mocked(replaceGoTarget).mockClear();
  return fetch;
}

describe("GoPage", () => {
  it("posts only the id to the current origin regardless of the legacy API env", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example");
    const target = "/rip?edition=after_hours&n=5&ref=valid_alias";
    const fetch = stubApi(reply({ target }));
    render(<GoPage id={id} />);
    expect(screen.getByRole("status")).toHaveTextContent(COPY["go.loading"]);
    await waitFor(() =>
      expect(replaceGoTarget).toHaveBeenCalledExactlyOnceWith(
        `${window.location.origin}${target}`,
      ),
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL("/api/go/redeem", window.location.origin),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        redirect: "error",
      },
    );
  });

  it("consumes exactly once and navigates once under StrictMode effect replay", async () => {
    const fetch = stubApi();
    render(
      <StrictMode>
        <GoPage id={id} />
      </StrictMode>,
    );
    await waitFor(() => expect(replaceGoTarget).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([404, 410])("shows expiry and home for HTTP %s", async (status) => {
    const fetch = stubApi(reply({}, status));
    render(<GoPage id={id} />);
    expect(await screen.findByText(COPY["go.expired"])).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: COPY["common.home"] }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(replaceGoTarget).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows Retry-After seconds from a 429 without another request", async () => {
    const fetch = stubApi(reply({}, 429, "32"));
    render(<GoPage id={id} />);
    expect(
      await screen.findByText(
        "Too many requests from here. Try again in 32 s.",
      ),
    ).toBeInTheDocument();
    expect(replaceGoTarget).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "soon", "2.5", "-1", "9007199254740992"])(
    "handles invalid Retry-After %s as a response failure",
    async (retryAfter) => {
      stubApi(reply({}, 429, retryAfter));
      render(<GoPage id={id} />);
      await screen.findByText(COPY["common.networkError"]);
      expect(replaceGoTarget).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://other.example/feed",
    "/packs",
    "/rip?amount=1",
    "/rip?n=11",
    "/rip?edition=unknown",
    "/feed?ref=INVALID",
  ])("shows network error without navigating to %s", async (target) => {
    stubApi(reply({ target }));
    render(<GoPage id={id} />);
    await screen.findByText(COPY["common.networkError"]);
    expect(replaceGoTarget).not.toHaveBeenCalled();
  });

  it.each([null, {}, { target: 42 }, { target: "/feed", extra: true }])(
    "rejects an invalid response shape %s",
    async (body) => {
      stubApi(reply(body));
      render(<GoPage id={id} />);
      await screen.findByText(COPY["common.networkError"]);
      expect(replaceGoTarget).not.toHaveBeenCalled();
    },
  );

  it("rejects a successful status other than the specified 200", async () => {
    stubApi(reply({ target: "/feed" }, 201));
    render(<GoPage id={id} />);
    await screen.findByText(COPY["common.networkError"]);
    expect(replaceGoTarget).not.toHaveBeenCalled();
  });

  it("retries a failed request only after a tap", async () => {
    const fetch = stubApi();
    fetch.mockRejectedValueOnce(new Error("Unavailable"));
    render(<GoPage id={id} />);
    await screen.findByText(COPY["common.networkError"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: COPY["common.retry"] }));
    await waitFor(() => expect(replaceGoTarget).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shows expiry if a lost successful response already consumed the id", async () => {
    const fetch = stubApi(reply({}, 410));
    fetch.mockRejectedValueOnce(new Error("Lost response"));
    render(<GoPage id={id} />);
    await screen.findByText(COPY["common.networkError"]);
    fireEvent.click(screen.getByRole("button", { name: COPY["common.retry"] }));
    await screen.findByText(COPY["go.expired"]);
    expect(replaceGoTarget).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not navigate when the response arrives after an actual unmount", async () => {
    let finish: ((response: Response) => void) | undefined;
    const fetch = stubApi();
    fetch.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const page = render(<GoPage id={id} />);
    page.unmount();
    await act(async () => finish?.(reply({ target: "/feed" })));
    expect(replaceGoTarget).not.toHaveBeenCalled();
  });

  it("ignores an older id's response after the route changes", async () => {
    let finish: ((response: Response) => void) | undefined;
    const fetch = stubApi(reply({ target: "/cards" }));
    fetch.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const page = render(<GoPage id={id} />);
    const nextId = "fedcba9876543210fedcba9876543210";
    page.rerender(<GoPage id={nextId} />);
    await waitFor(() =>
      expect(replaceGoTarget).toHaveBeenCalledExactlyOnceWith(
        `${window.location.origin}/cards`,
      ),
    );
    await act(async () => finish?.(reply({ target: "/feed" })));
    expect(replaceGoTarget).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(([, options]) => options?.body)).toEqual([
      JSON.stringify({ id }),
      JSON.stringify({ id: nextId }),
    ]);
  });

  it("does not read or write storage or make any unrelated request", async () => {
    const spies = ["getItem", "setItem", "removeItem", "clear", "key"].map(
      (method) => {
        const spy = vi.spyOn(Storage.prototype, method as "getItem");
        spy.mockImplementation(() => {
          throw new Error("Browser storage is forbidden on the go page");
        });
        onCleanup(() => spy.mockRestore());
        return spy;
      },
    );
    const fetch = stubApi();
    render(<GoPage id={id} />);
    await waitFor(() => expect(replaceGoTarget).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `${window.location.origin}/api/go/redeem`,
    );
    expect(document.querySelector("img, iframe")).toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("renders markup without consuming an id outside browser effects", () => {
    const fetch = stubApi();
    expect(renderToString(<GoPage id={id} />)).toContain(COPY["go.loading"]);
    expect(fetch).not.toHaveBeenCalled();
    expect(replaceGoTarget).not.toHaveBeenCalled();
  });
});
