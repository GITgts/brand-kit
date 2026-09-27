import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';

export const PUBLIC_ROUTE = 'brand:public';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  /** Name of the consuming application, e.g. "wiseos". */
  brandClient?: string;
}

/**
 * Service-to-service auth. Each consuming app gets its own key:
 *   BRAND_SERVICE_API_KEYS="wiseos:k_live_…,taxi-hendriks:k_live_…"
 * Sent as `Authorization: Bearer <key>` (or `x-api-key`). Rotating one app's
 * key never affects the others, and logs/rate limits are per app.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly keys: { client: string; key: Buffer }[];

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {
    this.keys = (process.env.BRAND_SERVICE_API_KEYS ?? '')
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const i = pair.indexOf(':');
        if (i <= 0) throw new Error('BRAND_SERVICE_API_KEYS entries must look like "client:key"');
        return { client: pair.slice(0, i), key: Buffer.from(pair.slice(i + 1)) };
      });
    if (this.keys.length === 0) throw new Error('BRAND_SERVICE_API_KEYS is empty; refusing to start without auth');
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const presented = extractKey(req.headers);
    if (!presented) throw new UnauthorizedException('Missing API key');
    const buf = Buffer.from(presented);
    const match = this.keys.find((k) => k.key.length === buf.length && timingSafeEqual(k.key, buf));
    if (!match) throw new UnauthorizedException('Invalid API key');
    req.brandClient = match.client;
    return true;
  }
}

function extractKey(headers: AuthedRequest['headers']): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const x = headers['x-api-key'];
  return typeof x === 'string' ? x.trim() : null;
}
