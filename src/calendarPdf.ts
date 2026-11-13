const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const restricted = /\b(feriados?|recesso|ponto facultativo|nao letiv[oa]s?|sem aulas?|suspensao das aulas|carnaval)\b/;
const datePattern = /\b(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}))?\b/g;

export function suggestDates(lines: string[], year: number) {
  const rows = new Map<string, { date: string; period: number; reason: string }>();
  let month = 0;
  function dateFor(day: number, month: number) {
    const iso = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const parsed = new Date(iso + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : '';
  }

  for (const line of lines) {
    const text = normalize(line);
    const heading = months.findIndex(name => text.startsWith(name + ' ') || text === name);
    if (heading >= 0) month = heading + 1;
    if (!restricted.test(text)) continue;
    const reason = line.trim().slice(0, 200);
    let dates: string[] = [];
    const explicit = [...text.matchAll(datePattern)];
    if (explicit.length) {
      if (explicit.some(match => match[3] && Number(match[3]) !== year)) continue;
      dates = explicit.map(match => dateFor(Number(match[1]), Number(match[2])));
    } else {
      const written = text.match(new RegExp('\\b(\\d{1,2})\\s+de\\s+(' + months.join('|') + ')\\b'));
      const days = text.match(/^\s*(\d{1,2})(?:\s*(a|ate|e|–|-)\s*(\d{1,2}))?\s+/);
      if (written) dates = [dateFor(Number(written[1]), months.indexOf(written[2]) + 1)];
      else if (days && month) {
        const first = Number(days[1]);
        const last = Number(days[3] ?? first);
        if (dateFor(first, month) && dateFor(last, month) && last >= first) {
          const numbers = days[2] === 'e' ? [first, last] : Array.from({ length: last - first + 1 }, (_, i) => first + i);
          dates = numbers.map(day => dateFor(day, month));
        }
      }
    }
    if (dates.some(date => !date)) continue;
    for (const date of dates) if (!rows.has(date)) rows.set(date, { date, period: 0, reason });
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function readCalendarPdf(buffer: ArrayBuffer, year: number) {
  const [{ getDocument, GlobalWorkerOptions }, { default: workerSrc }] = await Promise.all([
    import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = workerSrc;
  const task = getDocument({ data: buffer });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 40) throw new Error('Importe um PDF de até 40 páginas.');
    const lines: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const byHeight = new Map<number, { x: number; text: string }[]>();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] / 3);
        const row = byHeight.get(y) ?? [];
        row.push({ x: item.transform[4], text: item.str });
        byHeight.set(y, row);
      }
      for (const [, row] of [...byHeight].sort((a, b) => b[0] - a[0])) {
        lines.push(row.sort((a, b) => a.x - b.x).map(item => item.text).join(' '));
      }
    }
    return suggestDates(lines, year);
  } finally {
    await task.destroy();
  }
}


