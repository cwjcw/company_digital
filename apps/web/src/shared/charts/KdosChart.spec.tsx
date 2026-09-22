import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chartMocks = vi.hoisted(() => ({
  init: vi.fn(),
  instance: {
    setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn()
  }
}));

vi.mock("echarts", () => ({ init: chartMocks.init }));

import { KdosChart } from "./KdosChart";

describe("KdosChart", () => {
  beforeEach(() => {
    chartMocks.init.mockReset().mockReturnValue(chartMocks.instance);
    Object.values(chartMocks.instance).forEach((mock) => mock.mockClear());
  });

  afterEach(cleanup);

  it("initializes once, updates options, resizes, and disposes on unmount", () => {
    const { rerender, unmount } = render(<KdosChart ariaLabel="测试图表" option={{ series: [{ type: "line", data: [10] }] }} />);
    expect(chartMocks.init).toHaveBeenCalledTimes(1);
    expect(chartMocks.instance.setOption).toHaveBeenCalledTimes(1);

    rerender(<KdosChart ariaLabel="测试图表" option={{ series: [{ type: "line", data: [20] }] }} loading />);
    expect(chartMocks.init).toHaveBeenCalledTimes(1);
    expect(chartMocks.instance.setOption).toHaveBeenCalledTimes(2);
    expect(chartMocks.instance.showLoading).toHaveBeenCalled();

    fireEvent(window, new Event("resize"));
    expect(chartMocks.instance.resize).toHaveBeenCalled();
    unmount();
    expect(chartMocks.instance.dispose).toHaveBeenCalledTimes(1);
  });

  it("renders an accessible empty state without creating a chart instance", () => {
    render(<KdosChart ariaLabel="空图表" empty emptyText="暂无趋势数据" option={{ series: [] }} />);
    expect(screen.getByRole("img", { name: "空图表" })).toBeInTheDocument();
    expect(screen.getByText("暂无趋势数据")).toBeInTheDocument();
    expect(chartMocks.init).not.toHaveBeenCalled();
  });
});
