/** RFC 4180-ish CSV, quoted only when a value could otherwise be misread. */
export function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvRow(values: string[]): string {
  return values.map(csvCell).join(',');
}

/** A header row plus one row per item, CRLF-terminated. */
export function renderCsv(header: string[], rows: string[][]): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
