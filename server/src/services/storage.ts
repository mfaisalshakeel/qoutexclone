import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';

export interface StoredFile {
  /** Opaque reference saved on the owning row (`KycSubmission.documentRef`,
   *  and later a user's avatar) — a random id, never a client-suppliable path,
   *  so nothing about it lets a request walk the directory or guess another
   *  trader's file. */
  ref: string;
  sizeBytes: number;
}

/**
 * Everything the platform needs from a file store. Swapping the local-disk
 * default for a real object store (S3, GCS, R2…) means implementing this
 * interface and exporting it as `storage` — the same shape `custody.ts` uses
 * for swapping a wallet back end, and for the same reason: no real account
 * exists to configure yet, so a deploy that has one implements this rather
 * than the platform guessing at credentials it was never given.
 */
export interface StorageProvider {
  readonly name: string;
  /** Saves a file under a namespace ("kyc", later "avatars") and returns its ref. */
  save(namespace: string, buffer: Buffer, extension: string): Promise<StoredFile>;
  /** Reads a file back by ref, or null if it does not exist. */
  read(ref: string): Promise<Buffer | null>;
  delete(ref: string): Promise<void>;
}

/**
 * Local-disk provider used for development and for a deployment with no
 * object-storage account yet. Files live outside the web root, never served
 * directly by a static route — every read goes through an authorised route
 * that checks who is asking before it ever touches the filesystem.
 */
export class LocalDiskStorageProvider implements StorageProvider {
  readonly name = 'local-disk';

  constructor(private root: string) {}

  /** `ref` only ever comes from `save()` below, but this still refuses to
   *  resolve outside `root` — the same defence the prerendered-snapshot
   *  lookup in `app.ts` uses, for the same reason: a path built from a stored
   *  value is one bad row or one future caller away from being attacker input. */
  private pathFor(ref: string): string {
    const resolved = path.resolve(this.root, ref);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`refusing to resolve storage ref outside its root: ${ref}`);
    }
    return resolved;
  }

  async save(namespace: string, buffer: Buffer, extension: string): Promise<StoredFile> {
    const dir = path.join(this.root, namespace);
    await fs.mkdir(dir, { recursive: true });
    const id = crypto.randomBytes(24).toString('base64url');
    const ref = `${namespace}/${id}${extension}`;
    await fs.writeFile(this.pathFor(ref), buffer, { mode: 0o600 });
    return { ref, sizeBytes: buffer.byteLength };
  }

  async read(ref: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.pathFor(ref));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(ref: string): Promise<void> {
    await fs.rm(this.pathFor(ref), { force: true });
  }
}

export const storage: StorageProvider = new LocalDiskStorageProvider(env.storageDir);
