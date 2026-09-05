import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { OrganizationUnit } from "../../entities";

export type PlanningOrganizationOption = {
  id: string;
  name: string;
  path: string[];
  pathLabel: string;
};

@Injectable()
export class PlanningOrganizationDirectoryService {
  constructor(@InjectRepository(OrganizationUnit) private readonly organizations: Repository<OrganizationUnit>) {}

  async listEnabled(): Promise<PlanningOrganizationOption[]> {
    const units = await this.organizations.find({ where: { enabled: true }, order: { level: "ASC", sortOrder: "ASC", name: "ASC" } });
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const pathOf = (unit: OrganizationUnit) => {
      const path: string[] = [];
      const seen = new Set<string>();
      let current: OrganizationUnit | undefined = unit;
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        path.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return path;
    };
    return units.map((unit) => {
      const path = pathOf(unit);
      return { id: unit.id, name: unit.name, path, pathLabel: path.join(" / ") };
    });
  }

  resolve(value: unknown, options: PlanningOrganizationOption[], context = "事业部") {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const exactId = options.find((option) => option.id === text);
    if (exactId) return exactId;
    const candidates = options.filter((option) => option.name === text || option.pathLabel === text);
    if (!candidates.length) throw new BadRequestException(`${context}“${text}”不在企业微信组织架构中`);
    if (candidates.length > 1) throw new BadRequestException({
      message: `${context}“${text}”存在重名，请使用完整组织路径`,
      candidates: candidates.map((candidate) => candidate.pathLabel)
    });
    return candidates[0]!;
  }

  divisionFromFileName(fileName: string, options: PlanningOrganizationOption[]) {
    const stem = fileName.replace(/\.(xlsx|csv)$/i, "").replace(/[（(]\d+[）)]$/, "").trim();
    const candidates = options.filter((option) => option.name === stem && /^事业[一二三四]部$/.test(option.name));
    if (candidates.length > 1) throw new BadRequestException({
      message: `文件名“${fileName}”对应多个同名事业部，请使用完整组织路径列`,
      candidates: candidates.map((candidate) => candidate.pathLabel)
    });
    return candidates[0] ?? null;
  }
}
