import { describe, expect, it } from "vitest";
import { standardProcesses } from "@tracker/shared";
import { mpsOrderProgressResource, mpsOrderProgressExportKeys, mpsOrderProgressProcessFields, tableResourceRegistry, tablePermissionFieldsFor, masterPlanResourceDefinitions, tableFilterResourceCapabilityOf } from "./index";
describe("order progress public contract",()=>{
  it("registers an independent, read-only planning resource without migration or legacy resource inheritance",()=>{
    expect(tableResourceRegistry.find(r=>r.code===mpsOrderProgressResource)?.moduleCode).toBe("planning");expect(masterPlanResourceDefinitions.some(r=>String(r.code)===mpsOrderProgressResource)).toBe(false);
    expect(tableFilterResourceCapabilityOf(mpsOrderProgressResource).status).toBe("NOT_APPLICABLE");expect(mpsOrderProgressExportKeys).toEqual(["orders","items"]);
  });
  it("all ten process columns derive in canonical order and numeric ratios remain ratios",()=>{
    expect(mpsOrderProgressProcessFields.filter(([key])=>key.endsWith('ProductionProgress')).map(([key])=>key.replace('ProductionProgress',''))).toEqual([...standardProcesses].sort((a,b)=>a.order-b.order).map(p=>p.code));
    const fields=tablePermissionFieldsFor(mpsOrderProgressResource);expect(new Set(fields.map(f=>f.key)).size).toBe(fields.length);expect(fields.find(f=>f.key==='cuttingProductionProgress')).toMatchObject({format:"percentage",percentageScale:"ratio"});
    expect(fields.some(f=>['tenantId','allocationId','monthlyPlanId','orderAmount','createdBy'].includes(f.key))).toBe(false);
  });
});
