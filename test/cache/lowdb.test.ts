import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockWrite, mockData, mockJSONFilePreset } = vi.hoisted(() => ({
  mockWrite: vi.fn().mockResolvedValue(undefined),
  mockData: {} as Record<string, unknown>,
  mockJSONFilePreset: vi.fn(),
}));

vi.mock('lowdb/node', () => ({
  JSONFilePreset: mockJSONFilePreset,
}));

mockJSONFilePreset.mockResolvedValue({ data: mockData, write: mockWrite });

import { lowdbCache, DEFAULT_LOWDB_PATH } from '../../src/cache/lowdb.js';
import type { CacheEntry } from '../../src/types.js';

beforeEach(() => {
  Object.keys(mockData).forEach((key) => delete mockData[key]);
  mockWrite.mockClear();
  mockJSONFilePreset.mockClear();
  mockJSONFilePreset.mockResolvedValue({ data: mockData, write: mockWrite });
});

describe('DEFAULT_LOWDB_PATH', () => {
  it('is db.titles.json', () => {
    expect(DEFAULT_LOWDB_PATH).toBe('db.titles.json');
  });
});

describe('lowdbCache', () => {
  it('uses the default path when none provided', async () => {
    const cache = lowdbCache();
    await cache.get('https://x.example.com');
    expect(mockJSONFilePreset).toHaveBeenCalledWith(DEFAULT_LOWDB_PATH, {});
  });

  it('uses a custom path when provided', async () => {
    const cache = lowdbCache({ path: '/tmp/custom.json' });
    await cache.get('https://x.example.com');
    expect(mockJSONFilePreset).toHaveBeenCalledWith('/tmp/custom.json', {});
  });

  it('does not open the file at construction time', () => {
    lowdbCache({ path: '/tmp/lazy.json' });
    expect(mockJSONFilePreset).not.toHaveBeenCalled();
  });

  it('opens the file once and reuses it across calls', async () => {
    const cache = lowdbCache({ path: '/tmp/once.json' });
    await cache.get('a');
    await cache.set('b', { title: 't', updatedAt: '2026-01-01T00:00:00.000Z' });
    await cache.get('c');
    expect(mockJSONFilePreset).toHaveBeenCalledTimes(1);
  });

  describe('get', () => {
    it('returns undefined for unknown URLs', async () => {
      const cache = lowdbCache();
      expect(await cache.get('https://nope.example.com')).toBeUndefined();
    });

    it('returns the stored entry verbatim', async () => {
      const entry: CacheEntry = { title: 'T', updatedAt: '2026-01-01T00:00:00.000Z' };
      mockData['https://x.example.com'] = entry;

      const cache = lowdbCache();
      expect(await cache.get('https://x.example.com')).toEqual(entry);
    });

    it('does not perform staleness checks (delegated to plugin)', async () => {
      const ancient: CacheEntry = {
        title: null,
        updatedAt: '1970-01-01T00:00:00.000Z',
      };
      mockData['https://old.example.com'] = ancient;

      const cache = lowdbCache();
      expect(await cache.get('https://old.example.com')).toEqual(ancient);
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('stores success entries', async () => {
      const cache = lowdbCache();
      const entry: CacheEntry = { title: 'Hello', updatedAt: '2026-01-01T00:00:00.000Z' };
      await cache.set('https://x.example.com', entry);

      expect(mockData['https://x.example.com']).toEqual(entry);
      expect(mockWrite).toHaveBeenCalledTimes(1);
    });

    it('stores failure entries (title: null)', async () => {
      const cache = lowdbCache();
      const entry: CacheEntry = { title: null, updatedAt: '2026-01-01T00:00:00.000Z' };
      await cache.set('https://x.example.com', entry);

      expect(mockData['https://x.example.com']).toEqual(entry);
    });

    it('overwrites existing entries', async () => {
      mockData['https://x.example.com'] = {
        title: 'Old',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const cache = lowdbCache();
      const entry: CacheEntry = { title: 'New', updatedAt: '2026-01-01T00:00:00.000Z' };
      await cache.set('https://x.example.com', entry);

      expect(mockData['https://x.example.com']).toEqual(entry);
    });

    it('writes after each set', async () => {
      const cache = lowdbCache();
      await cache.set('a', { title: 'A', updatedAt: '2026-01-01T00:00:00.000Z' });
      await cache.set('b', { title: 'B', updatedAt: '2026-01-01T00:00:00.000Z' });
      expect(mockWrite).toHaveBeenCalledTimes(2);
    });
  });

  describe('delete', () => {
    it('removes an existing entry and writes', async () => {
      mockData['https://x.example.com'] = {
        title: 'T',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const cache = lowdbCache();
      await cache.delete!('https://x.example.com');

      expect(mockData['https://x.example.com']).toBeUndefined();
      expect(mockWrite).toHaveBeenCalledTimes(1);
    });

    it('is a no-op write when the key is unknown', async () => {
      const cache = lowdbCache();
      await cache.delete!('https://nope.example.com');
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });
});
