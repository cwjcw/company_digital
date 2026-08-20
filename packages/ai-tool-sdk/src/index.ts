export interface AiToolDefinition {
  name: string; description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permission: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  requiresConfirmation: boolean;
  readOnly: true;
}

const readOnlyTool = (name: string, description: string): AiToolDefinition => ({
  name, description, inputSchema: { type: "object", additionalProperties: false },
  outputSchema: { type: "object" }, permission: "planning.plan.read", riskLevel: "LOW",
  requiresConfirmation: false, readOnly: true
});

export const planningAiTools = [
  readOnlyTool("planning.plan.search", "按月份、订单、品号和状态查询计划"),
  readOnlyTool("planning.plan.get", "读取单个计划和版本信息"),
  readOnlyTool("planning.order.progress", "读取订单执行进度"),
  readOnlyTool("planning.process.progress", "读取工序进度"),
  readOnlyTool("planning.risk.summary", "读取交期、工序和异常风险摘要")
] as const;
