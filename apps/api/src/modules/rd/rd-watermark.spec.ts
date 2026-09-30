import { advanceRdCursor, compareRdCursor, normalizeRdTimestamp } from "./rd-watermark";

describe("研发中心 E10 watermark cursor", () => {
  const baseId = "63319afa-3414-4644-eb42-1dfcf70afdb1";

  it("源时间晚于 ISO watermark 时可以推进 cursor", () => {
    const result = advanceRdCursor(
      { at: "2026-09-30 13:47:09.000000", id: baseId },
      "2026-09-30 14:45:14.000978",
      "3f9ea2a3-6cbf-4b13-1f82-1dfcff27aca7",
    );

    expect(result).toEqual({ at: "2026-09-30 14:45:14.000978", id: "3f9ea2a3-6cbf-4b13-1f82-1dfcff27aca7" });
  });

  it("保留六位微秒精度，不使用 JavaScript Date 比较", () => {
    const a = normalizeRdTimestamp("2026-09-30 14:45:14.000721")!;
    const b = normalizeRdTimestamp("2026-09-30 14:45:14.000978")!;

    expect(a).not.toBe(b);
    expect(compareRdCursor({ at: b, id: baseId }, { at: a, id: baseId })).toBeGreaterThan(0);
  });

  it("相同时间按 SQL Server uniqueidentifier 顺序推进", () => {
    const low = { at: "2026-09-30 14:45:14.000978", id: "01000000-0000-0000-0000-000000000000" };
    const high = { at: "2026-09-30 14:45:14.000978", id: "00000001-0000-0000-0000-000000000000" };

    expect(compareRdCursor(high, low)).toBeGreaterThan(0);
    expect(advanceRdCursor(low, high.at, high.id)).toEqual(high);
  });

  it("overlap 重读旧记录不会重复推进或回退 watermark", () => {
    const previous = { at: "2026-09-30 14:45:14.000978", id: "00000001-0000-0000-0000-000000000000" };

    expect(advanceRdCursor(previous, "2026-09-30 14:44:59.999999", "ffffffff-ffff-ffff-ffff-ffffffffffff")).toEqual(previous);
    expect(advanceRdCursor(previous, previous.at, "01000000-0000-0000-0000-000000000000")).toEqual(previous);
  });
});
