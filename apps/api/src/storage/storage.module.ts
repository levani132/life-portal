import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { AwsClient } from 'aws4fetch';
import { CONFIG, type AppConfig } from '../config/configuration';

/** How long an upload link works. The browser starts the upload straight away. */
const UPLOAD_SECONDS = 15 * 60;
/** Read links live 1–2 hours: signed at the start of the hour, valid for two. */
const READ_SECONDS = 2 * 60 * 60;

export interface StoredObject {
  bytes: number;
  contentType: string;
}

/**
 * Private object storage (Cloudflare R2, S3 API). Files never pass through the API: the browser
 * uploads with a signed PUT and reads with a signed GET. Nothing here is public.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private readonly client?: AwsClient;
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    const storage = config.storage;
    if (storage)
      this.client = new AwsClient({
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        service: 's3',
        region: 'auto',
      });
  }
  get configured(): boolean {
    return !!this.client;
  }
  private url(key: string): string {
    const { endpoint, bucket } = this.config.storage!;
    return `${endpoint}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  private require(): AwsClient {
    if (!this.client) throw new Error('Object storage is not configured.');
    return this.client;
  }
  /**
   * A link that accepts exactly one PUT of this type and size. Both are signed, so storage
   * itself refuses anything else; the size is checked again when the upload is attached.
   */
  async presignPut(
    key: string,
    contentType: string,
    bytes: number,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const url = new URL(this.url(key));
    url.searchParams.set('X-Amz-Expires', String(UPLOAD_SECONDS));
    const signed = await this.require().sign(url.toString(), {
      method: 'PUT',
      headers: { 'content-type': contentType, 'content-length': String(bytes) },
      aws: { signQuery: true, allHeaders: true },
    });
    // The browser sets Content-Length itself and refuses to be told it.
    return { url: signed.url, headers: { 'content-type': contentType } };
  }
  /**
   * A read link. Signed with the time floored to the hour, so the same object gives the same
   * URL for an hour and the browser's cache keeps working across feed refreshes.
   */
  async presignGet(key: string, now = new Date()): Promise<string> {
    const hour = new Date(now);
    hour.setUTCMinutes(0, 0, 0);
    const url = new URL(this.url(key));
    url.searchParams.set('X-Amz-Expires', String(READ_SECONDS));
    const signed = await this.require().sign(url.toString(), {
      method: 'GET',
      aws: {
        signQuery: true,
        datetime: hour.toISOString().replace(/[:-]|\.\d{3}/g, ''),
      },
    });
    return signed.url;
  }
  /** The stored object's size and type, or null when it does not exist. */
  async head(key: string): Promise<StoredObject | null> {
    const response = await this.require().fetch(this.url(key), { method: 'HEAD' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Storage HEAD failed with ${response.status}.`);
    return {
      bytes: Number(response.headers.get('content-length') ?? -1),
      contentType: response.headers.get('content-type') ?? '',
    };
  }
  /** Copies an object inside the bucket (S3 CopyObject); nothing passes through the API. */
  async copy(from: string, to: string): Promise<void> {
    const { bucket } = this.config.storage!;
    const response = await this.require().fetch(this.url(to), {
      method: 'PUT',
      headers: {
        'x-amz-copy-source': `/${bucket}/${from.split('/').map(encodeURIComponent).join('/')}`,
      },
    });
    if (!response.ok) throw new Error(`Storage copy failed with ${response.status}.`);
  }
  /** Deletes an object. A missing one counts as deleted. Never throws. */
  async delete(key: string): Promise<boolean> {
    try {
      const response = await this.require().fetch(this.url(key), { method: 'DELETE' });
      if (response.ok || response.status === 404) return true;
      this.log.warn(`Storage DELETE failed with ${response.status}.`);
    } catch (error) {
      this.log.warn(`Storage DELETE failed: ${(error as Error).message}`);
    }
    return false;
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
