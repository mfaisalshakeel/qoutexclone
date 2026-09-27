import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskStorageProvider } from './storage.js';

describe('LocalDiskStorageProvider', () => {
  let root: string;
  let provider: LocalDiskStorageProvider;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'quantex-storage-test-'));
    provider = new LocalDiskStorageProvider(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('saves a file and reads the exact same bytes back by its ref', async () => {
    const original = Buffer.from('a real document, in bytes');
    const { ref, sizeBytes } = await provider.save('kyc', original, '.jpg');
    expect(sizeBytes).toBe(original.byteLength);
    expect(ref.startsWith('kyc/')).toBe(true);
    expect(ref.endsWith('.jpg')).toBe(true);

    const read = await provider.read(ref);
    expect(read).toEqual(original);
  });

  it('gives every save a different ref, even for the same bytes', async () => {
    const bytes = Buffer.from('identical content');
    const a = await provider.save('kyc', bytes, '.png');
    const b = await provider.save('kyc', bytes, '.png');
    expect(a.ref).not.toBe(b.ref);
  });

  it('returns null for a ref that was never saved', async () => {
    expect(await provider.read('kyc/does-not-exist.pdf')).toBeNull();
  });

  it('deletes a file so it can no longer be read', async () => {
    const { ref } = await provider.save('kyc', Buffer.from('gone soon'), '.pdf');
    expect(await provider.read(ref)).not.toBeNull();
    await provider.delete(ref);
    expect(await provider.read(ref)).toBeNull();
  });

  it('deleting a ref that never existed is not an error', async () => {
    await expect(provider.delete('kyc/never-existed.jpg')).resolves.toBeUndefined();
  });

  it('refuses to read or delete outside its own root, even given a path-traversal ref', async () => {
    const outside = path.join(os.tmpdir(), 'quantex-storage-outside-root.txt');
    await fs.writeFile(outside, 'not yours to read');
    try {
      await expect(provider.read('../quantex-storage-outside-root.txt')).rejects.toThrow(/refusing/);
      await expect(provider.delete('../quantex-storage-outside-root.txt')).rejects.toThrow(/refusing/);
      // the file outside root is untouched
      expect(await fs.readFile(outside, 'utf8')).toBe('not yours to read');
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it('keeps two namespaces from colliding', async () => {
    const kyc = await provider.save('kyc', Buffer.from('kyc doc'), '.jpg');
    const avatars = await provider.save('avatars', Buffer.from('avatar'), '.png');
    expect(kyc.ref.startsWith('kyc/')).toBe(true);
    expect(avatars.ref.startsWith('avatars/')).toBe(true);
    expect(await provider.read(kyc.ref)).toEqual(Buffer.from('kyc doc'));
    expect(await provider.read(avatars.ref)).toEqual(Buffer.from('avatar'));
  });
});
