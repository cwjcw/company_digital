import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import sharp from "sharp";
import { Repository } from "typeorm";
import { AuditLog, OrderItem } from "./entities";
import { PlanGateway } from "./gateway";
import { OBJECT_STORAGE, type ObjectStorage } from "./storage/object-storage";

const allowedMime = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]
]);

@Injectable()
export class StorageService {
  constructor(
    @InjectRepository(OrderItem) private readonly items: Repository<OrderItem>,
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
    private readonly gateway: PlanGateway,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage
  ) {}

  async addImages(itemId: string, files: Express.Multer.File[], user: any, requestId: string) {
    if (!(user.permissions?.includes("*") || user.permissions?.some((permission: string) => permission === "monthly-plan:image:update" || permission === "monthly-plan:*:update"))) {
      throw new ForbiddenException("没有上传简图的权限");
    }
    if (!files?.length || files.length > 2) throw new BadRequestException("一次最多上传 2 张图片");
    const item = await this.items.findOne({ where: { id: itemId }, relations: { order: true } });
    if (!item) throw new NotFoundException("品号不存在");
    if (user.divisions !== "*" && !user.divisions.includes(item.order.division)) throw new ForbiddenException("超出事业部数据范围");
    const existing = item.imageRefs ?? [];
    if (existing.length + files.length > 2) throw new BadRequestException("每个品号最多保存 2 张图片");
    const maxBytes = Number(process.env.MAX_IMAGE_BYTES ?? 3 * 1024 * 1024);
    const urls: string[] = [];
    for (const file of files) {
      const extension = allowedMime.get(file.mimetype);
      if (!extension) throw new BadRequestException("只支持 JPG、PNG、WebP 图片");
      let buffer = file.buffer;
      let finalExtension = extension;
      if (buffer.length > maxBytes) {
        buffer = await sharp(buffer).rotate().resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
        finalExtension = "jpg";
        if (buffer.length > maxBytes) throw new BadRequestException("图片压缩后仍超过 3MB，请选择更小的图片");
      }
      const name = `${randomUUID()}.${finalExtension}`;
      const stored = await this.objectStorage.put({ key: name, body: buffer, contentType: `image/${finalExtension === "jpg" ? "jpeg" : finalExtension}` });
      urls.push(stored.url);
    }
    item.imageRefs = [...existing, ...urls];
    item.version += 1;
    await this.items.save(item);
    await this.audits.save({
      actorId: user.sub, actorName: user.username, resource: "monthly-plan", recordId: item.id,
      action: "upload-image", beforeJson: { imageRefs: existing }, afterJson: { imageRefs: item.imageRefs }, requestId, source: "web"
    });
    const changed = { id: item.id, imageRefs: item.imageRefs, version: item.version };
    this.gateway.broadcast(item.periodId, item.order.division, changed);
    return changed;
  }
}
