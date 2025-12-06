import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock variables so they're available when vi.mock runs
const { mockWrite, mockData } = vi.hoisted(() => ({
  mockWrite: vi.fn().mockResolvedValue(undefined),
  mockData: {} as Record<string, unknown>,
}));

// Mock lowdb before importing database module
vi.mock('lowdb/node', () => ({
  JSONFilePreset: vi.fn().mockResolvedValue({
    data: mockData,
    write: mockWrite,
  }),
}));

import {
  isErrorEntry,
  isSuccessEntry,
  urlToKey,
  isStaleErrorEntry,
  createSuccessEntry,
  createErrorEntry,
  STALE_ERROR_THRESHOLD_HOURS,
  getTitle,
  setTitle,
  type Entry,
  type EntryError,
} from './database';

describe('STALE_ERROR_THRESHOLD_HOURS', () => {
  it('should be 24 hours', () => {
    expect(STALE_ERROR_THRESHOLD_HOURS).toBe(24);
  });
});

describe('isErrorEntry', () => {
  it('should return true for error entry', () => {
    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(isErrorEntry(entry)).toBe(true);
  });

  it('should return false for success entry', () => {
    const entry: Entry = {
      title: 'Test Title',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(isErrorEntry(entry)).toBe(false);
  });

  it('should return false for success entry with null title', () => {
    const entry: Entry = {
      title: null,
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(isErrorEntry(entry)).toBe(false);
  });
});

describe('isSuccessEntry', () => {
  it('should return true for success entry', () => {
    const entry: Entry = {
      title: 'Test Title',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(isSuccessEntry(entry)).toBe(true);
  });

  it('should return true for success entry with null title', () => {
    const entry: Entry = {
      title: null,
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(isSuccessEntry(entry)).toBe(true);
  });

  it('should return false for error entry', () => {
    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(isSuccessEntry(entry)).toBe(false);
  });
});

describe('urlToKey', () => {
  it('should convert string URL to key', () => {
    expect(urlToKey('https://example.com')).toBe('https://example.com');
  });

  it('should convert URL object to key', () => {
    const url = new URL('https://example.com/page');
    expect(urlToKey(url)).toBe('https://example.com/page');
  });

  it('should preserve query parameters', () => {
    expect(urlToKey('https://example.com?foo=bar')).toBe('https://example.com?foo=bar');
  });

  it('should preserve hash fragments', () => {
    expect(urlToKey('https://example.com#section')).toBe('https://example.com#section');
  });

  it('should handle URL object with port', () => {
    const url = new URL('https://example.com:8080/api');
    expect(urlToKey(url)).toBe('https://example.com:8080/api');
  });

  it('should handle URL object with auth', () => {
    const url = new URL('https://user:pass@example.com');
    expect(urlToKey(url)).toBe('https://user:pass@example.com/');
  });
});

describe('isStaleErrorEntry', () => {
  it('should return false for fresh error entry', () => {
    const now = new Date('2024-01-01T12:00:00.000Z');
    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: '2024-01-01T00:00:00.000Z', // 12 hours ago
    };
    expect(isStaleErrorEntry(entry, now)).toBe(false);
  });

  it('should return false for entry exactly at threshold', () => {
    const now = new Date('2024-01-02T00:00:00.000Z');
    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: '2024-01-01T00:00:00.000Z', // exactly 24 hours ago
    };
    expect(isStaleErrorEntry(entry, now)).toBe(false);
  });

  it('should return true for entry older than threshold', () => {
    const now = new Date('2024-01-02T00:00:01.000Z');
    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: '2024-01-01T00:00:00.000Z', // 24 hours and 1 second ago
    };
    expect(isStaleErrorEntry(entry, now)).toBe(true);
  });

  it('should return true for very old entry', () => {
    const now = new Date('2024-06-01T00:00:00.000Z');
    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: '2024-01-01T00:00:00.000Z', // ~5 months ago
    };
    expect(isStaleErrorEntry(entry, now)).toBe(true);
  });

  it('should use current time when no time provided', () => {
    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: new Date().toISOString(), // just now
    };
    expect(isStaleErrorEntry(entry)).toBe(false);
  });

  it('should handle ISO date strings', () => {
    const now = new Date('2024-01-03T00:00:00.000Z');
    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(isStaleErrorEntry(entry, now)).toBe(true);
  });
});

describe('createSuccessEntry', () => {
  it('should create entry with title', () => {
    const entry = createSuccessEntry('Test Title', '2024-01-01T00:00:00.000Z');
    expect(entry).toEqual({
      title: 'Test Title',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('should create entry with null title', () => {
    const entry = createSuccessEntry(null, '2024-01-01T00:00:00.000Z');
    expect(entry).toEqual({
      title: null,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('should use current time when not provided', () => {
    const before = new Date().toISOString();
    const entry = createSuccessEntry('Test Title');
    const after = new Date().toISOString();

    expect(entry.title).toBe('Test Title');
    expect(entry.updatedAt >= before).toBe(true);
    expect(entry.updatedAt <= after).toBe(true);
  });

  it('should create entry with empty string title', () => {
    const entry = createSuccessEntry('', '2024-01-01T00:00:00.000Z');
    expect(entry.title).toBe('');
  });
});

describe('createErrorEntry', () => {
  it('should create error entry with provided timestamp', () => {
    const entry = createErrorEntry('2024-01-01T00:00:00.000Z');
    expect(entry).toEqual({
      error: 'Failed to fetch title',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('should use current time when not provided', () => {
    const before = new Date().toISOString();
    const entry = createErrorEntry();
    const after = new Date().toISOString();

    expect(entry.error).toBe('Failed to fetch title');
    expect(entry.updatedAt >= before).toBe(true);
    expect(entry.updatedAt <= after).toBe(true);
  });

  it('should always have the same error message', () => {
    const entry1 = createErrorEntry();
    const entry2 = createErrorEntry();
    expect(entry1.error).toBe(entry2.error);
    expect(entry1.error).toBe('Failed to fetch title');
  });
});

describe('type guards work correctly together', () => {
  it('should mutually exclude entry types', () => {
    const successEntry: Entry = { title: 'Test', updatedAt: '2024-01-01T00:00:00.000Z' };
    const errorEntry: EntryError = { error: 'Failed', updatedAt: '2024-01-01T00:00:00.000Z' };

    // Success entry
    expect(isSuccessEntry(successEntry)).toBe(true);
    expect(isErrorEntry(successEntry)).toBe(false);

    // Error entry
    expect(isSuccessEntry(errorEntry)).toBe(false);
    expect(isErrorEntry(errorEntry)).toBe(true);
  });
});

describe('getTitle', () => {
  beforeEach(() => {
    // Clear mock data before each test
    Object.keys(mockData).forEach((key) => delete mockData[key]);
    mockWrite.mockClear();
  });

  it('should return exists: false for non-existent URL', async () => {
    const result = await getTitle('https://example.com/not-found');

    expect(result).toEqual({
      exists: false,
      entry: null,
    });
  });

  it('should return existing success entry', async () => {
    const entry: Entry = { title: 'Test Title', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockData['https://example.com'] = entry;

    const result = await getTitle('https://example.com');

    expect(result).toEqual({
      exists: true,
      entry,
    });
  });

  it('should return existing success entry with null title', async () => {
    const entry: Entry = { title: null, updatedAt: '2024-01-01T00:00:00.000Z' };
    mockData['https://example.com'] = entry;

    const result = await getTitle('https://example.com');

    expect(result).toEqual({
      exists: true,
      entry,
    });
  });

  it('should return fresh error entry without removing it', async () => {
    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: new Date().toISOString(), // fresh
    };
    mockData['https://example.com'] = entry;

    const result = await getTitle('https://example.com');

    expect(result.exists).toBe(true);
    expect(result.entry).toEqual(entry);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockData['https://example.com']).toBeDefined();
  });

  it('should remove stale error entry and return not exists', async () => {
    const staleDate = new Date();
    staleDate.setHours(staleDate.getHours() - 25); // 25 hours ago

    const entry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt: staleDate.toISOString(),
    };
    mockData['https://example.com'] = entry;

    const result = await getTitle('https://example.com');

    expect(result).toEqual({
      exists: false,
      entry: null,
    });
    expect(mockWrite).toHaveBeenCalled();
    expect(mockData['https://example.com']).toBeUndefined();
  });

  it('should handle URL object', async () => {
    const entry: Entry = { title: 'Test', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockData['https://example.com/page'] = entry;

    const result = await getTitle(new URL('https://example.com/page'));

    expect(result.exists).toBe(true);
    expect(result.entry).toEqual(entry);
  });

  it('should handle URL with query parameters', async () => {
    const entry: Entry = { title: 'Search Results', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockData['https://example.com/search?q=test'] = entry;

    const result = await getTitle('https://example.com/search?q=test');

    expect(result.exists).toBe(true);
    expect(result.entry).toEqual(entry);
  });
});

describe('setTitle', () => {
  beforeEach(() => {
    // Clear mock data before each test
    Object.keys(mockData).forEach((key) => delete mockData[key]);
    mockWrite.mockClear();
  });

  it('should store success entry for non-null title', async () => {
    await setTitle('https://example.com', 'Test Title');

    expect(mockData['https://example.com']).toBeDefined();
    const entry = mockData['https://example.com'] as Entry;
    expect(entry.title).toBe('Test Title');
    expect(entry.updatedAt).toBeDefined();
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('should store error entry for null title', async () => {
    await setTitle('https://example.com', null);

    expect(mockData['https://example.com']).toBeDefined();
    const entry = mockData['https://example.com'] as EntryError;
    expect(entry.error).toBe('Failed to fetch title');
    expect(entry.updatedAt).toBeDefined();
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('should overwrite existing entry', async () => {
    mockData['https://example.com'] = { title: 'Old Title', updatedAt: '2024-01-01T00:00:00.000Z' };

    await setTitle('https://example.com', 'New Title');

    const entry = mockData['https://example.com'] as Entry;
    expect(entry.title).toBe('New Title');
    expect(entry.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
  });

  it('should handle URL object', async () => {
    await setTitle(new URL('https://example.com/page'), 'Page Title');

    expect(mockData['https://example.com/page']).toBeDefined();
    const entry = mockData['https://example.com/page'] as Entry;
    expect(entry.title).toBe('Page Title');
  });

  it('should handle empty string title', async () => {
    await setTitle('https://example.com', '');

    const entry = mockData['https://example.com'] as Entry;
    expect(entry.title).toBe('');
    expect('error' in entry).toBe(false);
  });

  it('should call db.write after storing', async () => {
    await setTitle('https://example.com', 'Test');

    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('should convert error entry to success entry', async () => {
    mockData['https://example.com'] = {
      error: 'Failed to fetch title',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    await setTitle('https://example.com', 'Now it works!');

    const entry = mockData['https://example.com'] as Entry;
    expect(entry.title).toBe('Now it works!');
    expect('error' in entry).toBe(false);
  });
});

