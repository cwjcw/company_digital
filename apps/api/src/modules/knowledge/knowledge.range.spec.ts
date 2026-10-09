import { knowledgeByteRange } from "./knowledge.range";
describe("Knowledge authenticated streaming range semantics", () => {
  it.each([
    [undefined, null],
    ["bytes=0-9", { start: 0, end: 9 }],
    ["bytes=20-", { start: 20, end: 99 }],
    ["bytes=-10", { start: 90, end: 99 }],
    ["bytes=-200", { start: 0, end: 99 }],
    ["bytes=50-200", { start: 50, end: 99 }],
  ])("handles %s", (header, expected) => {
    expect(knowledgeByteRange(header as string | undefined, 100)).toEqual(
      expected,
    );
  });
  it.each([
    "bytes=100-",
    "bytes=7-2",
    "bytes=-0",
    "bytes=-",
    "items=0-10",
    "bytes=0-1,4-5",
    "bytes=999999999999999999-",
    "bytes=a-b",
  ])("rejects invalid or unsatisfiable %s", (header) => {
    expect(() => knowledgeByteRange(header, 100)).toThrow();
  });
  it("rejects a range on an empty object", () => {
    expect(() => knowledgeByteRange("bytes=0-", 0)).toThrow();
  });
});
