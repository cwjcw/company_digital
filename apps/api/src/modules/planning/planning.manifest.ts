import { planningAiTools } from "@kdos/ai-tool-sdk";
import { planningPermissions } from "@kdos/contracts";
import type { KdosPluginManifest } from "@kdos/plugin-sdk";

export const planningManifest: KdosPluginManifest = {
  id: "planning", name: "Planning Center / 计划中心", version: "1.0.0",
  navigation: [{ key: "planning", label: "计划中心", path: "/planning", icon: "schedule" }],
  routes: [{ path: "/planning", permission: "planning.plan.read" }, { path: "/monthly/:period", permission: "planning.plan.read" }],
  permissions: planningPermissions,
  events: ["planning.plan_item.updated", "planning.plan.reordered", "planning.plan.published", "planning.plan.locked", "planning.plan.unlocked", "planning.plan.imported"],
  workflows: ["planning.plan.publish", "planning.plan.major_change", "planning.delivery_date.change", "planning.plan.unlock", "planning.period.close"],
  aiTools: planningAiTools.map((tool) => tool.name)
};
