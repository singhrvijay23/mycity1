import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * File storage with two drivers:
 * - local (default, development): files on disk under UPLOAD_DIR, served by the API through HMAC-signed links.
 * - s3 (production): any S3-compatible bucket (AWS S3, DigitalOcean Spaces, Cloudflare R2, MinIO).
 *   The bucket stays private; clients get short-lived presigned GET URLs.
 * Either way, a link is only handed out after the API has checked the viewer may see the photo.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  url(key: string, attachmentId: string): Promise<string>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const LINK_TTL_SECONDS = 60 * 60; // 1 hour
const secret = () => process.env.FILE_SIGNING_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me';
const publicBase = () => process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;

export function signFileLink(id: string, exp: number) {
  return createHmac('sha256', secret()).update(`${id}.${exp}`).digest('base64url');
}
export function verifyFileLink(id: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const want = Buffer.from(signFileLink(id, exp));
  const got = Buffer.from(sig ?? '');
  return want.length === got.length && timingSafeEqual(want, got);
}

class LocalStorage implements Storage {
  root = resolve(process.env.UPLOAD_DIR ?? 'uploads');
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error('bad key');
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async url(_key: string, id: string) {
    // Round expiry to the hour so the same photo keeps the same URL for a while (browser caching).
    const exp = Math.ceil(Date.now() / 1000 / LINK_TTL_SECONDS) * LINK_TTL_SECONDS + LINK_TTL_SECONDS;
    return `${publicBase()}/files/${id}?exp=${exp}&sig=${signFileLink(id, exp)}`;
  }
  read(key: string) { return readFile(this.path(key)); }
  async remove(key: string) { await unlink(this.path(key)).catch(() => {}); }
}

class S3Storage implements Storage {
  bucket = process.env.S3_BUCKET!;
  client = new S3Client({
    region: process.env.S3_REGION ?? 'ap-south-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
  });
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=86400' }));
  }
  url(key: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: LINK_TTL_SECONDS });
  }
  async read(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async remove(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
}

let instance: Storage | null = null;
export function storage(): Storage {
  instance ??= process.env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
  return instance;
}
