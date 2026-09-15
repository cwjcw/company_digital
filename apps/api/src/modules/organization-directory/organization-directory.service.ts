import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { OrganizationUnit } from "../../entities";

export type OrganizationDirectoryOption = { id: string; name: string; path: string[]; pathLabel: string };

@Injectable()
export class OrganizationDirectoryService {
  constructor(@InjectRepository(OrganizationUnit) private readonly organizations: Repository<OrganizationUnit>) {}

  async listEnabled(): Promise<OrganizationDirectoryOption[]> {
    const units = await this.organizations.find({ where: { enabled: true }, order: { level: "ASC", sortOrder: "ASC", name: "ASC" } });
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const pathOf = (unit: OrganizationUnit) => {
      const path: string[] = []; const seen = new Set<string>(); let current: OrganizationUnit | undefined = unit;
      while (current && !seen.has(current.id)) { seen.add(current.id); path.unshift(current.name); current = current.parentId ? byId.get(current.parentId) : undefined; }
      return path;
    };
    return units.map((unit) => { const path = pathOf(unit); return { id: unit.id, name: unit.name, path, pathLabel: path.join(" / ") }; });
  }

  resolve(value: unknown, options: OrganizationDirectoryOption[], context = "事业部") {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const exactId = options.find((option) => option.id === text);
    if (exactId) return exactId;
    const candidates = options.filter((option) => option.name === text || option.pathLabel === text);
    if (!candidates.length) throw new BadRequestException(`${context}“${text}”不在企业微信组织架构中`);
    if (candidates.length > 1) throw new BadRequestException({ message: `${context}“${text}”存在重名，请使用完整组织路径`, candidates: candidates.map((candidate) => candidate.pathLabel) });
    return candidates[0]!;
  }
}
