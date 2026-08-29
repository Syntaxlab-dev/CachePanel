// Minimal CSV builder -- quotes a field only when it actually needs it
// (contains a comma, quote, or newline), matching RFC 4180 without pulling
// in a dependency for what's a handful of numeric/short-string columns.
function csvField(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\n");
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
