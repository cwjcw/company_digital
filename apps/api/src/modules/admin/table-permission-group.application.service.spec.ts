import { BadRequestException } from "@nestjs/common";
import { mpsReportContextProjectionFieldKeys, presetPermissionGroupTypes, presetTablePermissionMatrix, tablePermissionActions } from "@kdos/contracts";
import { AuditLog, Permission, PermissionGroupSubject, Role } from "../../entities";
import { TablePermissionGroupApplicationService } from "./table-permission-group.application.service";

describe("TablePermissionGroupApplicationService", () => {
  const service = new TablePermissionGroupApplicationService({} as never) as any;

  it("uses the immutable server preset matrix", () => {
    for (const groupType of presetPermissionGroupTypes) {
      expect(service.actions({ groupType })).toEqual(tablePermissionActions.filter((action) => presetTablePermissionMatrix[groupType][action]));
    }
  });

  it("requires read whenever custom permissions manage existing rows", () => {
    expect(() => service.actions({ groupType: "CUSTOM", actions: ["update"] })).toThrow(BadRequestException);
  });

  it("never permits audit fields to become editable", () => {
    expect(() => service.fields("mps-process-reports", { groupType: "CUSTOM", fields: [{ fieldKey: "createdBy", visible: true, editable: true }] }, ["read", "update"]))
      .toThrow(BadRequestException);
  });

  it("keeps MPS report authorization on historical columns and rejects live/display projections", () => {
    for (const fieldKey of mpsReportContextProjectionFieldKeys) {
      expect(() => service.rules("mps-process-reports", { groupType: "CUSTOM", dataRules: [{ fieldKey, operator: "NE", value: "value" }] })).toThrow("请使用历史事业部");
    }
    expect(service.rules("mps-process-reports", { groupType: "CUSTOM", dataRules: [{ fieldKey: "divisionId", operator: "EQ", value: "synthetic-division" }] })).toHaveLength(1);
  });

  it("creates a custom group using explicit entity targets throughout the transaction", async () => {
    const queryBuilder: any = {};
    queryBuilder.insert = jest.fn(() => queryBuilder);
    queryBuilder.into = jest.fn(() => queryBuilder);
    queryBuilder.values = jest.fn(() => queryBuilder);
    queryBuilder.orIgnore = jest.fn(() => queryBuilder);
    queryBuilder.execute = jest.fn().mockResolvedValue({ identifiers: [] });
    const save = jest.fn(async (target: unknown, value?: any) => {
      if (value === undefined) throw new Error("entity target required");
      if (target === Role && !value.id) return { id: "permission-role-1", version: 0, ...value };
      if (target === Permission && !value.roleId) throw new Error("permission roleId required");
      return value;
    });
    const manager = {
      count: jest.fn().mockResolvedValue(1),
      findOneBy: jest.fn().mockResolvedValue(null),
      save,
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      createQueryBuilder: jest.fn(() => queryBuilder)
    };
    const dataSource = { transaction: jest.fn((work: (entityManager: typeof manager) => unknown) => work(manager)) };
    const application = new TablePermissionGroupApplicationService(dataSource as never);

    await application.create({
      resource: "mps-process-reports",
      groupType: "CUSTOM",
      displayName: "测试自定义权限",
      actions: ["read"],
      fields: [{ fieldKey: "createdBy", visible: true, editable: false }],
      subjects: [{ type: "USER", id: "user-1" }]
    }, { userId: "admin-1", name: "管理员", requestId: "request-1" });

    expect(save).toHaveBeenCalledWith(Role, expect.objectContaining({ id: "permission-role-1", version: 1 }));
    expect(save).toHaveBeenCalledWith(Permission, expect.objectContaining({ roleId: "permission-role-1", resource: "mps-process-reports", fieldKey: "*", read: true }));
    expect(save).toHaveBeenCalledWith(AuditLog, expect.objectContaining({ action: "table_permission_group.created_or_members_added" }));
    expect(queryBuilder.into).toHaveBeenCalledWith(PermissionGroupSubject);
    expect(save.mock.calls.every((call) => call.length === 2)).toBe(true);
  });
});

describe('shared legacy grant compatibility',()=>{
  function setup(resource='mps-base-plans'){
    const role={id:'synthetic',version:3,permissionGroupResource:resource,permissionGroupType:'CUSTOM',permissionGroupScope:'ALL',permissionGroupConditionMatch:'ALL',permissionGroupDataRules:[],description:null};
    const permissions=[{fieldKey:'*',read:true,create:true,update:true},{fieldKey:resource==='mps-base-plans'?'deliveryNumber':'createdBy',read:true,update:true},{fieldKey:resource==='mps-base-plans'?'plannedQuantity':'productionQuantity',read:true,update:true}];
    const manager={findOne:jest.fn(async()=>({...role})),find:jest.fn(async()=>permissions),save:jest.fn(async(_t,v)=>v),delete:jest.fn()};
    const service=new TablePermissionGroupApplicationService({transaction:async(fn:any)=>fn(manager)} as never);return {service,manager,role};
  }
  const actor={userId:'synthetic-admin',name:'合成管理员',requestId:'synthetic-request'};
  it.each(['mps-base-plans','mps-process-reports'])('%s create-only patch keeps legal fields, restricts legacy and records explicit audit',async resource=>{
    const {service,manager}=setup(resource);await service.update('synthetic',{version:3,actions:['read','update']},actor);
    expect(manager.save).toHaveBeenCalledWith(Permission,expect.objectContaining({fieldKey:resource==='mps-base-plans'?'deliveryNumber':'createdBy',read:true,update:false}));
    expect(manager.save).toHaveBeenCalledWith(Permission,expect.objectContaining({fieldKey:resource==='mps-base-plans'?'plannedQuantity':'productionQuantity',read:true,update:true}));
    expect(manager.save).toHaveBeenCalledWith(AuditLog,expect.objectContaining({action:'table_permission_group.legacy_fields_restricted'}));
    expect(manager.delete).not.toHaveBeenCalledWith(PermissionGroupSubject,expect.anything());
  });
  it('explicit readonly true is rejected even if old stored value was true',async()=>{const {service}=setup();await expect(service.update('synthetic',{version:3,fields:[{fieldKey:'deliveryNumber',visible:true,editable:true}]},actor)).rejects.toThrow('不能设置为可编辑');});
  it('partial valid field edit keeps other fields instead of clearing them',async()=>{const {service,manager}=setup();await service.update('synthetic',{version:3,fields:[{fieldKey:'plannedQuantity',visible:true,editable:true}]},actor);expect(manager.save).toHaveBeenCalledWith(Permission,expect.objectContaining({fieldKey:'deliveryNumber',read:true,update:false}));});
  it('version conflict rejects before writing and acquires row lock',async()=>{const {service,manager}=setup();await expect(service.update('synthetic',{version:2,actions:['read']},actor)).rejects.toMatchObject({status:409});expect(manager.save).not.toHaveBeenCalled();expect(manager.findOne).toHaveBeenCalledWith(Role,expect.objectContaining({lock:{mode:'pessimistic_write'}}));});
});
