import { badRequest } from './errors.js';

/**
 * What a KYC document may be. Deliberately small and hand-checked rather than
 * pulled in from a library: three formats, three fixed byte signatures, and a
 * client-supplied `mimetype`/filename is never trusted on its own — a renamed
 * `.exe` claiming to be a JPEG is refused by its actual bytes, not its label.
 */
const SIGNATURES: { mimeType: string; extension: string; magic: number[] }[] = [
  { mimeType: 'image/jpeg', extension: '.jpg', magic: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', extension: '.png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'application/pdf', extension: '.pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // "%PDF-"
];

function matchesSignature(buffer: Buffer, magic: number[]): boolean {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, i) => buffer[i] === byte);
}

export interface ValidatedFile {
  mimeType: string;
  extension: string;
}

/** Confirms a buffer really is one of the allowed document types, by its own bytes. */
export function detectDocumentType(buffer: Buffer): ValidatedFile {
  const match = SIGNATURES.find((sig) => matchesSignature(buffer, sig.magic));
  if (!match) {
    throw badRequest(
      'That file is not a JPEG, PNG or PDF — or is not really the type it claims to be.',
      'unsupported_file_type',
    );
  }
  return { mimeType: match.mimeType, extension: match.extension };
}
