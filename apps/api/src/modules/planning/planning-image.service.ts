import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import sharp from "sharp";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/object-storage";
import { PlanningApplicationService } from "./planning.application.service";
import type { PlanningActor } from "./planning.types";

const allowedMime = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

@Injectable()
export class PlanningImageService {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, private readonly commands: PlanningApplicationService) {}
  async add(itemId: string, file: Express.Multer.File, expectedVersion: number, actor: PlanningActor) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择图片");
    let extension = allowedMime.get(file.mimetype); if (!extension) throw new BadRequestException("只支持 JPG、PNG、WebP 图片");
    const maxBytes = Number(process.env.MAX_IMAGE_BYTES ?? 3 * 1024 * 1024); let body = file.buffer;
    if (body.length > maxBytes) { body = await sharp(body).rotate().resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(); extension = "jpg"; }
    if (body.length > maxBytes) throw new BadRequestException("图片压缩后仍超过 3MB");
    const key = `planning/${randomUUID()}.${extension}`; const stored = await this.storage.put({ key, body, contentType: extension === "jpg" ? "image/jpeg" : `image/${extension}` });
    try { return await this.commands.addImage(itemId, stored.url, expectedVersion, actor); }
    catch (error) { await this.storage.delete(key); throw error; }
  }
}
