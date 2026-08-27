/** Formata Date como `AAAA-MM-DD HH:MM:SS` (hora local) — sem isto, `String(date)` usa
 * o formato verboso do JS (`Thu Aug 27 2026 09:55:09 GMT-0300 (Horário Padrão de
 * Brasília)`), que é exatamente o tipo de coisa que a Seção 18 pede para evitar
 * ("abrir corretamente em ferramentas comuns"). node-pg devolve colunas
 * timestamp/timestamptz como objetos Date, então qualquer relatório com data cai
 * nisso — corrigido uma vez aqui em vez de em cada query. */
function formatCsvValue(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  return value === null || value === undefined ? '' : String(value);
}

/** Serialização mínima de CSV — escapa vírgula/aspas/quebra de linha por RFC 4180. */
function escapeCsvField(value: unknown): string {
  const str = formatCsvValue(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
  const header = columns.map((c) => escapeCsvField(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCsvField(row[c.key])).join(','));
  // BOM UTF-8 no início: sem isso o Excel abre acentos quebrados (Ç, Ã, etc.) —
  // "codificação adequada" e "abrir corretamente em ferramentas comuns" (Seção 18).
  return '﻿' + [header, ...lines].join('\r\n');
}

export function sendCsv(res: import('express').Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
