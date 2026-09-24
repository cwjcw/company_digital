import { resolveBuildVersion } from "./build-version";

describe("API build version", () => {
  it("returns the full and short commit for a valid build SHA", () => {
    expect(resolveBuildVersion("CE1ED0ADCA0593C69CCD0263CCB12C8E399C205F")).toEqual({
      commit: "ce1ed0adca0593c69ccd0263ccb12c8e399c205f",
      shortCommit: "ce1ed0a"
    });
  });

  it.each([undefined, "", "not-a-sha", "ce1ed0a"])("falls back to unknown for %s", (value) => {
    expect(resolveBuildVersion(value)).toEqual({ commit: "unknown", shortCommit: "unknown" });
  });
});
