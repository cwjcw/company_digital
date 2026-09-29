import { describe, expect, it } from "vitest";
import { diffParts } from "./rd-display";

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
});
