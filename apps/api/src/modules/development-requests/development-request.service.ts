import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Repository } from "typeorm";
import { Contact, DevelopmentRequest, DevelopmentRequestEvent, User } from "../../entities";
import {
  availableDevelopmentActions, developmentApprovalCapabilities, developmentRequestStages,
  type DevelopmentActor, isDevelopmentAdmin
} from "./development-request.workflow";

type RequestInput = {
  title?: string | null;
  category?: string | null;
  description?: string | null;
  businessValue?: string | null;
  urgency?: string;
  desiredDate?: string | null;
  requesterManagerId?: string | null;
};

@Injectable()
export class DevelopmentRequestService {
  constructor(
    @InjectRepository(DevelopmentRequest) private readonly requests: Repository<DevelopmentRequest>,
    @InjectRepository(DevelopmentRequestEvent) private readonly events: Repository<DevelopmentRequestEvent>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly dataSource: DataSource
  ) {}

  private cleanText(value: unknown, label: string, max: number) {
    const text = String(value ?? "").trim();
    if (!text) throw new BadRequestException(`${label}不能为空`);
    if (text.length > max) throw new BadRequestException(`${label}不能超过 ${max} 个字符`);
    return text;
  }

  private optionalText(value: unknown, label: string, max: number) {
    const text = String(value ?? "").trim();
    if (text.length > max) throw new BadRequestException(`${label}不能超过 ${max} 个字符`);
    return text || null;
  }

  private optionalDate(value: unknown, label: string) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new BadRequestException(`${label}格式无效`);
    return text;
  }

  private draftPatch(input: RequestInput) {
    const patch: Partial<DevelopmentRequest> = {};
    if (Object.hasOwn(input, "title")) patch.title = this.optionalText(input.title, "需求标题", 200);
    if (Object.hasOwn(input, "category")) patch.category = this.optionalText(input.category, "需求类型", 50);
    if (Object.hasOwn(input, "description")) patch.description = this.optionalText(input.description, "需求说明", 10000);
    if (Object.hasOwn(input, "businessValue")) patch.businessValue = this.optionalText(input.businessValue, "业务价值", 5000);
    if (Object.hasOwn(input, "urgency")) {
      const urgency = String(input.urgency ?? "NORMAL");
      if (!["LOW", "NORMAL", "HIGH", "URGENT"].includes(urgency)) throw new BadRequestException("紧急程度无效");
      patch.urgency = urgency;
    }
    if (Object.hasOwn(input, "desiredDate")) patch.desiredDate = this.optionalDate(input.desiredDate, "期望完成日期");
    if (Object.hasOwn(input, "requesterManagerId")) patch.requesterManagerId = String(input.requesterManagerId ?? "").trim() || null;
    return patch;
  }

  private async activeUser(id: string | null | undefined, label: string, manager: EntityManager = this.dataSource.manager) {
    if (!id) throw new BadRequestException(`请选择${label}`);
    const user = await manager.findOneBy(User, { id, enabled: true });
    if (!user) throw new BadRequestException(`${label}不存在或已停用`);
    return user;
  }

  private async ensureSubmittable(request: DevelopmentRequest, manager: EntityManager) {
    request.title = this.cleanText(request.title, "需求标题", 200);
    request.category = this.cleanText(request.category, "需求类型", 50);
    request.description = this.cleanText(request.description, "需求说明", 10000);
    const approver = await this.activeUser(request.requesterManagerId, "上级审批领导", manager);
    if (approver.id === request.requesterId) throw new BadRequestException("上级审批领导不能选择本人");
    request.requesterManagerId = approver.id;
  }

  private canView(request: DevelopmentRequest, actor: DevelopmentActor) {
    if (request.status === "DRAFT") return isDevelopmentAdmin(actor) || request.requesterId === actor.id;
    return isDevelopmentAdmin(actor) || [request.requesterId, request.requesterManagerId, request.handlerId, request.handlerManagerId].includes(actor.id);
  }

  private async locked(id: string, manager: EntityManager) {
    const request = await manager.getRepository(DevelopmentRequest).createQueryBuilder("request").setLock("pessimistic_write").where("request.id = :id", { id }).getOne();
    if (!request) throw new NotFoundException("需求不存在");
    return request;
  }

  private async latestEvent(requestId: string, manager: EntityManager = this.dataSource.manager) {
    return manager.getRepository(DevelopmentRequestEvent).findOne({ where: { requestId }, order: { createdAt: "DESC" } });
  }

  private async addEvent(manager: EntityManager, request: DevelopmentRequest, actor: DevelopmentActor, action: string, fromStatus: string | null, comment?: string | null, snapshot?: unknown) {
    await manager.save(DevelopmentRequestEvent, {
      requestId: request.id, actorId: actor.id, actorName: actor.name, action,
      fromStatus, toStatus: request.status, comment: comment?.trim() || null, snapshot: snapshot ?? null
    });
  }

  async people() {
    const [users, contacts] = await Promise.all([
      this.users.find({ where: { enabled: true }, order: { displayName: "ASC" } }),
      this.contacts.find({ where: { enabled: true } })
    ]);
    const userByKey = new Map<string, User>();
    for (const user of users) for (const key of [user.id, user.username, user.employeeNo, user.wechatUserId].filter(Boolean) as string[]) userByKey.set(key, user);
    const contactByKey = new Map<string, Contact>();
    for (const contact of contacts) for (const key of [contact.wechatUserId, contact.employeeNo].filter(Boolean) as string[]) contactByKey.set(key, contact);
    return users.map((user) => {
      const contact = [user.wechatUserId, user.employeeNo].filter(Boolean).map((key) => contactByKey.get(key!)).find(Boolean);
      const managerIds = [...new Set((contact?.directLeaders ?? []).map((key) => userByKey.get(key)?.id).filter(Boolean) as string[])];
      return { id: user.id, username: user.username, displayName: user.displayName, employeeNo: user.employeeNo, position: user.position, departmentPaths: user.departmentPaths, managerIds };
    });
  }

  private async present(rows: DevelopmentRequest[], actor: DevelopmentActor, knownEvents?: DevelopmentRequestEvent[]) {
    const ids = [...new Set(rows.flatMap((request) => [request.requesterId, request.requesterManagerId, request.handlerId, request.handlerManagerId]).filter(Boolean) as string[])];
    const requestIds = rows.map((request) => request.id);
    const [users, events] = await Promise.all([
      ids.length ? this.users.findBy({ id: In(ids) }) : [],
      knownEvents ?? (requestIds.length ? this.events.find({ where: { requestId: In(requestIds) }, order: { createdAt: "ASC" } }) : [])
    ]);
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    const latestByRequest = new Map<string, DevelopmentRequestEvent>();
    for (const event of events) latestByRequest.set(event.requestId, event);
    return rows.map((request) => {
      const latest = latestByRequest.get(request.id);
      const capabilities = developmentApprovalCapabilities(request, actor, latest);
      return {
        ...request,
        requesterName: names.get(request.requesterId) ?? "—",
        requesterManagerName: request.requesterManagerId ? names.get(request.requesterManagerId) ?? "—" : "待选择",
        handlerName: request.handlerId ? names.get(request.handlerId) ?? "—" : null,
        handlerManagerName: request.handlerManagerId ? names.get(request.handlerManagerId) ?? "—" : null,
        availableActions: availableDevelopmentActions(request, actor, latest),
        returnTargets: capabilities.returnTargets.map((stage) => ({ status: stage.key, label: stage.label }))
      };
    });
  }

  async list(actor: DevelopmentActor, scope?: string, search?: string) {
    let rows = await this.requests.find({ order: { updatedAt: "DESC" }, take: 1000 });
    rows = rows.filter((request) => this.canView(request, actor));
    const keyword = String(search ?? "").trim().toLocaleLowerCase();
    if (keyword) rows = rows.filter((request) => [request.requestNumber, request.title, request.description, request.category].some((value) => String(value ?? "").toLocaleLowerCase().includes(keyword)));
    let presented = await this.present(rows, actor);
    if (scope === "mine") presented = presented.filter((request) => request.requesterId === actor.id);
    if (scope === "todo") presented = presented.filter((request) => request.availableActions.length > 0);
    return presented;
  }

  async detail(id: string, actor: DevelopmentActor) {
    const request = await this.requests.findOneBy({ id });
    if (!request) throw new NotFoundException("需求不存在");
    if (!this.canView(request, actor)) throw new ForbiddenException("无权查看该需求");
    const events = await this.events.find({ where: { requestId: id }, order: { createdAt: "ASC" } });
    const [presented] = await this.present([request], actor, events);
    return { ...presented, events };
  }

  async create(input: RequestInput, submit: boolean, actor: DevelopmentActor) {
    const patch = this.draftPatch(input);
    return this.dataSource.transaction(async (manager) => {
      await this.activeUser(actor.id, "填写人", manager);
      const [number] = await manager.query(`SELECT 'REQ-' || to_char(current_date,'YYYYMM') || '-' || lpad(nextval('development_request_number_seq')::text,6,'0') AS value`);
      const request = manager.create(DevelopmentRequest, {
        title: null, category: null, description: null, businessValue: null, urgency: "NORMAL", desiredDate: null, requesterManagerId: null,
        ...patch, requestNumber: number.value, requesterId: actor.id, status: "DRAFT", handlerId: null, handlerManagerId: null,
        requiredResources: null, estimatedWorkdays: null, plannedCompletionDate: null,
        requesterApprovedAt: null, assignedAt: null, planSubmittedAt: null, handlerManagerApprovedAt: null, version: 1
      });
      if (submit) { await this.ensureSubmittable(request, manager); request.status = "PENDING_REQUESTER_APPROVAL"; }
      await manager.save(request);
      await this.addEvent(manager, request, actor, submit ? "SUBMIT" : "SAVE_DRAFT", submit ? "DRAFT" : null, submit ? "提交需求" : "保存草稿", patch);
      return request;
    });
  }

  async updateDraft(id: string, input: RequestInput, submit: boolean, actor: DevelopmentActor) {
    const patch = this.draftPatch(input);
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      if (request.status !== "DRAFT" || request.requesterId !== actor.id) throw new ForbiddenException("当前需求草稿不能由你修改");
      Object.assign(request, patch);
      if (submit) await this.ensureSubmittable(request, manager);
      const from = request.status;
      if (submit) request.status = "PENDING_REQUESTER_APPROVAL";
      request.version += 1;
      await manager.save(request);
      await this.addEvent(manager, request, actor, submit ? "SUBMIT" : "SAVE_DRAFT", from, submit ? "提交需求" : "保存草稿", patch);
      return request;
    });
  }

  async submitDraft(id: string, actor: DevelopmentActor) {
    return this.updateDraft(id, {}, true, actor);
  }

  async resubmit(id: string, input: RequestInput, actor: DevelopmentActor) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      if (request.status !== "REQUESTER_REJECTED" || request.requesterId !== actor.id) throw new ForbiddenException("当前需求不能由你重新提交");
      request.status = "DRAFT";
      Object.assign(request, this.draftPatch(input));
      await this.ensureSubmittable(request, manager);
      request.status = "PENDING_REQUESTER_APPROVAL";
      request.version += 1;
      await manager.save(request);
      await this.addEvent(manager, request, actor, "RESUBMIT", "REQUESTER_REJECTED", "修改后重新提交");
      return request;
    });
  }

  private resetForStage(request: DevelopmentRequest, targetStatus: string) {
    const target = developmentRequestStages.find((stage) => stage.key === targetStatus);
    if (!target) throw new BadRequestException("退回目标环节无效");
    request.status = target.key;
    request.handlerManagerApprovedAt = null;
    if (target.order <= 3) request.planSubmittedAt = null;
    if (target.order <= 2) {
      request.handlerId = null; request.handlerManagerId = null; request.assignedAt = null;
      request.requiredResources = null; request.estimatedWorkdays = null; request.plannedCompletionDate = null;
    }
    if (target.order <= 1) request.requesterApprovedAt = null;
  }

  async withdraw(id: string, comment: string | undefined, actor: DevelopmentActor) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      const latest = await this.latestEvent(id, manager);
      const capabilities = developmentApprovalCapabilities(request, actor, latest);
      if (!capabilities.canWithdraw || !capabilities.withdrawTarget) throw new ForbiddenException("后续环节已处理或当前操作不能撤回");
      const from = request.status;
      this.resetForStage(request, capabilities.withdrawTarget.key);
      request.version += 1;
      await manager.save(request);
      await this.addEvent(manager, request, actor, "WITHDRAW", from, comment || "撤回上一项提交", { targetStatus: request.status });
      return request;
    });
  }

  async returnTo(id: string, targetStatus: string | undefined, comment: string | undefined, actor: DevelopmentActor) {
    const reason = this.cleanText(comment, "退回原因", 2000);
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      const latest = await this.latestEvent(id, manager);
      const capabilities = developmentApprovalCapabilities(request, actor, latest);
      const target = capabilities.returnTargets.find((stage) => stage.key === targetStatus);
      if (!target) throw new ForbiddenException("只能由当前环节处理人退回到之前的环节");
      const from = request.status;
      this.resetForStage(request, target.key);
      request.version += 1;
      await manager.save(request);
      await this.addEvent(manager, request, actor, "RETURN", from, reason, { targetStatus: target.key, targetLabel: target.label });
      return request;
    });
  }

  async requesterDecision(id: string, approved: boolean, comment: string | undefined, actor: DevelopmentActor) {
    if (!approved) return this.returnTo(id, "DRAFT", comment, actor);
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      if (request.status !== "PENDING_REQUESTER_APPROVAL" || request.requesterManagerId !== actor.id) throw new ForbiddenException("当前需求不在你的审批节点");
      const from = request.status; request.status = "PENDING_ADMIN_ASSIGNMENT";
      request.requesterApprovedAt = new Date(); request.version += 1;
      await manager.save(request); await this.addEvent(manager, request, actor, "REQUESTER_APPROVE", from, comment);
      return request;
    });
  }

  async assign(id: string, handlerId: string | undefined, handlerManagerId: string | undefined, comment: string | undefined, actor: DevelopmentActor) {
    if (!isDevelopmentAdmin(actor)) throw new ForbiddenException("仅管理员可以分配处理人员");
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      if (request.status !== "PENDING_ADMIN_ASSIGNMENT") throw new BadRequestException("当前需求不在管理员分配节点");
      const handler = await this.activeUser(handlerId, "处理人员", manager);
      const handlerManager = await this.activeUser(handlerManagerId, "处理人员上级领导", manager);
      if (handler.id === handlerManager.id) throw new BadRequestException("处理人员上级领导不能选择处理人员本人");
      const from = request.status;
      Object.assign(request, { handlerId: handler.id, handlerManagerId: handlerManager.id, status: "PENDING_HANDLER_PLAN", assignedAt: new Date(), version: request.version + 1 });
      await manager.save(request); await this.addEvent(manager, request, actor, "ASSIGN", from, comment, { handlerId: handler.id, handlerManagerId: handlerManager.id });
      return request;
    });
  }

  async submitPlan(id: string, input: { requiredResources?: string; estimatedWorkdays?: number; plannedCompletionDate?: string }, actor: DevelopmentActor) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      if (request.status !== "PENDING_HANDLER_PLAN" || request.handlerId !== actor.id) throw new ForbiddenException("当前需求不能由你提交开发评估");
      const resources = this.cleanText(input.requiredResources, "开发所需资源", 10000);
      const workdays = Number(input.estimatedWorkdays);
      if (!Number.isFinite(workdays) || workdays <= 0 || workdays > 9999) throw new BadRequestException("开发所需时间必须是大于 0 的工作日数");
      const plannedCompletionDate = this.optionalDate(input.plannedCompletionDate, "计划完成日期");
      if (!plannedCompletionDate) throw new BadRequestException("请选择计划完成日期");
      const from = request.status;
      Object.assign(request, { requiredResources: resources, estimatedWorkdays: String(workdays), plannedCompletionDate, status: "PENDING_HANDLER_MANAGER_APPROVAL", planSubmittedAt: new Date(), version: request.version + 1 });
      await manager.save(request); await this.addEvent(manager, request, actor, "SUBMIT_PLAN", from, "提交资源与工期评估", { requiredResources: resources, estimatedWorkdays: workdays, plannedCompletionDate });
      return request;
    });
  }

  async handlerManagerDecision(id: string, approved: boolean, comment: string | undefined, actor: DevelopmentActor) {
    if (!approved) return this.returnTo(id, "PENDING_HANDLER_PLAN", comment, actor);
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      if (request.status !== "PENDING_HANDLER_MANAGER_APPROVAL" || request.handlerManagerId !== actor.id) throw new ForbiddenException("当前需求不在你的审批节点");
      const from = request.status; request.status = "APPROVED_FOR_DEVELOPMENT";
      request.handlerManagerApprovedAt = new Date(); request.version += 1;
      await manager.save(request); await this.addEvent(manager, request, actor, "HANDLER_APPROVE", from, comment);
      return request;
    });
  }
}
