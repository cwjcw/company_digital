import { BadRequestException } from "@nestjs/common";
import { Readable } from "node:stream";
import JSZip from "jszip";
import sharp from "sharp";
import { knowledgeText } from "./knowledge.content";
export async function knowledgeFile(file: Express.Multer.File) {
  if (!file?.buffer?.length || file.buffer.length > 20 * 1024 * 1024)
    throw new BadRequestException("请选择 20MB 以内的非空附件");
  const name = knowledgeText(file.originalname, "文件名", 255, true)
    .replace(/[/\\]/g, "_")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("");
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    xls: "application/vnd.ms-excel",
    ppt: "application/vnd.ms-powerpoint",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const contentType = types[extension];
  if (!contentType)
    throw new BadRequestException(
      "仅支持 PDF、Word、Excel、PPT、TXT 和 PNG/JPEG/WebP 图片",
    );
  let body = file.buffer;
  if (contentType.startsWith("image/")) {
    const png = body
      .subarray(0, 8)
      .equals(Buffer.from("89504e470d0a1a0a", "hex"));
    const jpeg = body.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
    const webp =
      body.subarray(0, 4).toString() === "RIFF" &&
      body.subarray(8, 12).toString() === "WEBP";
    if (
      !(contentType === "image/png"
        ? png
        : contentType === "image/jpeg"
          ? jpeg
          : webp)
    )
      throw new BadRequestException("图片实际格式与扩展名不一致");
    try {
      body = await sharp(body, { limitInputPixels: 40_000_000 })
        .rotate()
        .toFormat(
          extension === "jpg" || extension === "jpeg"
            ? "jpeg"
            : (extension as "png" | "webp"),
        )
        .toBuffer();
    } catch {
      throw new BadRequestException("图片内容无效或尺寸过大");
    }
  } else {
    const zip = ["docx", "xlsx", "pptx"].includes(extension);
    const ole = ["doc", "xls", "ppt"].includes(extension);
    if (
      (zip && !body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) ||
      (ole &&
        !body.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) ||
      (extension === "pdf" &&
        !body.subarray(0, 5).equals(Buffer.from("%PDF-"))) ||
      (extension === "txt" && body.includes(0))
    )
      throw new BadRequestException("附件实际格式与扩展名不一致");
  }
  if (["docx", "xlsx", "pptx"].includes(extension))
    await knowledgeOfficeArchive(body, extension as "docx" | "xlsx" | "pptx");
  if (body.length > 20 * 1024 * 1024)
    throw new BadRequestException("附件处理后超过 20MB");
  return { name, body, contentType };
}

/** Bound both directory metadata and actual decompression, before any Office parser. */
export async function knowledgeOfficeArchive(
  buffer: Buffer,
  kind: "docx" | "xlsx" | "pptx",
) {
  if (!buffer.subarray(0, 4).equals(Buffer.from("504b0304", "hex")))
    throw new BadRequestException("Office 文档实际格式无效");
  let unpacked = 0,
    entries = 0;
  for (let i = 0; i + 46 < buffer.length; i++) {
    if (buffer.readUInt32LE(i) !== 0x02014b50) continue;
    const size = buffer.readUInt32LE(i + 24);
    unpacked += size;
    entries++;
    if (
      size > 30 * 1024 * 1024 ||
      unpacked > 100 * 1024 * 1024 ||
      entries > 2000
    )
      throw new BadRequestException("Office 解压大小或文件数超过限制");
  }
  try {
    const zip = await JSZip.loadAsync(buffer);
    const main = {
      docx: "word/document.xml",
      xlsx: "xl/workbook.xml",
      pptx: "ppt/presentation.xml",
    }[kind];
    if (!zip.file("[Content_Types].xml") || !zip.file(main))
      throw new BadRequestException("Office 文档内容与扩展名不一致");
    const files = Object.values(zip.files).filter((f) => !f.dir);
    if (files.length > 2000)
      throw new BadRequestException("Office 文件数超过限制");
    let total = 0;
    for (const entry of files) {
      await new Promise<void>((resolve, reject) => {
        let bytes = 0;
        const stream = entry.nodeStream("nodebuffer") as Readable;
        stream.on("data", (chunk) => {
          bytes += chunk.length;
          total += chunk.length;
          if (bytes > 30 * 1024 * 1024 || total > 100 * 1024 * 1024)
            stream.destroy(new Error("Archive size limit"));
        });
        stream.on("end", resolve);
        stream.on("error", reject);
      });
    }
    return zip;
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException("Office 文档损坏或解压大小超过限制");
  }
}
