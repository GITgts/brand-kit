import type { BrandExtractionOptions } from '@wisemen/nestjs-brand-extraction';

export function brandOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): BrandExtractionOptions {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    visionModel: env.BRAND_VISION_MODEL,
    monogramFontPath: env.BRAND_MONOGRAM_FONT_PATH,
    chromiumExecutablePath: env.CHROMIUM_EXECUTABLE_PATH,
    maxConcurrentRenders: env.BRAND_MAX_CONCURRENT_RENDERS ? Number(env.BRAND_MAX_CONCURRENT_RENDERS) : undefined,
    totalTimeoutMs: env.BRAND_TOTAL_TIMEOUT_MS ? Number(env.BRAND_TOTAL_TIMEOUT_MS) : undefined,
    cacheTtlMs: env.BRAND_CACHE_TTL_MS ? Number(env.BRAND_CACHE_TTL_MS) : undefined,
    allowPrivateNetwork: env.BRAND_ALLOW_PRIVATE_NETWORK === 'true',
  };
}

export const rateLimitPerMinute = () => Number(process.env.BRAND_RATE_LIMIT_PER_MIN ?? 60);
