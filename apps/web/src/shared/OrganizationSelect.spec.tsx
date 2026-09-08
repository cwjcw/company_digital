import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OrganizationSelect } from "./OrganizationSelect";

afterEach(cleanup);

describe("OrganizationSelect", () => {
  const longPath = "凯南 / 事业四部 / 制造中心 / 生产管理部 / 设备管理组";

  it("keeps the complete path readable in the selector and its popup", () => {
    render(<OrganizationSelect open value="department-1" organizations={[{ id: "department-1", name: "设备管理组", pathLabel: longPath }]} />);

    const titledNodes = screen.getAllByTitle(longPath);
    expect(titledNodes.some((node) => node.classList.contains("kdos-organization-selected-label"))).toBe(true);
    expect(titledNodes.some((node) => node.classList.contains("kdos-organization-option"))).toBe(true);
    expect(document.querySelector(".kdos-organization-select-popup")).toBeInTheDocument();
  });
});
