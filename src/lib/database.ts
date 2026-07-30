import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DB_PATH = join(process.cwd(), 'data.db');

let db: any = null;

async function getDb(): Promise<any> {
  if (db) return db;
  const initSqlJs = await import('sql.js');
  const SQL = await initSqlJs.default();
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  return db;
}

export async function initDB(): Promise<void> {
  const d = await getDb();
  d.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    analyzed INTEGER DEFAULT 0
  )`);
  d.run(`CREATE TABLE IF NOT EXISTS corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    original TEXT NOT NULL,
    corrected TEXT,
    tip TEXT,
    pattern_code TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES messages(id)
  )`);
  d.run(`CREATE TABLE IF NOT EXISTS patterns (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT
  )`);
  d.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  d.run(`INSERT OR IGNORE INTO patterns VALUES
    ('VERB_TENSE', 'Verb Tense', 'Incorrect use of verb tenses'),
    ('PREPOSITIONS', 'Prepositions', 'Incorrect use of prepositions'),
    ('AGE_EXPRESSION', 'Age Expression', 'Unnatural age/quantity expressions'),
    ('CONNECTORS', 'Connectors', 'Transitions and connecting words'),
    ('REDUNDANCY', 'Redundancy', 'Redundant or repeated information'),
    ('NATURAL_EXPRESSION', 'Natural Expression', 'Expression that sounds unnatural'),
    ('VOCABULARY_CHOICE', 'Vocabulary Choice', 'Wrong word for the context'),
    ('COLLOCATIONS', 'Collocations', 'Incorrect word combinations'),
    ('COMPARATIVES_SUPERLATIVES', 'Comparatives & Superlatives', 'Incorrect comparative/superlative forms'),
    ('COUNTABLE_UNCOUNTABLE', 'Countable/Uncountable', 'Mistake with countable/uncountable nouns'),
    ('AUXILIARY_VERBS', 'Auxiliary Verbs', 'Incorrect auxiliary verb usage'),
    ('WORD_ORDER', 'Word Order', 'Incorrect sentence structure'),
    ('PRONOUNS', 'Pronouns', 'Incorrect pronoun usage'),
    ('PLURALS', 'Plurals', 'Incorrect plural forms'),
    ('ARTICLES', 'Articles', 'Missing or incorrect articles'),
    ('OTHER', 'Other', 'Other types of errors')
  `);
  save();
}

export async function insertLog(source: string, message: string): Promise<void> {
  const d = await getDb();
  d.run('INSERT INTO logs (source, message) VALUES (?, ?)', [source, message]);
  save();
}

export async function getLogs(limit = 50): Promise<{ id: number; source: string; message: string; created_at: string }[]> {
  const d = await getDb();
  const rows = d.exec('SELECT id, source, message, created_at FROM logs ORDER BY id DESC LIMIT ?', [limit]);
  if (!rows.length) return [];
  return rows[0].values.map((r: any) => ({ id: r[0], source: r[1], message: r[2], created_at: r[3] }));
}

export async function insertMessage(text: string): Promise<number> {
  const d = await getDb();
  d.run('INSERT INTO messages (text, analyzed) VALUES (?, 0)', [text]);
  save();
  return (d.exec('SELECT last_insert_rowid()')[0].values[0][0]) as number;
}

export async function getPendingMessages(): Promise<{ id: number; text: string }[]> {
  const d = await getDb();
  const rows = d.exec('SELECT id, text FROM messages WHERE analyzed = 0 ORDER BY created_at ASC');
  if (!rows.length) return [];
  return rows[0].values.map((r: any) => ({ id: r[0] as number, text: r[1] as string }));
}

export async function insertCorrection(
  messageId: number,
  original: string,
  corrected: string,
  tip: string,
  patternCode: string
): Promise<void> {
  const d = await getDb();
  d.run(
    'INSERT INTO corrections (message_id, original, corrected, tip, pattern_code) VALUES (?, ?, ?, ?, ?)',
    [messageId, original, corrected, tip, patternCode]
  );
  save();
}

export async function markAnalyzed(messageIds: number[]): Promise<void> {
  if (!messageIds.length) return;
  const d = await getDb();
  const placeholders = messageIds.map(() => '?').join(',');
  d.run(`UPDATE messages SET analyzed = 1 WHERE id IN (${placeholders})`, messageIds);
  save();
}

export async function getCorrectionsByPattern(): Promise<{
  code: string;
  label: string;
  examples: { original: string; corrected: string; tip: string }[];
}[]> {
  const d = await getDb();
  const rows = d.exec(`
    SELECT p.code, p.label, c.original, c.corrected, c.tip
    FROM corrections c
    JOIN patterns p ON p.code = c.pattern_code
    ORDER BY p.code, c.created_at DESC
  `);
  if (!rows.length) return [];
  const map = new Map<string, { code: string; label: string; examples: { original: string; corrected: string; tip: string }[] }>();
  for (const r of rows[0].values) {
    const code = r[0] as string;
    const label = r[1] as string;
    if (!map.has(code)) map.set(code, { code, label, examples: [] });
    map.get(code)!.examples.push({
      original: r[2] as string,
      corrected: r[3] as string,
      tip: r[4] as string,
    });
  }
  return Array.from(map.values());
}

export async function getUnanalyzedCount(): Promise<number> {
  const d = await getDb();
  const rows = d.exec('SELECT COUNT(*) FROM messages WHERE analyzed = 0');
  if (!rows.length) return 0;
  return rows[0].values[0][0] as number;
}

function save(): void {
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
}
