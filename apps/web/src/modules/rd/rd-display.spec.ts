import { describe, expect, it } from "vitest";
import { diffParts, displayParts } from "./rd-display";

const changed = (parts: ReturnType<typeof diffParts>[0]) => parts.filter((part) => part.changed).map((part) => part.text).join("");

describe("研发中心 A/B 字符差异展示", () => {
  it("只标记真实差异字符并保留共同后缀", () => {
    const [left, right] = diffParts("304内六角螺钉 M6*20", "201内六角螺钉 M6*20");
    // The old preview's LCS keeps the shared `0` unmarked while making the
    // changed numeric characters immediately visible.
    expect(changed(left)).toBe("34");
    expect(changed(right)).toBe("21");
    expect(left.map((part) => part.text).join("")).toBe("304内六角螺钉 M6*20");
    expect(right.map((part) => part.text).join("")).toBe("201内六角螺钉 M6*20");
  });

  it("兼容增删、Unicode 与空值", () => {
    for (const [left, right, leftChanged, rightChanged] of [
      ["相同", "相同", "", ""], ["AB", "AXB", "", "X"], ["AXB", "AB", "X", ""],
      ["abc", "aBc", "b", "B"], ["", "规格", "", "规格"], ["A B", "AB", " ", ""],
      ["😀H", "😀I", "H", "I"], ["M6*20", "M8*25", "60", "85"],
    ] as const) {
      const [leftParts, rightParts] = diffParts(left, right);
      expect(changed(leftParts)).toBe(leftChanged);
      expect(changed(rightParts)).toBe(rightChanged);
      expect(leftParts.map((part) => part.text).join("")).toBe(left);
      expect(rightParts.map((part) => part.text).join("")).toBe(right);
    }
    expect(diffParts(null, "规格")[0]).toEqual([]);
    expect(diffParts(null, null)).toEqual([[], []]);
    expect(changed(diffParts("a".repeat(600), "b".repeat(600))[0])).toHaveLength(600);
  });

  it("把查询命中与 A/B 差异作为两种可重叠的展示状态", () => {
    const parts = displayParts("左直段外不锈钢折板", "直段外不锈钢折板", "不锈钢");
    expect(parts.filter((part) => part.queryMatched).map((part) => part.text).join("")).toBe("不锈钢");
    expect(parts.filter((part) => part.changed).map((part) => part.text).join("")).toBe("左");
    expect(parts.find((part) => part.queryMatched)?.changed).toBe(false);
  });

  it("只在对应字段高亮品号或规格查询词", () => {
    expect(displayParts("RXDZ0119-01", "RXDZ0119-02", "RXDZ0119").filter((part) => part.queryMatched).map((part) => part.text).join("")).toBe("RXDZ0119");
    expect(displayParts("M6*20", "M8*20", "M6").filter((part) => part.queryMatched).map((part) => part.text).join("")).toBe("M6");
    expect(displayParts("不锈钢折板", "不锈钢板", "M6").some((part) => part.queryMatched)).toBe(false);
  });

  it("查询词与差异重叠时保留两种状态", () => {
    const overlap = displayParts("不锈钢A", "不锈钢B", "A");
    expect(overlap.find((part) => part.text === "A")).toEqual({ text: "A", changed: true, queryMatched: true });
  });
});
