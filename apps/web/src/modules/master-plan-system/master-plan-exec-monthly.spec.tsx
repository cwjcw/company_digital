import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MasterPlanProgressCell } from "./MasterPlanPages";

/**
 * KN-MPS-EXEC-001 月计划生产进度口径永久锁定：
 * 月计划进度 = 整个订单/月度总需求完成率 = SUM(全部关联周计划 actual) / monthly.required_quantity。
 * 绝不能用 SUM(weekly.planned_quantity)（已下达周计划数量）做分母。
 */
const cutting = { code: "cutting", name: "下料", order: 1 };

afterEach(cleanup);

describe("KN-MPS-EXEC-001 月计划生产进度口径", () => {
  it("样例：required=500、两个 weekly planned 合计 300、actual 合计 255 → 51%（不是 85%、不是 90%）", async () => {
    /* Weekly A planned100 actual105=105%；Weekly B planned200 actual150=75%；合计 actual255 / required500 = 0.51。 */
    render(<MasterPlanProgressCell process={cutting} resource="mps-monthly-plans" value={0.51} row={{
      requiredQuantity: 500, plannedQuantity: 300, cuttingDispatchedQuantity: 300, cuttingReportedQuantity: 255, cuttingReportCount: 5
    }} />);
    const cell = screen.getByText("51%");
    expect(cell).toBeVisible();
    expect(cell.textContent).not.toBe("85%");
    expect(cell.textContent).not.toBe("90%");
    /* 未达 100% → 不绿色。 */
    expect(cell.className).not.toContain("kdos-progress-satisfied");
    fireEvent.mouseEnter(cell);
    await waitFor(() => expect(screen.getByText(/月度总需求：500/)).toBeInTheDocument());
    /* Hover 分母是月度总需求 500，不是已下达周计划数量 300。 */
    expect(screen.getByText(/月度总需求：500/)).toBeInTheDocument();
    expect(screen.getByText(/累计报工：255/)).toBeInTheDocument();
    expect(screen.getByText(/报工次数：5/)).toBeInTheDocument();
    expect(screen.getByText(/已下达周计划数量：300/)).toBeInTheDocument();
    expect(screen.getByText(/生产进度：51%/)).toBeInTheDocument();
    expect(screen.queryByText(/需求数量：300/)).not.toBeInTheDocument();
  });

  it("永久锁定：required=500、两个 weekly 全部报满 300 → 60%，绝不能显示 100% 或绿色", async () => {
    render(<MasterPlanProgressCell process={cutting} resource="mps-monthly-plans" value={0.6} row={{
      requiredQuantity: 500, plannedQuantity: 300, cuttingDispatchedQuantity: 300, cuttingReportedQuantity: 300, cuttingReportCount: 2
    }} />);
    const cell = screen.getByText("60%");
    expect(cell).toBeVisible();
    expect(cell.textContent).not.toBe("100%");
    /* 已下达周计划全部完成，但整个月度总需求未完成 → 不得绿色。 */
    expect(cell.className).not.toContain("kdos-progress-satisfied");
  });

  it("月计划 required=500、actual=500 → 100% 且绿色（整个月度总需求完成）", () => {
    render(<MasterPlanProgressCell process={cutting} resource="mps-monthly-plans" value={1} row={{
      requiredQuantity: 500, plannedQuantity: 300, cuttingDispatchedQuantity: 300, cuttingReportedQuantity: 500, cuttingReportCount: 3
    }} />);
    const cell = screen.getByText("100%");
    expect(cell.className).toContain("kdos-progress-satisfied");
  });

  it("周计划语义不变：分母是需求数量 plannedQuantity，Hover 不显示「月度总需求」或「已下达周计划数量」", async () => {
    render(<MasterPlanProgressCell process={cutting} resource="mps-weekly-plans" value={1.05} row={{
      plannedQuantity: 100, cuttingReportedQuantity: 105, cuttingReportCount: 2
    }} />);
    const cell = screen.getByText("105%");
    expect(cell.className).toContain("kdos-progress-satisfied");
    fireEvent.mouseEnter(cell);
    await waitFor(() => expect(screen.getByText(/需求数量：100/)).toBeInTheDocument());
    expect(screen.queryByText(/月度总需求/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已下达周计划数量/)).not.toBeInTheDocument();
  });
});
