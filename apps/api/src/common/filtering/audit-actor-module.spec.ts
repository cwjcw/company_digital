import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { MasterPlanSystemModule } from "../../modules/master-plan-system/master-plan.module";
import { FieldCandidateService } from "./field-candidate.service";
import { AuditActorIdentityResolver } from "../audit/audit-actor-identity.resolver";
import { KDOS_DATABASE } from "../../modules/organization-directory/kdos-database.provider";

describe("audit actor真实Nest模块装配", () => {
  it("主计划复用公共候选provider，resolver在真实模块边界可解析", async () => {
    const source = { entityMetadatas: [], options: { type: "postgres" }, getRepository: jest.fn(() => ({})), query: jest.fn() };
    const module = await Test.createTestingModule({ imports: [MasterPlanSystemModule] })
      .overrideProvider(KDOS_DATABASE).useValue({ pool: {} })
      .useMocker((token) => {
        // 不mock候选/resolver，否则会掩盖模块注入缺陷；仅替代外部基础设施。
        if (token === FieldCandidateService || token === AuditActorIdentityResolver) return undefined;
        if (token === DataSource) return source;
        return {};
      }).compile();
    try {
      expect(module.get(FieldCandidateService)).toBeInstanceOf(FieldCandidateService);
      expect(module.get(AuditActorIdentityResolver)).toBeInstanceOf(AuditActorIdentityResolver);
    } finally { await module.close(); }
  });
});
