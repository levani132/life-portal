import { Global, Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/configuration';

/** What a check says about a set of images: the categories it flagged, by the service's names. */
export interface ImageVerdict {
  flagged: string[];
  /** The service's score per category, 0 to 1: the highest across the images. Kept for tuning. */
  scores?: Record<string, number>;
}

/**
 * Checks images another person will see (spec 039). It is given short-lived read links, never
 * the files and never who they belong to. Throws `ImageCheckError` when the service refuses or
 * cannot be reached; the caller keeps the post hidden and tries again later.
 */
export interface ImageChecker {
  readonly provider: 'openai';
  check(urls: string[]): Promise<ImageVerdict>;
}

export const IMAGE_CHECKER = 'IMAGE_CHECKER';

export class ImageCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageCheckError';
  }
}

interface ModerationAnswer {
  results?: { categories?: Record<string, boolean>; category_scores?: Record<string, number> }[];
}

/**
 * OpenAI's moderation endpoint (`omni-moderation-latest`), which takes image links and is free
 * of charge. One request per image, because it accepts a single image per call. Errors carry the
 * status only, never a link or the key. It does not recognise known abuse images: see
 * docs/modules/moderation.md for what that leaves open.
 */
export class OpenAiImageChecker implements ImageChecker {
  readonly provider = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async check(urls: string[]): Promise<ImageVerdict> {
    const flagged = new Set<string>();
    const scores: Record<string, number> = {};
    for (const url of urls) {
      let response: Response;
      try {
        response = await this.fetchImpl('https://api.openai.com/v1/moderations', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url } }] }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new ImageCheckError('The image check could not be reached.');
      }
      if (!response.ok) throw new ImageCheckError(`The image check refused the request (HTTP ${response.status}).`);
      const answer = (await response.json().catch(() => null)) as ModerationAnswer | null;
      const categories = answer?.results?.[0]?.categories;
      if (!categories || typeof categories !== 'object') throw new ImageCheckError('The image check gave an answer that could not be read.');
      for (const [name, on] of Object.entries(categories)) if (on === true) flagged.add(name);
      for (const [name, score] of Object.entries(answer?.results?.[0]?.category_scores ?? {})) {
        if (typeof score === 'number' && Number.isFinite(score)) scores[name] = Math.max(scores[name] ?? 0, Math.round(score * 1000) / 1000);
      }
    }
    return { flagged: [...flagged].sort(), scores };
  }
}

/** Provides `IMAGE_CHECKER`: a checker, or `null` when none is configured. */
@Global()
@Module({
  providers: [
    {
      provide: IMAGE_CHECKER,
      inject: [CONFIG],
      useFactory: (config: AppConfig): ImageChecker | null =>
        config.imageCheck?.provider === 'openai' ? new OpenAiImageChecker(config.imageCheck.apiKey) : null,
    },
  ],
  exports: [IMAGE_CHECKER],
})
export class ImageCheckModule {}
