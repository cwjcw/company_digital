import { BadRequestException } from "@nestjs/common";
import { assertSpreadsheetNotEncrypted, ENCRYPTED_SPREADSHEET_MESSAGE, isEncryptedSpreadsheet } from "./spreadsheet-upload";

describe("spreadsheet upload encryption detection", () => {
  it.each([0xd6, 0xe4, 0xe0, 0x98])("recognizes the observed WPS encrypted header variant %s", (fourthByte) => {
    expect(isEncryptedSpreadsheet(Buffer.from([0x88, 0x7d, 0x1c, fourthByte, 0x56, 0x02]))).toBe(true);
  });

  it("recognizes encrypted Microsoft Office compound files", () => {
    const buffer = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(128), Buffer.from("EncryptionInfo", "utf16le")
    ]);
    expect(isEncryptedSpreadsheet(buffer)).toBe(true);
  });

  it("recognizes a ZIP container whose general-purpose encryption flag is set", () => {
    const buffer = Buffer.alloc(30); buffer.writeUInt32LE(0x04034b50, 0); buffer.writeUInt16LE(0x0001, 6);
    expect(isEncryptedSpreadsheet(buffer)).toBe(true);
  });

  it("does not reject an ordinary XLSX ZIP header", () => {
    expect(isEncryptedSpreadsheet(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toBe(false);
  });

  it("returns the exact user-facing message", () => {
    expect(() => assertSpreadsheetNotEncrypted(Buffer.from([0x88, 0x7d, 0x1c, 0xe4]))).toThrow(new BadRequestException(ENCRYPTED_SPREADSHEET_MESSAGE));
  });
});
