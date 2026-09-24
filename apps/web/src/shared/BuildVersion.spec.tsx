import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BuildVersionLabel } from "./BuildVersion";
import { resolveBuildVersion } from "./build-version";

describe("Web build version", () => {
  const commit = "ce1ed0adca0593c69ccd0263ccb12c8e399c205f";

  it("derives the short commit from a valid full SHA", () => {
    expect(resolveBuildVersion(commit)).toEqual({ commit, shortCommit: "ce1ed0a" });
  });

  it("renders the short version and exposes the full commit as a title", () => {
    render(<BuildVersionLabel commit={commit} />);
    expect(screen.getByText("版本：ce1ed0a")).toHaveAttribute("title", `完整版本：${commit}`);
  });

  it("uses unknown when build metadata is unavailable", () => {
    render(<BuildVersionLabel commit="unknown" />);
    expect(screen.getByText("版本：unknown")).toHaveAttribute("title", "完整版本：unknown");
  });
});
