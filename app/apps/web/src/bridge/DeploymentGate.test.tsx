import "../test/setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeploymentGate } from "./DeploymentGate";
import { webDeployment } from "../data/deployment";
import { t } from "@onepercent/copy";

vi.mock("../data/deployment", () => ({ webDeployment: vi.fn() }));
describe("live routes before deployment", () => {
  it.each(["rip", "cards"] as const)(
    "keeps %s accessible without running its transaction adapter",
    (flow) => {
      vi.mocked(webDeployment).mockImplementation(() => {
        throw new Error("Web deployment is not configured");
      });
      const live = vi.fn(() => <div>Live adapter</div>);
      const Live = live;
      render(
        <DeploymentGate flow={flow}>
          <Live />
        </DeploymentGate>,
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        t(`nav.${flow}`),
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        t("public.chainUnavailable"),
      );
      expect(live).not.toHaveBeenCalled();
    },
  );
});
