/** Canonical occurrence-month ranges, including bookmarks from the former dashboard. */
export function readFinanceMonthlyPeriod(params: URLSearchParams): { from?: string; to?: string; error?: string } {
  let from: string | undefined, to: string | undefined;
  const valid = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && Number(v.slice(0,4)) >= 2025 && Number(v.slice(0,4)) <= 2100;
  const add = (start?: string | null, end?: string | null) => {
    if (start) { if (!valid(start)) throw new Error('发生年月无效'); from = from && from > start ? from : start; }
    if (end) { if (!valid(end)) throw new Error('发生年月无效'); to = to && to < end ? to : end; }
  };
  try {
    if (params.has('year')) {
      const year = params.get('year')!;
      if (!/^\d{4}$/.test(year)) throw new Error('发生年度无效');
      const month = params.get('month');
      if (month && (!/^\d{1,2}$/.test(month) || Number(month)<1 || Number(month)>12)) throw new Error('发生月份无效');
      add(`${year}-${month?month.padStart(2,'0'):'01'}`, `${year}-${month?month.padStart(2,'0'):'12'}`);
    }
    add(params.get('monthFrom'), params.get('monthTo'));
    for (const key of ['dateFrom','dateTo']) if (params.has(key)) {
      const date = params.get(key)!;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new Error('发生月份范围无效');
      add(key==='dateFrom'?date.slice(0,7):undefined, key==='dateTo'?date.slice(0,7):undefined);
    }
    if (from && to && from > to) throw new Error('发生月份范围无效');
    return {from,to};
  } catch (error) { return {error:(error as Error).message}; }
}
