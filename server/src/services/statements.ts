import PDFDocument from 'pdfkit';
import type { Transaction } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest } from '../lib/errors.js';
import { renderCsv } from '../lib/csv.js';
import { settings } from './settings.js';

/**
 * Downloadable account statements.
 *
 * Real money only — practice and tournament balances never mix with it, and
 * neither do they belong on a document a trader might use for their own
 * records. The source is the same `Transaction` ledger `applyLedger` writes,
 * so a statement can never show a number the ledger itself does not agree
 * with.
 */

export interface StatementRange {
  from?: Date;
  to?: Date;
}

// A hard ceiling so a trader with years of history (or an unbounded range)
// cannot ask for a file that never finishes rendering.
const MAX_ROWS = 5_000;

export async function statementRows(userId: string, range: StatementRange): Promise<Transaction[]> {
  if (range.from && range.to && range.from > range.to) {
    throw badRequest('The start date must be before the end date', 'invalid_range');
  }
  return prisma.transaction.findMany({
    where: {
      userId,
      accountType: 'REAL',
      createdAt: {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      },
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_ROWS,
  });
}

function typeLabel(type: string): string {
  const words = type.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function renderStatementCsv(rows: Transaction[]): string {
  return renderCsv(
    ['Date (UTC)', 'Type', 'Note', 'Amount (USD)', 'Balance after (USD)'],
    rows.map((row) => [
      row.createdAt.toISOString(),
      typeLabel(row.type),
      row.note ?? '',
      (row.amount / 100).toFixed(2),
      (row.balanceAfter / 100).toFixed(2),
    ]),
  );
}

function formatRangeLabel(range: StatementRange): string {
  if (!range.from && !range.to) return 'All time';
  const from = range.from ? range.from.toISOString().slice(0, 10) : 'the beginning';
  const to = range.to ? range.to.toISOString().slice(0, 10) : 'today';
  return `${from} to ${to}`;
}

const COLUMNS = [
  { key: 'date', label: 'Date (UTC)', x: 40, width: 90 },
  { key: 'type', label: 'Type', x: 130, width: 100 },
  { key: 'note', label: 'Note', x: 230, width: 170 },
  { key: 'amount', label: 'Amount', x: 400, width: 70 },
  { key: 'balance', label: 'Balance', x: 470, width: 85 },
] as const;

export function renderStatementPdf(
  rows: Transaction[],
  meta: { email: string; range: StatementRange },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const site = settings.get('general.siteName');
    const bottom = doc.page.height - doc.page.margins.bottom;

    const drawTableHeader = () => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
      const headerY = doc.y;
      for (const col of COLUMNS) doc.text(col.label, col.x, headerY, { width: col.width, lineBreak: false });
      doc.y = headerY;
      doc.moveDown(1);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.3);
      doc.font('Helvetica').fillColor('#111');
    };

    doc.font('Helvetica-Bold').fontSize(18).text(`${site} — Account statement`);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#555');
    doc.text(meta.email);
    doc.text(`Period: ${formatRangeLabel(meta.range)}`);
    doc.text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown(1);

    if (rows.length === 0) {
      doc.fillColor('#111').fontSize(11).text('No transactions in this period.');
    } else {
      drawTableHeader();
      for (const row of rows) {
        if (doc.y + 14 > bottom) {
          doc.addPage();
          drawTableHeader();
        }
        const y = doc.y;
        doc.fontSize(8).fillColor('#111');
        doc.text(row.createdAt.toISOString().slice(0, 16).replace('T', ' '), COLUMNS[0].x, y, {
          width: COLUMNS[0].width,
          lineBreak: false,
        });
        doc.text(typeLabel(row.type), COLUMNS[1].x, y, { width: COLUMNS[1].width, lineBreak: false });
        doc.text(row.note ?? '—', COLUMNS[2].x, y, {
          width: COLUMNS[2].width,
          lineBreak: false,
          ellipsis: true,
        });
        doc.fillColor(row.amount >= 0 ? '#0a7d3c' : '#b91c1c');
        doc.text(
          `${row.amount >= 0 ? '+' : '-'}$${(Math.abs(row.amount) / 100).toFixed(2)}`,
          COLUMNS[3].x,
          y,
          {
            width: COLUMNS[3].width,
            lineBreak: false,
          },
        );
        doc.fillColor('#111');
        doc.text(`$${(row.balanceAfter / 100).toFixed(2)}`, COLUMNS[4].x, y, {
          width: COLUMNS[4].width,
          lineBreak: false,
        });
        doc.moveDown(1);
      }
    }

    doc.fontSize(7).fillColor('#888');
    doc.text('Trading carries risk and you can lose the money you put in.', 40, bottom - 10, {
      width: 515,
    });

    doc.end();
  });
}
