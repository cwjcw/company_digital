import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { ApprovalFlowConfig, Role } from "../../entities";

export type ApprovalFlowRuntimeConfig = Pick<ApprovalFlowConfig,
  "flowKey" | "name" | "enabled" | "allowDraft" | "allowWithdraw" | "returnMode" |
  "rejectTargetMode" | "approvalCommentRequired" | "adminRoleNames" | "nodeLabels" | "version"
>;

export const FLOW_CONFIG_ADMIN_ROLES = ["系统管理员", "集团管理员"];

@Injectable()
export class ApprovalFlowConfigService {
  constructor(
    @InjectRepository(ApprovalFlowConfig) private readonly configs: Repository<ApprovalFlowConfig>,
    @InjectRepository(Role) private readonly roles: Repository<Role>
  ) {}

  assertCanManage(roles: string[]) {
    if (!roles.some((role) => FLOW_CONFIG_ADMIN_ROLES.includes(role))) throw new ForbiddenException("仅系统管理员或集团管理员可以配置审批流程");
  }

  async list(roles: string[]) {
    this.assertCanManage(roles);
    return this.configs.find({ order: { name: "ASC" } });
  }

  async get(flowKey: string): Promise<ApprovalFlowConfig> {
    const config = await this.configs.findOneBy({ flowKey });
    if (!config) throw new NotFoundException("审批流程配置不存在");
    return config;
  }

  async update(flowKey: string, input: Partial<ApprovalFlowConfig>, actor: { name: string; roles: string[] }) {
    this.assertCanManage(actor.roles);
    const config = await this.get(flowKey);
    for (const key of ["enabled", "allowDraft", "allowWithdraw", "approvalCommentRequired"] as const) {
      if (input[key] !== undefined && typeof input[key] !== "boolean") throw new BadRequestException(`${key} 必须是布尔值`);
    }
    if (input.returnMode !== undefined && !["ANY_PREVIOUS", "PREVIOUS_ONLY"].includes(input.returnMode)) throw new BadRequestException("退回范围配置无效");
    if (input.rejectTargetMode !== undefined && !["DRAFT", "PREVIOUS"].includes(input.rejectTargetMode)) throw new BadRequestException("拒绝去向配置无效");
    if (input.adminRoleNames !== undefined && !Array.isArray(input.adminRoleNames)) throw new BadRequestException("管理员节点角色配置必须是数组");
    const roleNames = input.adminRoleNames === undefined ? config.adminRoleNames : [...new Set(input.adminRoleNames.map((name) => String(name).trim()).filter(Boolean))];
    if (!roleNames.length) throw new BadRequestException("管理员节点至少需要配置一个可处理角色");
    const existingRoles = await this.roles.findBy({ name: In(roleNames) });
    if (existingRoles.length !== roleNames.length) throw new BadRequestException("管理员节点包含不存在的角色");
    if (input.nodeLabels !== undefined && (!input.nodeLabels || Array.isArray(input.nodeLabels) || typeof input.nodeLabels !== "object")) throw new BadRequestException("节点名称配置必须是对象");
    const labels = input.nodeLabels === undefined ? config.nodeLabels : Object.fromEntries(Object.entries(input.nodeLabels).map(([key, value]) => [key, String(value).trim()]));
    if (Object.values(labels).some((label) => !label || label.length > 100)) throw new BadRequestException("节点名称不能为空且不能超过 100 个字符");
    Object.assign(config, {
      enabled: input.enabled ?? config.enabled,
      allowDraft: input.allowDraft ?? config.allowDraft,
      allowWithdraw: input.allowWithdraw ?? config.allowWithdraw,
      returnMode: input.returnMode ?? config.returnMode,
      rejectTargetMode: input.rejectTargetMode ?? config.rejectTargetMode,
      approvalCommentRequired: input.approvalCommentRequired ?? config.approvalCommentRequired,
      adminRoleNames: roleNames,
      nodeLabels: labels,
      version: config.version + 1,
      updatedBy: actor.name
    });
    return this.configs.save(config);
  }
}
