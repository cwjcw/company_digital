import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Repository } from "typeorm";
import { Contact, DevelopmentRequest, DevelopmentRequestEvent, User } from "../../entities";
import { availableDevelopmentActions, type DevelopmentActor, isDevelopmentAdmin } from "./development-request.workflow";

type RequestInput = {
  title?: string;
  category?: string;
  description?: string;
  businessValue?: string | null;
  urgency?: string;
  desiredDate?: string | null;
  requesterManagerId?: string;
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

  private async activeUser(id: string | undefined, label: string, manager: EntityManager = this.dataSource.manager) {
    if (!id) throw new BadRequestException(`请选择${label}`);
    const user = await manager.findOneBy(User, { id, enabled: true });
    if (!user) throw new BadRequestException(`${label}不存在或已停用`);
    return user;
  }

  private canView(request: DevelopmentRequest, actor: DevelopmentActor) {
    return isDevelopmentAdmin(actor) || [request.requesterId, request.requesterManagerId, request.handlerId, request.handlerManagerId].includes(actor.id);
  }

  private async locked(id: string, manager: EntityManager) {
    const request = await manager.getRepository(DevelopmentRequest).createQueryBuilder("request").setLock("pessimistic_write").where("request.id = :id", { id }).getOne();
    if (!request) throw new NotFoundException("需求不存在");
    return request;
  }

  private async addEvent(manager: EntityManager, request: DevelopmentRequest, actor: DevelopmentActor, action: string, fromStatus: string | null, comment?: string | null, snapshot?: unknown) {
    await manager.save(DevelopmentRequestEvent, {
      requestId: request.id, actorId: actor.id, actorName: actor.name, action,
      fromStatus, toStatus: request.status, comment: comment?.trim() || null, snapshot: snapshot ?? null
    });
  }

  private validateRequestInput(input: RequestInput) {
    const urgency = String(input.urgency ?? "NORMAL");
    if (!["LOW", "NORMAL", "HIGH", "URGENT"].includes(urgency)) throw new BadRequestException("紧急程度无效");
    return {
      title: this.cleanText(input.title, "需求标题", 200),
      category: this.cleanText(input.category, "需求类型", 50),
      description: this.cleanText(input.description, "需求说明", 10000),
      businessValue: String(input.businessValue ?? "").trim() || null,
      urgency,
      desiredDate: input.desiredDate || null,
      requesterManagerId: input.requesterManagerId
    };
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

  private async present(rows: DevelopmentRequest[], actor: DevelopmentActor) {
    const ids = [...new Set(rows.flatMap((request) => [request.requesterId, request.requesterManagerId, request.handlerId, request.handlerManagerId]).filter(Boolean) as string[])];
    const users = ids.length ? await this.users.findBy({ id: In(ids) }) : [];
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    return rows.map((request) => ({
      ...request,
      requesterName: names.get(request.requesterId) ?? "—",
      requesterManagerName: names.get(request.requesterManagerId) ?? "—",
      handlerName: request.handlerId ? names.get(request.handlerId) ?? "—" : null,
      handlerManagerName: request.handlerManagerId ? names.get(request.handlerManagerId) ?? "—" : null,
      availableActions: availableDevelopmentActions(request, actor)
    }));
  }

  async list(actor: DevelopmentActor, scope?: string, search?: string) {
    let rows = await this.requests.find({ order: { updatedAt: "DESC" }, take: 1000 });
    rows = rows.filter((request) => this.canView(request, actor));
    if (scope === "mine") rows = rows.filter((request) => request.requesterId === actor.id);
    if (scope === "todo") rows = rows.filter((request) => availableDevelopmentActions(request, actor).length > 0);
    const keyword = String(search ?? "").trim().toLocaleLowerCase();
    if (keyword) rows = rows.filter((request) => [request.requestNumber, request.title, request.description, request.category].some((value) => String(value).toLocaleLowerCase().includes(keyword)));
    return this.present(rows, actor);
  }

  async detail(id: string, actor: DevelopmentActor) {
    const request = await this.requests.findOneBy({ id });
    if (!request) throw new NotFoundException("需求不存在");
    if (!this.canView(request, actor)) throw new ForbiddenException("无权查看该需求");
    const [presented] = await this.present([request], actor);
    const events = await this.events.find({ where: { requestId: id }, order: { createdAt: "ASC" } });
    return { ...presented, events };
  }

  async create(input: RequestInput, actor: DevelopmentActor) {
    const values = this.validateRequestInput(input);
    return this.dataSource.transaction(async (manager) => {
      await this.activeUser(actor.id, "填写人", manager);
      const approver = await this.activeUser(values.requesterManagerId, "上级审批领导", manager);
      if (approver.id === actor.id) throw new BadRequestException("上级审批领导不能选择本人");
      const [number] = await manager.query(`SELECT 'REQ-' || to_char(current_date,'YYYYMM') || '-' || lpad(nextval('development_request_number_seq')::text,6,'0') AS value`);
      const request = await manager.save(DevelopmentRequest, {
        ...values, requesterManagerId: approver.id, requestNumber: number.value,
        requesterId: actor.id, status: "PENDING_REQUESTER_APPROVAL", handlerId: null, handlerManagerId: null,
        requiredResources: null, estimatedWorkdays: null, plannedCompletionDate: null,
        requesterApprovedAt: null, assignedAt: null, planSubmittedAt: null, handlerManagerApprovedAt: null, version: 1
      });
      await this.addEvent(manager, request, actor, "SUBMIT", null, "提交需求", values);
      return (await this.present([request], actor))[0];
    });
  }

  async resubmit(id: string, input: RequestInput, actor: DevelopmentActor) {
    const values = this.validateRequestInput(input);
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      if (request.status !== "REQUESTER_REJECTED" || request.requesterId !== actor.id) throw new ForbiddenException("当前需求不能由你重新提交");
      const approver = await this.activeUser(values.requesterManagerId, "上级审批领导", manager);
      if (approver.id === actor.id) throw new BadRequestException("上级审批领导不能选择本人");
      const from = request.status;
      Object.assign(request, values, { requesterManagerId: approver.id, status: "PENDING_REQUESTER_APPROVAL", version: request.version + 1 });
      await manager.save(request); await this.addEvent(manager, request, actor, "RESUBMIT", from, "修改后重新提交", values);
      return request;
    });
  }

  async requesterDecision(id: string, approved: boolean, comment: string | undefined, actor: DevelopmentActor) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      if (request.status !== "PENDING_REQUESTER_APPROVAL" || request.requesterManagerId !== actor.id) throw new ForbiddenException("当前需求不在你的审批节点");
      if (!approved && !String(comment ?? "").trim()) throw new BadRequestException("驳回时必须填写意见");
      const from = request.status; request.status = approved ? "PENDING_ADMIN_ASSIGNMENT" : "REQUESTER_REJECTED";
      request.requesterApprovedAt = approved ? new Date() : null; request.version += 1;
      await manager.save(request); await this.addEvent(manager, request, actor, approved ? "REQUESTER_APPROVE" : "REQUESTER_REJECT", from, comment);
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
      if (!["PENDING_HANDLER_PLAN", "HANDLER_MANAGER_REJECTED"].includes(request.status) || request.handlerId !== actor.id) throw new ForbiddenException("当前需求不能由你提交开发评估");
      const resources = this.cleanText(input.requiredResources, "开发所需资源", 10000);
      const workdays = Number(input.estimatedWorkdays);
      if (!Number.isFinite(workdays) || workdays <= 0 || workdays > 9999) throw new BadRequestException("开发所需时间必须是大于 0 的工作日数");
      if (!input.plannedCompletionDate) throw new BadRequestException("请选择计划完成日期");
      const from = request.status;
      Object.assign(request, { requiredResources: resources, estimatedWorkdays: String(workdays), plannedCompletionDate: input.plannedCompletionDate, status: "PENDING_HANDLER_MANAGER_APPROVAL", planSubmittedAt: new Date(), version: request.version + 1 });
      await manager.save(request); await this.addEvent(manager, request, actor, "SUBMIT_PLAN", from, "提交资源与工期评估", { requiredResources: resources, estimatedWorkdays: workdays, plannedCompletionDate: input.plannedCompletionDate });
      return request;
    });
  }

  async handlerManagerDecision(id: string, approved: boolean, comment: string | undefined, actor: DevelopmentActor) {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.locked(id, manager);
      if (request.status !== "PENDING_HANDLER_MANAGER_APPROVAL" || request.handlerManagerId !== actor.id) throw new ForbiddenException("当前需求不在你的审批节点");
      if (!approved && !String(comment ?? "").trim()) throw new BadRequestException("驳回时必须填写意见");
      const from = request.status; request.status = approved ? "APPROVED_FOR_DEVELOPMENT" : "HANDLER_MANAGER_REJECTED";
      request.handlerManagerApprovedAt = approved ? new Date() : null; request.version += 1;
      await manager.save(request); await this.addEvent(manager, request, actor, approved ? "HANDLER_APPROVE" : "HANDLER_REJECT", from, comment);
      return request;
    });
  }
}
