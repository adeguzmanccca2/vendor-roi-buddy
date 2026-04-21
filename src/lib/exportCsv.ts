/** Convert array of objects to CSV and trigger download. */
export function downloadCsv(filename: string, rows: Record<string, any>[], headers?: string[]) {
  if (rows.length === 0) {
    // still emit header row if provided
    const csv = (headers ?? []).join(',');
    triggerDownload(filename, csv);
    return;
  }
  const cols = headers ?? Object.keys(rows[0]);
  const escape = (v: any): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => escape(r[c])).join(','));
  triggerDownload(filename, lines.join('\n'));
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
