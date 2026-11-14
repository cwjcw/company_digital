const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

function shanghaiDate(value: Date): string {
  const parts = shanghaiDateFormatter.formatToParts(value);
  const part = (type: string) => parts.find(entry => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatRdBomDate(value: unknown): string {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  const localCalendarValue = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$)/);
  if (localCalendarValue) return localCalendarValue[1] ?? raw;
  const instant = new Date(raw);
  return Number.isNaN(instant.getTime()) ? raw : shanghaiDate(instant);
}
