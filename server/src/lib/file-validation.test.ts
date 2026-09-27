import { describe, expect, it } from 'vitest';
import { detectDocumentType } from './file-validation.js';

describe('detectDocumentType', () => {
  it('recognises a JPEG by its magic bytes', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(detectDocumentType(buffer)).toEqual({ mimeType: 'image/jpeg', extension: '.jpg' });
  });

  it('recognises a PNG by its magic bytes', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(detectDocumentType(buffer)).toEqual({ mimeType: 'image/png', extension: '.png' });
  });

  it('recognises a PDF by its magic bytes', () => {
    const buffer = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3', 'binary');
    expect(detectDocumentType(buffer)).toEqual({ mimeType: 'application/pdf', extension: '.pdf' });
  });

  it('refuses a file whose bytes do not match any allowed type, whatever it claims to be', () => {
    // an .exe renamed to look like a JPEG on the way in — the bytes say otherwise
    const buffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(() => detectDocumentType(buffer)).toThrow(/not a JPEG, PNG or PDF/);
  });

  it('refuses a truncated file too short to contain any signature', () => {
    expect(() => detectDocumentType(Buffer.from([0xff, 0xd8]))).toThrow();
  });

  it('refuses an empty buffer', () => {
    expect(() => detectDocumentType(Buffer.alloc(0))).toThrow();
  });
});
