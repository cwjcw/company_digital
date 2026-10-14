import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
/** ExcelJS 4.4/Archiver 5 buffer entries can compress to empty XML with the current stream dependencies.
 * Adapt only this writer instance to real streams, including the constructor's first theme/relationship entries.
 * This keeps compressed large exports valid without building millions of cells in memory. */
type Archive={append:(data:unknown,options:Record<string,unknown>)=>unknown};
const NativeWriter=ExcelJS.stream.xlsx.WorkbookWriter as unknown as new(options:Partial<ExcelJS.stream.xlsx.WorkbookWriterOptions>)=>ExcelJS.stream.xlsx.WorkbookWriter&{zip:Archive;addThemes():Promise<void>};
export class PlatformStreamingWorkbook extends NativeWriter {
 override addThemes(){
  const append=this.zip.append.bind(this.zip);
  this.zip.append=(data,options)=>append(typeof data==='string'||Buffer.isBuffer(data)?Readable.from([typeof data==='string'?Buffer.from(data):data]):data,options);
  return super.addThemes();
 }
}
