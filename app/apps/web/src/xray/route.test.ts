import "./test-setup";
import { describe, expect, it } from "vitest";
import { matchXrayPath } from "./route";

describe("matchXrayPath", () => {
  it("matches the entry and one encoded address or name", () => {
    expect(matchXrayPath("/x")).toEqual({ input: "" });
    expect(matchXrayPath("/x/onepercent.sns")).toEqual({
      input: "onepercent.sns",
    });
    expect(matchXrayPath("/x/a%20b")).toBeNull();
  });
  it.each(["/", "/xray", "/x/", "/x/a/b", "/x/%", "/prefix/x"])(
    "does not match %s",
    (path) => expect(matchXrayPath(path)).toBeNull(),
  );
});
