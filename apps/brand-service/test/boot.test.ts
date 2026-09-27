import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';

describe('brand-service boot', () => {
  it('wires the DI graph and serves /health without a key, /v1 only with one', async () => {
    process.env.BRAND_SERVICE_API_KEYS = 'wiseos:k_boot_test';
    const { AppModule } = await import('../src/app.module');
    const app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    try {
      assert.equal((await fetch(`${base}/health`)).status, 200);
      const post = (key?: string) =>
        fetch(`${base}/v1/brand/monogram`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({ letters: 'BR', background: '#C8102E' }),
        });
      assert.equal((await post()).status, 401);
      const ok = await post('k_boot_test');
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).foreground, '#FFFFFF');
    } finally {
      await app.close();
    }
  });
});
