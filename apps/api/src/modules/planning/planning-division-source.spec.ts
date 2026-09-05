import { divisionFromProvenance, inferDivisionAssignments } from "./planning-division-source";

describe("planning division source", () => {
  it("reads the division encoded from the original source filename", () => {
    expect(divisionFromProvenance("来源：事业四部/主计划/第436行；备注")).toBe("事业四部");
  });

  it("assigns derived child item rows from their uniquely sourced base item", () => {
    const result = inferDivisionAssignments([
      { id: "base", orderNumber: "SO-1", itemNumber: "ITEM-1", remark: "来源：事业四部/主计划/第10行" },
      { id: "child", orderNumber: "SO-1", itemNumber: "ITEM-1-1/1", remark: null }
    ]);
    expect(result.unresolved).toEqual([]);
    expect(result.assignments.get("child")).toBe("事业四部");
  });

  it("does not guess when filename-derived candidates remain ambiguous", () => {
    const result = inferDivisionAssignments([
      { id: "one", orderNumber: "SO-2", itemNumber: "A", remark: "来源：事业三部/在制订单汇总/第1行" },
      { id: "two", orderNumber: "SO-2", itemNumber: "B", remark: "来源：事业四部/主计划/第2行" },
      { id: "unknown", orderNumber: "SO-2", itemNumber: "C", remark: null }
    ]);
    expect(result.assignments.has("unknown")).toBe(false);
    expect(result.unresolved[0]).toMatchObject({ id: "unknown", candidates: ["事业三部", "事业四部"] });
  });
});
