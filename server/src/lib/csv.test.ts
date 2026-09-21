import { describe, expect, it } from 'vitest';
import { csvCell, csvRow, renderCsv } from './csv.js';

describe('csvCell', () => {
  it('leaves a plain value bare', () => {
    expect(csvCell('hello')).toBe('hello');
  });

  it('quotes a value containing a comma', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('quotes a value containing a newline', () => {
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('quotes and doubles an embedded quote', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('renderCsv', () => {
  it('writes a header row and one row per item, CRLF-terminated', () => {
    const csv = renderCsv(['A', 'B'], [['1', '2'], ['3', '4']]);
    expect(csv).toBe('A,B\r\n1,2\r\n3,4\r\n');
  });

  it('produces only the header when there are no rows', () => {
    expect(renderCsv(['A'], [])).toBe('A\r\n');
  });

  it('escapes cells within a row via csvRow', () => {
    expect(csvRow(['a,b', 'plain'])).toBe('"a,b",plain');
  });
});
