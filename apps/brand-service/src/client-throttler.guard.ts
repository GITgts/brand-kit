import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Rate limit per consuming app (set by ApiKeyGuard), not per IP. */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.brandClient ?? req.ip ?? 'unknown';
  }
}
