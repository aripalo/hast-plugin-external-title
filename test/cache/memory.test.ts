import { describe, it, expect } from 'vitest';
import { memoryCache } from '../../src/cache/memory.js';
import type { CacheEntry } from '../../src/types.js';

const sampleEntry: CacheEntry = {
  title: 'Hello',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('memoryCache', () => {
  it('returns undefined for unknown keys', async () => {
    const cache = memoryCache();
    expect(await cache.get('https://nope.example.com')).toBeUndefined();
  });

  it('stores and retrieves entries', async () => {
    const cache = memoryCache();
    await cache.set('https://x.example.com', sampleEntry);
    expect(await cache.get('https://x.example.com')).toEqual(sampleEntry);
  });

  it('overwrites existing entries', async () => {
    const cache = memoryCache();
    await cache.set('https://x.example.com', sampleEntry);
    const updated: CacheEntry = { title: 'Updated', updatedAt: '2026-02-01T00:00:00.000Z' };
    await cache.set('https://x.example.com', updated);
    expect(await cache.get('https://x.example.com')).toEqual(updated);
  });

  it('deletes entries', async () => {
    const cache = memoryCache();
    await cache.set('https://x.example.com', sampleEntry);
    await cache.delete!('https://x.example.com');
    expect(await cache.get('https://x.example.com')).toBeUndefined();
  });

  it('isolates instances', async () => {
    const a = memoryCache();
    const b = memoryCache();

    await a.set('https://shared.example.com', sampleEntry);

    expect(await a.get('https://shared.example.com')).toEqual(sampleEntry);
    expect(await b.get('https://shared.example.com')).toBeUndefined();
  });

  it('stores entries with null titles (failure marker)', async () => {
    const cache = memoryCache();
    const failure: CacheEntry = { title: null, updatedAt: '2026-01-01T00:00:00.000Z' };
    await cache.set('https://failed.example.com', failure);
    expect(await cache.get('https://failed.example.com')).toEqual(failure);
  });
});
