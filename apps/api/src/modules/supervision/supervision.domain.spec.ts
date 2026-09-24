import { aggregateOwnerPerformance, completionTimeliness, shanghaiDate, supervisionDisplayStatus } from "./supervision.domain";

describe("任务督办状态与责任人统计口径", () => {
  const asOf = "2026-09-24T04:00:00.000Z"; // Asia/Shanghai 2026-09-24 12:00

  it("区分正常推进、已延期、已完成和已中止", () => {
    expect(supervisionDisplayStatus("NOT_STARTED", "2026-09-24", asOf)).toBe("NORMAL");
    expect(supervisionDisplayStatus("IN_PROGRESS", "2026-09-23", asOf)).toBe("OVERDUE");
    expect(supervisionDisplayStatus("COMPLETED", "2026-09-20", asOf)).toBe("COMPLETED");
    expect(supervisionDisplayStatus("ABORTED", "2026-09-20", asOf)).toBe("ABORTED");
  });

  it("完成日等于截止日属于按期完成，晚一天属于逾期完成", () => {
    expect(completionTimeliness("COMPLETED", "2026-09-24", "2026-09-24T15:59:59.000Z")).toBe("ON_TIME");
    expect(completionTimeliness("COMPLETED", "2026-09-24", "2026-09-24T16:00:00.000Z")).toBe("LATE");
    expect(completionTimeliness("IN_PROGRESS", "2026-09-24", null)).toBeNull();
    expect(shanghaiDate("2026-09-24T16:00:00.000Z")).toBe("2026-09-25");
  });

  it("10 个有效任务得到 7 个按期、2 个延期和 70% 按期率", () => {
    const result = aggregateOwnerPerformance([
      ...Array.from({ length: 7 }, () => ({ lifecycleStatus: "COMPLETED" as const, dueDate: "2026-09-20", completedAt: "2026-09-20T08:00:00Z" })),
      { lifecycleStatus: "COMPLETED" as const, dueDate: "2026-09-20", completedAt: "2026-09-21T08:00:00Z" },
      { lifecycleStatus: "IN_PROGRESS" as const, dueDate: "2026-09-23", completedAt: null },
      { lifecycleStatus: "NOT_STARTED" as const, dueDate: "2026-09-30", completedAt: null }
    ], asOf);
    expect(result).toMatchObject({ totalTasks: 10, onTimeCompleted: 7, lateCompleted: 1, currentlyOverdue: 1, overdueTasks: 2, notDueIncomplete: 1, onTimeRate: 70 });
  });

  it("总任务数为 0 不除零，已中止任务只单列不进入分母", () => {
    expect(aggregateOwnerPerformance([], asOf)).toMatchObject({ totalTasks: 0, onTimeRate: 0, overdueTasks: 0 });
    expect(aggregateOwnerPerformance([{ lifecycleStatus: "ABORTED", dueDate: "2026-09-01", completedAt: null }], asOf))
      .toMatchObject({ totalTasks: 0, aborted: 1, onTimeRate: 0 });
  });

  it("跨月任务仍只按截止日期所在统计集合计算，聚合函数不使用创建或更新日期", () => {
    const result = aggregateOwnerPerformance([
      { lifecycleStatus: "COMPLETED", dueDate: "2026-09-01", completedAt: "2026-08-31T16:00:00Z" },
      { lifecycleStatus: "IN_PROGRESS", dueDate: "2026-09-30", completedAt: null }
    ], asOf);
    expect(result).toMatchObject({ totalTasks: 2, onTimeCompleted: 1, notDueIncomplete: 1 });
  });
});
