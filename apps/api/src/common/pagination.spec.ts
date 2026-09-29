import { kdosDefaultPageSize, kdosPageSizeOptions, normalizeKdosPageSize } from "./pagination";

describe("KDOS standard table pagination", () => {
  it("uses 100 by default and accepts the complete platform page-size set", () => {
    expect(kdosDefaultPageSize).toBe(100);
    expect(kdosPageSizeOptions).toEqual([50, 100, 200, 500, 1000]);
    expect(normalizeKdosPageSize(undefined)).toBe(100);
    expect(normalizeKdosPageSize(50)).toBe(50);
    expect(normalizeKdosPageSize(1000)).toBe(1000);
  });

  it("rejects legacy, fractional and oversized values without exceeding 1000", () => {
    expect(normalizeKdosPageSize(20)).toBe(100);
    expect(normalizeKdosPageSize(2000)).toBe(100);
    expect(normalizeKdosPageSize(100.5)).toBe(100);
  });
});
