import { JSONFilePreset } from 'lowdb/node'

/** Successful title entry */
export interface Entry {
  title: string | null;
  updatedAt: string;
}

/** Error entry for failed fetches */
export interface EntryError {
  error: string;
  updatedAt: string;
}

/** Database schema - URL to Entry/EntryError mapping */
export type Database = Record<string, Entry | EntryError>;

/** Result of getTitle lookup */
export interface GetTitleResult {
  exists: boolean;
  entry: Entry | EntryError | null;
}

/** Stale entry threshold in hours */
export const STALE_ERROR_THRESHOLD_HOURS = 24;

/** Type guard to check if entry is an error entry */
export function isErrorEntry(entry: Entry | EntryError): entry is EntryError {
  return 'error' in entry;
}

/** Type guard to check if entry is a successful entry */
export function isSuccessEntry(entry: Entry | EntryError): entry is Entry {
  return 'title' in entry;
}

/** Converts URL to string key */
export function urlToKey(url: string | URL): string {
  return url.toString();
}

/** Checks if an error entry is stale (older than threshold) */
export function isStaleErrorEntry(entry: EntryError, now: Date = new Date()): boolean {
  const updatedAt = new Date(entry.updatedAt);
  const hoursDiff = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);
  return hoursDiff > STALE_ERROR_THRESHOLD_HOURS;
}

/** Creates a successful entry */
export function createSuccessEntry(title: string | null, updatedAt: string = new Date().toISOString()): Entry {
  return { title, updatedAt };
}

/** Creates an error entry */
export function createErrorEntry(updatedAt: string = new Date().toISOString()): EntryError {
  return { error: 'Failed to fetch title', updatedAt };
}

const defaultData: Database = {};
const db = await JSONFilePreset<Database>('db.titles.json', defaultData)

export async function getTitle(url: string | URL): Promise<GetTitleResult> {
  const key = urlToKey(url);
  const exists = key in db.data;

  if (exists) {
    const entry = db.data[key];

    // If it's an error entry and stale, remove and retry
    if (isErrorEntry(entry) && isStaleErrorEntry(entry)) {
      delete db.data[key];
      await db.write();
      return { exists: false, entry: null };
    }

    return { exists: true, entry };
  }

  return { exists: false, entry: null };
}

export async function setTitle(url: string | URL, title: string | null): Promise<void> {
  const key = urlToKey(url);

  if (title === null) {
    db.data[key] = createErrorEntry();
  } else {
    db.data[key] = createSuccessEntry(title);
  }

  await db.write();
}
