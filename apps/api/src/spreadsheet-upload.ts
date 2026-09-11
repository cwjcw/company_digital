import { BadRequestException } from "@nestjs/common";

export const ENCRYPTED_SPREADSHEET_MESSAGE = "该文件被加密,请解密后再导入.";

const wpsEncryptedHeader = Buffer.from([0x88, 0x7d, 0x1c]);
const compoundFileHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const encryptedPackageName = Buffer.from("EncryptedPackage", "utf16le");
const encryptionInfoName = Buffer.from("EncryptionInfo", "utf16le");

function startsWith(buffer: Buffer, signature: Buffer) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

function zipHeaderIsEncrypted(buffer: Buffer) {
  if (buffer.length < 8 || buffer.readUInt32LE(0) !== 0x04034b50) return false;
  return (buffer.readUInt16LE(6) & 0x0001) !== 0;
}

export function isEncryptedSpreadsheet(buffer: Buffer | null | undefined) {
  if (!buffer?.length) return false;
  if (startsWith(buffer, wpsEncryptedHeader)) return true;
  if (zipHeaderIsEncrypted(buffer)) return true;
  return startsWith(buffer, compoundFileHeader)
    && (buffer.includes(encryptedPackageName) || buffer.includes(encryptionInfoName));
}

export function assertSpreadsheetNotEncrypted(buffer: Buffer | null | undefined) {
  if (isEncryptedSpreadsheet(buffer)) throw new BadRequestException(ENCRYPTED_SPREADSHEET_MESSAGE);
}
