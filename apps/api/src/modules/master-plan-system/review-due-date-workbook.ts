import { BadRequestException, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { assertSpreadsheetNotEncrypted, ENCRYPTED_SPREADSHEET_MESSAGE } from '../../spreadsheet-upload';

export const REVIEW_DUE_CORRUPT_XLSX = 'Excel文件结构不完整或损坏，请检查文件后重新导入。';
export const REVIEW_DUE_UNSUPPORTED_XLSX = '当前Excel结构与导入解析器不兼容，请使用Excel另存为标准.xlsx后重新预览；原文件未被修改。';


const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
class UnsupportedNamespace extends Error {}
/**
 * ExcelJS 4.4 compares raw qualified names (workbook/sheets/c), ignoring legal namespace aliases.
 * Rewrite only qualified ELEMENT names in the spreadsheet namespace, in memory. SAX provides the
 * actual namespace identity and positions: no regex replacement of cell text or prefixes
 * from other namespaces. Business text/attributes stay byte-identical; only internal table Target
 * attributes may change to equivalent relative package references.
 */
export function canonicalReviewDueXml(xml: string, partName = '') {
  const parser = new SaxesParser({ xmlns: true });
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const defaults: string[] = [];
  let start = 0;
  let targetSpan: { start: number; end: number } | undefined;
  const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  parser.on('doctype', () => { throw new UnsupportedNamespace('DTD is not supported'); });
  parser.on('opentagstart', tag => {
    targetSpan = undefined;
    start = parser.position - tag.name.length - 1;
    if (xml.slice(start, start + tag.name.length) !== tag.name || xml[start - 1] !== '<') throw new UnsupportedNamespace('Unexpected XML token positions');
  });
  parser.on('attribute', attr => {
    if (attr.name === 'Target') {
      const end = parser.position - 1;
      const begin = end - attr.value.length;
      if (xml.slice(begin, end) === attr.value) targetSpan = { start: begin, end };
    }
  });
  parser.on('opentag', tag => {
    // ExcelJS indexes tables by ../tables/tableN.xml, but OPC also permits absolute package URIs.
    // Rewrite only an internal table relationship, preserving its resolved package destination.
    if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(partName)
      && tag.uri === 'http://schemas.openxmlformats.org/package/2006/relationships' && tag.local === 'Relationship'
      && tag.attributes.Type?.value === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table'
      && tag.attributes.TargetMode?.value !== 'External'
      && /^\/xl\/tables\/table\d+\.xml$/.test(tag.attributes.Target?.value ?? '')) {
      if (!targetSpan) throw new UnsupportedNamespace('Unsupported table relationship encoding');
      edits.push({ ...targetSpan, value: tag.attributes.Target.value.replace('/xl/', '../') });
    }
    const rewrite = tag.uri === spreadsheetNamespace && !!tag.prefix;
    const declaration = tag.attributes.xmlns?.value;
    let current = declaration ?? defaults.at(-1) ?? '';
    if (rewrite) edits.push({ start, end: start + tag.prefix.length + 1, value: '' });
    if ((rewrite || !tag.prefix) && current !== tag.uri) {
      // Do not change the meaning of an existing local default namespace declaration.
      if (declaration !== undefined) throw new UnsupportedNamespace('Conflicting local default namespace');
      edits.push({ start: start + tag.name.length, end: start + tag.name.length, value: ` xmlns="${attribute(tag.uri)}"` });
      current = tag.uri;
    }
    defaults.push(current);
  });
  parser.on('closetag', tag => {
    defaults.pop();
    if (!tag.isSelfClosing && tag.uri === spreadsheetNamespace && tag.prefix) {
      const offset = xml.lastIndexOf('</', parser.position - 1) + 2;
      if (xml.slice(offset, offset + tag.name.length) !== tag.name) throw new UnsupportedNamespace('Unexpected XML closing token');
      edits.push({ start: offset, end: offset + tag.prefix.length + 1, value: '' });
    }
  });
  parser.write(xml).close();
  if (!edits.length) return null;
  let cursor = 0;
  const chunks: string[] = [];
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    chunks.push(xml.slice(cursor, edit.start), edit.value); cursor = edit.end;
  }
  chunks.push(xml.slice(cursor));
  return chunks.join('');
}

const logger = new Logger('ReviewDueDateWorkbook');
/** Keep genuine error types and call frames, excluding exception messages which may contain XML/cell data. */
function diagnose(error: unknown, requestId: string, phase: string) {
  const exception = error instanceof Error ? error : new Error('NonError rejection');
  logger.error({
    event: 'review_due_excel_parse_failed', phase,
    requestId: requestId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128),
    errorType: /^[a-zA-Z0-9_]+$/.test(exception.name) ? exception.name : 'Error',
    stack: exception.stack?.split('\n').filter(line => /^\s+at /.test(line)).join('\n') ?? ''
  });
}

/** Resource-specific strict reader. Other business import adapters retain their existing behavior. */
export async function loadReviewDueWorkbook(buffer: Buffer, requestId: string) {
  assertSpreadsheetNotEncrypted(buffer);
  let archive: JSZip;
  try {
    // ExcelJS does not enable ZIP CRC validation itself. Do not accept damaged packages as compatible files.
    archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch (error) {
    diagnose(error, requestId, 'ZIP');
    if (error instanceof Error && error.message === 'Encrypted zip are not supported') throw new BadRequestException(ENCRYPTED_SPREADSHEET_MESSAGE);
    throw new BadRequestException(REVIEW_DUE_CORRUPT_XLSX);
  }
  if (!archive.file('[Content_Types].xml') || !archive.file('_rels/.rels') || !archive.file('xl/workbook.xml')) {
    // ExcelJS supports this canonical workbook location; a relocated workbook is a compatibility issue.
    const relocated = Object.keys(archive.files).some(name => /(?:^|\/)workbook\.xml$/.test(name));
    diagnose(new Error('Missing XLSX package part'), requestId, 'PACKAGE');
    throw new BadRequestException(relocated && !archive.file('xl/workbook.xml') ? REVIEW_DUE_UNSUPPORTED_XLSX : REVIEW_DUE_CORRUPT_XLSX);
  }
  let adapted = false;
  try {
    // Validate every XML part, including those ExcelJS would otherwise silently ignore.
    for (const part of Object.values(archive.files)) {
      if (part.dir || !/\.(xml|rels)$/.test(part.name)) continue;
      const normalized = canonicalReviewDueXml(await part.async('string'), part.name);
      if (normalized !== null) { archive.file(part.name, normalized); adapted = true; }
    }
  } catch (error) {
    diagnose(error, requestId, 'XML');
    throw new BadRequestException(error instanceof UnsupportedNamespace ? REVIEW_DUE_UNSUPPORTED_XLSX : REVIEW_DUE_CORRUPT_XLSX);
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
    return workbook;
  } catch (error) {
    diagnose(error, requestId, 'EXCELJS');
    if (!adapted) throw new BadRequestException(REVIEW_DUE_UNSUPPORTED_XLSX);
  }
  // Retry only an equivalent, validated namespace representation. Never drop worksheets or data.
  try {
    const canonical = await archive.generateAsync({ type: 'nodebuffer' });
    const compatible = new ExcelJS.Workbook();
    await compatible.xlsx.load(canonical as never);
    return compatible;
  } catch (error) {
    diagnose(error, requestId, 'EXCELJS_NAMESPACE_COMPATIBILITY');
    throw new BadRequestException(REVIEW_DUE_UNSUPPORTED_XLSX);
  }
}
