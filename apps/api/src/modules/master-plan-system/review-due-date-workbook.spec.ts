import { Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { canonicalReviewDueXml, loadReviewDueWorkbook, REVIEW_DUE_CORRUPT_XLSX, REVIEW_DUE_UNSUPPORTED_XLSX } from './review-due-date-workbook';
import { ENCRYPTED_SPREADSHEET_MESSAGE } from '../../spreadsheet-upload';

const valid = async () => {
  const w = new ExcelJS.Workbook();
  w.addWorksheet('订单批次及入库时间').addRow(['订单号', '批次号', '试制计划图号', '验货时间名称', '入库时间', '数量']);
  return Buffer.from(await w.xlsx.writeBuffer());
};
const modify = async (change: (zip: JSZip) => void) => {
  const zip = await JSZip.loadAsync(await valid()); change(zip);
  return zip.generateAsync({ type: 'nodebuffer' });
};
afterEach(() => jest.restoreAllMocks());
it('reads normal unencrypted XLSX with the installed ExcelJS runtime', async () => {
  expect((await loadReviewDueWorkbook(await valid(), 'request-test')).worksheets[0].name).toBe('订单批次及入库时间');
});
it.each([
  Buffer.from([0x88, 0x7d, 0x1c, 0]),
  Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.from('EncryptedPackage', 'utf16le')]),
  Buffer.from('504b03040000010000000000', 'hex')
])('rejects real encrypted container signatures with the exact shared message', async buffer => {
  const load = jest.spyOn(JSZip, 'loadAsync');
  await expect(loadReviewDueWorkbook(buffer, 'request-encrypted')).rejects.toThrow(ENCRYPTED_SPREADSHEET_MESSAGE);
  expect(load).not.toHaveBeenCalled();
});
it('distinguishes invalid ZIP, missing core parts and bad CRC from encryption', async () => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  for (const buffer of [Buffer.from('not a zip'), await modify(z => { z.remove('xl/workbook.xml'); })]) {
    await expect(loadReviewDueWorkbook(buffer, 'request-corrupt')).rejects.toThrow(REVIEW_DUE_CORRUPT_XLSX);
  }
  const zip = await JSZip.loadAsync(await valid());
  const stored = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const offset = stored.indexOf(Buffer.from('<?xml'));
  expect(offset).toBeGreaterThan(0); stored[offset + 2] ^= 1;
  await expect(loadReviewDueWorkbook(stored, 'request-crc')).rejects.toThrow(REVIEW_DUE_CORRUPT_XLSX);
});
it('reports malformed XML as damaged structure', async () => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const buffer = await modify(z => { z.file('xl/workbook.xml', '<workbook><sheets></workbook>'); });
  await expect(loadReviewDueWorkbook(buffer, 'request-xml')).rejects.toThrow(REVIEW_DUE_CORRUPT_XLSX);
});
it('reports unsupported structures distinctly and logs actual type/frames/requestId without XML or business text', async () => {
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  // A real, valid ZIP whose workbook lives outside ExcelJS supported locations is not an encrypted file.
  const buffer = await modify(z => { z.file('custom/workbook.xml', '<workbook/>'); z.remove('xl/workbook.xml'); });
  await expect(loadReviewDueWorkbook(buffer, 'request-relocated')).rejects.toThrow(REVIEW_DUE_UNSUPPORTED_XLSX);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-relocated', phase: 'PACKAGE', errorType: 'Error', stack: expect.stringContaining('at ') }));
});

it('keeps engine failures distinguishable and excludes sensitive exception text from diagnostics', async () => {
  const buffer = await valid(), error = new TypeError('sensitive cell value and credential');
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(ExcelJS.Workbook.prototype, 'xlsx', 'get').mockReturnValue({ load: jest.fn().mockRejectedValue(error) } as never);
  await expect(loadReviewDueWorkbook(buffer, 'request-engine')).rejects.toThrow(REVIEW_DUE_UNSUPPORTED_XLSX);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ phase: 'EXCELJS', errorType: 'TypeError', requestId: 'request-engine', stack: expect.stringContaining('at ') }));
  expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive cell');
  expect(JSON.stringify(log.mock.calls)).not.toContain('credential');
});

it('canonicalizes only spreadsheet element names and preserves aliased foreign nodes, text, CDATA and attributes', () => {
  const xml = '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets/><outside note="x:keep"><![CDATA[<x:unchanged>]]><y:cell xmlns:y="urn:foreign">x:keep</y:cell></outside></x:workbook>';
  const result = canonicalReviewDueXml(xml)!;
  expect(result).toContain('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');
  expect(result).toContain('<outside xmlns="" note="x:keep">');
  expect(result).toContain('<![CDATA[<x:unchanged>]]>');
  expect(result).toContain('<y:cell xmlns:y="urn:foreign">x:keep</y:cell>');
  expect(result).toContain('<sheets/>');
});
it.each([true, false])('reads legal prefixed XML / absolute internal table references without dropping any cells or the table (prefix=%s)', async prefixed => {
  const original = new ExcelJS.Workbook(), sheet = original.addWorksheet('订单批次及入库时间');
  sheet.addTable({ name: 'SyntheticTable', ref: 'A1', headerRow: true, columns: ['订单号','批次号','试制计划图号','验货时间名称','入库时间','数量'].map(name => ({ name })), rows: [['ORDER-1/2','BATCH-2/2','DRAW-1/3','x:unchanged',new Date('2026-11-10T00:00:00Z'),'900719925474099312345.000000000000000000001']] });
  sheet.getCell('E2').numFmt = 'yyyy-mm-dd';
  const zip = await JSZip.loadAsync(Buffer.from(await original.xlsx.writeBuffer()));
  for (const part of Object.values(zip.files)) {
    if (part.dir || !/^xl\/(workbook|styles|sharedStrings|worksheets\/sheet\d+|tables\/table\d+)\.xml$/.test(part.name)) continue;
    if (prefixed) {
      let xml = await part.async('string');
      xml = xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');
      xml = xml.replace(/<(\/?)([A-Za-z_][A-Za-z0-9_]*)(?=[\s/>])/g, '<$1x:$2');
      zip.file(part.name, xml);
    }
  }
  const rel = 'xl/worksheets/_rels/sheet1.xml.rels';
  zip.file(rel, (await zip.file(rel)!.async('string')).replace('Target="../tables/table1.xml"', 'Target="/xl/tables/table1.xml"'));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  await expect(new ExcelJS.Workbook().xlsx.load(bytes as never)).rejects.toBeInstanceOf(TypeError);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const loaded = await loadReviewDueWorkbook(bytes, 'namespace-regression');
  expect(loaded.worksheets).toHaveLength(1);
  expect(loaded.worksheets[0].getRow(2).values).toEqual(sheet.getRow(2).values);
  expect(loaded.worksheets[0].getTable('SyntheticTable').name).toBe('SyntheticTable');
});
it('detects encrypted ZIP members even when the first member is plain', async () => {
  const zip = await JSZip.loadAsync(await valid());
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
  expect(central).toBeGreaterThan(0); bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await expect(loadReviewDueWorkbook(bytes, 'mixed-encryption')).rejects.toThrow(ENCRYPTED_SPREADSHEET_MESSAGE);
});
