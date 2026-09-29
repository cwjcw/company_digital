import { compare, diffParts, features, scanRows } from "./rd-duplicate-algorithm";

describe("研发中心一物多码规则迁移", () => {
  it("keeps the legacy label order case as a high-scoring candidate with warning", () => {
    const a = features({ name: "T1*130*150易碎物品标识易碎品标签贴纸", spec: "" });
    const b = features({ name: "易碎品标签贴纸T1*130*150双语易碎物品标识", spec: "" });
    const result = compare(a, b);
    expect(result?.score).toBeGreaterThanOrEqual(80);
    expect(result?.warnings.join(" ")).toContain("双语");
  });

  it.each([
    ["M6×20", "M6*20", true], ["M6X20", "M6*20", true], ["M6*20", "M8*20", false],
    ["304内六角螺钉", "201内六角螺钉", false], ["单语标签", "双语标签", false], ["单面标签", "双面标签", false]
  ])("handles legacy specification/attribute case %s vs %s", (left, right, same) => {
    const result = compare(features({ name: "标签", spec: left }), features({ name: "标签", spec: right }));
    expect(Boolean(result && result.score >= 80)).toBe(same);
  });

  it("keeps exact, missing, same-code and large-bucket disclosure", () => {
    const rows = [
      { row: 1, code: "1", name: "圆管", spec: "T1 × 20 × 50" }, { row: 2, code: "2", name: "圆管", spec: "T1*20*50" },
      { row: 3, code: "3", name: "铁管", spec: "" }, { row: 4, code: "4", name: "铁管", spec: "—" }, { row: 5, code: "4", name: "铁管", spec: "—" }
    ];
    const result = scanRows(rows);
    expect(result.counts).toEqual({ exact: 1, similar: 0, missing: 1, code: 1 });
    const large = scanRows(Array.from({ length: 121 }, (_, index) => ({ row: index, code: String(index), name: "圆管", spec: "T1*20*50" })));
    expect(large.skippedBlocks).toBe(1); expect(large.skippedPairs).toBe(121 * 120 / 2); expect(large.groups[0]?.membersTruncated).toBe(true);
  });

  it("preserves the browser diff behavior including empty side and Unicode", () => {
    const parts = diffParts("M6*20", "M8*25");
    expect(parts.map((side) => side.map((part) => part.text).join("")).join("|")).toBe("M6*20|M8*25");
    expect(parts[0]?.filter((part) => part.changed).map((part) => part.text).join("")).toBe("60");
    expect(parts[1]?.filter((part) => part.changed).map((part) => part.text).join("")).toBe("85");
    expect(diffParts("", "规格")).toEqual([[], [{ text: "规格", changed: true }]]);
    expect(diffParts("😀H", "😀I")).toEqual([[{ text: "😀", changed: false }, { text: "H", changed: true }], [{ text: "😀", changed: false }, { text: "I", changed: true }]]);
  });
});
