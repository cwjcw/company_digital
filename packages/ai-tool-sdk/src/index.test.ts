import { describe, expect, it } from "vitest";
import { planningAiTools } from "./index";
describe("Planning AI tools", () => { it("are read-only contracts", () => { expect(planningAiTools).toHaveLength(5); expect(planningAiTools.every((tool) => tool.readOnly && !tool.requiresConfirmation)).toBe(true); }); });
