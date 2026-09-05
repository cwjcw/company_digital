import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { AuditLog } from "../../entities";

@Injectable()
export class AuditQueryService {
  constructor(@InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>) {}

  async list(input: { page?: number; pageSize?: number; search?: string; filters?: Record<string, string>; sortField?: string; sortOrder?: string }) {
    const page = Math.max(Number(input.page) || 1, 1);
    const pageSize = [20, 50, 100, 200].includes(Number(input.pageSize)) ? Number(input.pageSize) : 50;
    const columns: Record<string, string> = { actorName:"actor_name",resource:"resource",action:"action",recordId:"record_id",source:"source",requestId:"request_id",createdBy:"created_by",createdAt:"created_at",updatedBy:"updated_by",updatedAt:"updated_at" };
    const sortColumn = columns[String(input.sortField ?? "")] ?? "created_at";
    const query = this.audits.createQueryBuilder("a").orderBy(`a.${sortColumn}`, input.sortOrder === "asc" ? "ASC" : "DESC");
    const search = String(input.search ?? "").trim();
    if (search) query.andWhere("concat_ws(' ',a.actor_name,a.resource,a.action,a.record_id,a.source,a.request_id) ILIKE :search", { search: `%${search}%` });
    let filterIndex = 0;
    for (const [field, raw] of Object.entries(input.filters ?? {})) {
      const value = raw.trim(); const column = columns[field]; if (!value || !column) continue;
      const parameter = `filter${filterIndex++}`;
      query.andWhere(`CAST(a.${column} AS text) ILIKE :${parameter}`, { [parameter]: `%${value}%` });
    }
    const [rows,total] = await query.skip((page-1)*pageSize).take(pageSize).getManyAndCount();
    return { rows,total,page,pageSize };
  }
}
