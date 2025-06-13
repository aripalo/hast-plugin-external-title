import { JSONFilePreset } from 'lowdb/node'

type Entry = {
  title: string | null;
  updatedAt: string;
};

type EntryError = {
  error: string;
  updatedAt: string;
}

type Database = Record<string, Entry | EntryError>;

const defaultData: Database = {};
const db = await JSONFilePreset<Database>('db.titles.json', defaultData)

export async function getTitle(url: string | URL): Promise<{ exists: boolean; entry: Entry | EntryError | null }> {
  const key = url.toString();
  const exists = key in db.data;

  if (exists) {
    const entry = db.data[key];

    // If it's an error entry and more than 24 hours old, remove and retry
    if ('error' in entry) {
      const updatedAt = new Date(entry.updatedAt);
      const now = new Date();
      const hoursDiff = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);

      if (hoursDiff > 24) {
        // Remove stale error entry
        delete db.data[key];
        await db.write();
        return { exists: false, entry: null };
      }
    }

    return { exists: true, entry };
  }

  return { exists: false, entry: null };
}

export async function setTitle(url: string | URL, title: string | null) {
  const key = url.toString();
  const updatedAt = new Date().toISOString();

  if (title === null) {
    // Store as error entry
    const errorEntry: EntryError = {
      error: 'Failed to fetch title',
      updatedAt
    };
    db.data[key] = errorEntry;
  } else {
    // Store as successful entry
    const entry: Entry = {
      title,
      updatedAt
    };
    db.data[key] = entry;
  }

  await db.write();
}
