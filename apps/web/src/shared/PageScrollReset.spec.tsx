import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { PageScrollReset } from "./PageScrollReset";
function Navigation() {
  const navigate = useNavigate();
  return <><PageScrollReset /><main className="content" /><button onClick={() => navigate("/equipment-status-report")}>设备状态</button><button onClick={() => navigate(-1)}>后退</button></>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("resets window and content on entry, navigation, and back without resetting during ordinary renders", () => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const view = render(<MemoryRouter initialEntries={["/equipment-register"]}><Navigation /></MemoryRouter>);
  expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  const content = view.container.querySelector<HTMLElement>(".content")!;
  content.scrollTop = 700; content.scrollLeft = 200;
  fireEvent.click(screen.getByText("设备状态"));
  expect(content.scrollTop).toBe(0); expect(content.scrollLeft).toBe(0);
  content.scrollTop = 600;
  fireEvent.click(screen.getByText("后退")); expect(content.scrollTop).toBe(0);
  content.scrollTop = 300;
  view.rerender(<MemoryRouter initialEntries={["/equipment-register"]}><Navigation /></MemoryRouter>);
  expect(content.scrollTop).toBe(300);
  fireEvent(window, new Event("pageshow")); expect(content.scrollTop).toBe(0);
});
