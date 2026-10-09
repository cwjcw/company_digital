import { BadRequestException } from "@nestjs/common";
import { createReadStream, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { diskStorage } from "multer";
import yauzl from "yauzl";
import sharp from "sharp";
import {
  assertSpreadsheetNotEncrypted,
  ENCRYPTED_SPREADSHEET_MESSAGE,
} from "../../spreadsheet-upload";
import { knowledgeText } from "./knowledge.content";

export function knowledgeUploadLimit() {
  const mb = Number(process.env.KNOWLEDGE_MAX_FILE_MB ?? 100);
  if (!Number.isInteger(mb) || mb < 1 || mb > 100)
    throw new Error("KNOWLEDGE_MAX_FILE_MB must be 1..100");
  return mb * 1024 * 1024;
}
const temporary = path.join(os.tmpdir(), "kdos-knowledge-uploads");
export const knowledgeDiskUpload = {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      try {
        mkdirSync(temporary, { recursive: true, mode: 0o700 });
        callback(null, temporary);
      } catch (e) {
        callback(e as Error, temporary);
      }
    },
  }),
  limits: { fileSize: knowledgeUploadLimit(), files: 1, fields: 10 },
};
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
export async function validateKnowledgeUpload(file: Express.Multer.File) {
  if (!file?.path || !file.size || file.size > knowledgeUploadLimit())
    throw new BadRequestException("请选择限制大小以内的非空文件");
  const suppliedName = file.originalname;
  const decoded = [...suppliedName].every((c) => c.charCodeAt(0) <= 255)
    ? Buffer.from(suppliedName, "latin1").toString("utf8")
    : suppliedName;
  const name = knowledgeText(
    decoded.includes("\ufffd") ? suppliedName : decoded,
    "文件名",
    255,
    true,
  )
    .replace(/[/\\]/g, "_")
    .split("")
    .map((c) => (c.charCodeAt(0) < 32 ? "_" : c))
    .join("");
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = types[extension];
  if (!contentType)
    throw new BadRequestException(
      "仅支持PDF、Word、PPT、Excel、TXT和PNG/JPEG/WebP",
    );
  const handle = await fs.open(file.path, "r");
  let header: Buffer, tail: Buffer;
  try {
    header = Buffer.alloc(Math.min(file.size, 65536));
    await handle.read(header, 0, header.length, 0);
    tail = Buffer.alloc(Math.min(file.size, 65536));
    await handle.read(tail, 0, tail.length, file.size - tail.length);
  } finally {
    await handle.close();
  }
  // Unified container detection runs before any Office or image parser. OLE may store encryption directory beyond the prefix.
  assertSpreadsheetNotEncrypted(header);
  const ole = header
    .subarray(0, 8)
    .equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  if (ole) {
    let carry = Buffer.alloc(0);
    const enc = [
      Buffer.from("EncryptedPackage", "utf16le"),
      Buffer.from("EncryptionInfo", "utf16le"),
    ];
    for await (const chunk of createReadStream(file.path)) {
      const b = Buffer.concat([carry, chunk]);
      if (enc.some((n) => b.includes(n)))
        throw new BadRequestException(ENCRYPTED_SPREADSHEET_MESSAGE);
      carry = b.subarray(Math.max(0, b.length - 64));
    }
  }
  if (["docx", "xlsx", "pptx"].includes(extension))
    await validateKnowledgeArchive(file.path, extension);
  else if (["doc", "xls", "ppt"].includes(extension)) {
    if (!ole || file.size < 512)
      throw new BadRequestException("Office实际格式与扩展名不一致或文件损坏");
    // OLE stream names identify document family; inspect in bounded chunks rather than buffer the entire original.
    const names =
      extension === "doc"
        ? ["WordDocument"]
        : extension === "xls"
          ? ["Workbook", "Book"]
          : ["PowerPoint Document"];
    let found = false,
      carry = Buffer.alloc(0);
    for await (const chunk of createReadStream(file.path)) {
      const b = Buffer.concat([carry, chunk]);
      if (names.some((n) => b.includes(Buffer.from(n, "utf16le"))))
        found = true;
      carry = b.subarray(Math.max(0, b.length - 64));
    }
    if (!found) throw new BadRequestException("Office文档内容与扩展名不一致");
  } else if (extension === "pdf") {
    if (
      header.subarray(0, 5).toString() !== "%PDF-" ||
      !tail.includes(Buffer.from("%%EOF"))
    )
      throw new BadRequestException("PDF文件损坏或格式不一致");
  } else if (contentType.startsWith("image/")) {
    const png = header
        .subarray(0, 8)
        .equals(Buffer.from("89504e470d0a1a0a", "hex")),
      jpeg = header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
      webp =
        header.subarray(0, 4).toString() === "RIFF" &&
        header.subarray(8, 12).toString() === "WEBP";
    if (!(extension === "png" ? png : extension === "webp" ? webp : jpeg))
      throw new BadRequestException("图片实际格式与扩展名不一致");
    try {
      await sharp(file.path, { limitInputPixels: 40_000_000 }).metadata();
    } catch {
      throw new BadRequestException("图片损坏或尺寸过大");
    }
  } else {
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      for await (const b of createReadStream(file.path)) {
        if (b.includes(0)) throw new Error("Binary text");
        decoder.decode(b, { stream: true });
      }
      decoder.decode();
    } catch {
      throw new BadRequestException("文本文件必须为UTF-8文本");
    }
  }
  const hash = createHash("sha256");
  for await (const b of createReadStream(file.path)) hash.update(b);
  return {
    name,
    extension,
    contentType,
    size: file.size,
    sha256: hash.digest("hex"),
  };
}
/** Directory and actual decompression limits, lazy streams, no full ZIP buffer. */
export async function validateKnowledgeArchive(
  filename: string,
  extension: string,
) {
  const required = {
    docx: "word/document.xml",
    xlsx: "xl/workbook.xml",
    pptx: "ppt/presentation.xml",
  }[extension];
  if (!required) throw new BadRequestException("未知Office类型");
  try {
    await new Promise<void>((resolve, reject) => {
      yauzl.open(
        filename,
        { lazyEntries: true, validateEntrySizes: true },
        (err, zip) => {
          if (err || !zip) return reject(err);
          let count = 0,
            total = 0,
            actual = 0;
          const names = new Set<string>();
          const fail = (e: Error) => {
            zip.close();
            reject(e);
          };
          zip.on("error", fail);
          zip.on("end", () => {
            if (!names.has(required) || !names.has("[Content_Types].xml"))
              reject(new Error("Office主文件不符"));
            else resolve();
          });
          zip.on("entry", (entry: yauzl.Entry) => {
            if (entry.generalPurposeBitFlag & 1)
              return fail(
                new BadRequestException(ENCRYPTED_SPREADSHEET_MESSAGE),
              );
            if (
              entry.fileName.includes("..") ||
              entry.fileName.startsWith("/") ||
              ++count > 5000 ||
              entry.uncompressedSize > 128 * 1024 * 1024 ||
              (total += entry.uncompressedSize) > 512 * 1024 * 1024 ||
              entry.uncompressedSize / Math.max(1, entry.compressedSize) > 1000
            )
              return fail(new Error("Office解压大小、压缩比或文件数超过限制"));
            names.add(entry.fileName);
            if (entry.fileName.endsWith("/")) return zip.readEntry();
            zip.openReadStream(entry, (error, stream) => {
              if (error || !stream)
                return fail(error ?? new Error("无法读取Office内容"));
              stream.on("error", fail);
              stream.on("data", (b: Buffer) => {
                actual += b.length;
                if (actual > 512 * 1024 * 1024) {
                  stream.destroy();
                  fail(new Error("Office解压大小超过限制"));
                }
              });
              stream.on("end", () => zip.readEntry());
              stream.resume();
            });
          });
          zip.readEntry();
        },
      );
    });
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException(
      "Office文档损坏、格式不一致或解压大小超过限制",
    );
  }
}
