import { describe, expect, it } from "vitest";
import { assertValidKdosResourceSchema, validateKdosResourceSchema, type KdosResourceSchema } from "./index";

const taskSchema: KdosResourceSchema = {
  code: "supervision-task",
  label: "督办任务",
  fields: [
    { key: "taskCode", label: "任务编号", type: "text", readOnly: true },
    { key: "taskName", label: "任务名称", type: "text", required: true },
    { key: "description", label: "任务说明", type: "textarea", required: true },
    { key: "ownerId", label: "任务负责人", type: "user", required: true },
    { key: "collaboratorIds", label: "参与人", type: "user", multiple: true },
    { key: "departmentId", label: "主责部门", type: "organization", required: true },
    { key: "priority", label: "优先级", type: "select", options: [{ value: "HIGH", label: "高" }, { value: "MEDIUM", label: "中" }, { value: "LOW", label: "低" }] },
    { key: "plannedStartDate", label: "计划开始日期", type: "date", required: true },
    { key: "dueDate", label: "预计交付日期", type: "date", required: true },
    { key: "progress", label: "当前进度", type: "number" },
    { key: "completed", label: "已完成", type: "boolean" },
  ],
  form: { fields: [{ key: "taskName", label: "任务名称", type: "text" }, { key: "ownerId", label: "任务负责人", type: "user" }] },
  detail: { fields: [{ key: "taskCode", label: "任务编号", type: "text" }, { key: "dueDate", label: "预计交付日期", type: "date" }] },
  table: { columns: [{ field: "taskCode", sortable: true }, { field: "taskName", filterable: true }, { field: "dueDate", sortable: true }] },
};

describe("@kdos/ui-schema", () => {
  it("describes the main fields of a supervision task", () => {
    expect(validateKdosResourceSchema(taskSchema)).toEqual({ valid: true, errors: [] });
    expect(() => assertValidKdosResourceSchema(taskSchema)).not.toThrow();
  });

  it("reports duplicate fields, invalid views, and missing choice options", () => {
    const result = validateKdosResourceSchema({
      code: "example",
      label: "示例",
      fields: [
        { key: "status", label: "状态", type: "select" },
        { key: "status", label: "状态重复", type: "text" },
      ],
      table: { columns: [{ field: "missing" }] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "options are required for choice field: status",
      "duplicate field key: status",
      "table references unknown field: missing",
    ]));
  });
});
