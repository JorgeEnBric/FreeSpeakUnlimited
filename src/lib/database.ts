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
    pattern_code TEXT NOT NULL,
    processing_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES messages(id)
  )`);
  // Migración: eliminar columna tip si existe en DBs antiguas
  try {
    const cols = d.exec(`PRAGMA table_info(corrections)`);
    if (cols.length && cols[0].values.some((r: any) => r[1] === 'tip')) {
      d.run(`ALTER TABLE corrections DROP COLUMN tip`);
    }
  } catch { /* sqlite <3.35 o columna ya eliminada */ }
  // Migración: añadir processing_ms si no existe
  try {
    const cols2 = d.exec(`PRAGMA table_info(corrections)`);
    if (cols2.length && !cols2[0].values.some((r: any) => r[1] === 'processing_ms')) {
      d.run(`ALTER TABLE corrections ADD COLUMN processing_ms INTEGER`);
    }
  } catch { /* ya existe */ }
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
  d.run(`CREATE TABLE IF NOT EXISTS new_expressions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expression TEXT NOT NULL,
    context TEXT,
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
  // Tablas fluidez: Debate (mensajes largos) y CorreccionsDebate separadas
  d.run(`CREATE TABLE IF NOT EXISTS debates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    text TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    analyzed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  d.run(`CREATE TABLE IF NOT EXISTS debate_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debate_id INTEGER NOT NULL,
    original TEXT NOT NULL,
    corrected TEXT,
    pattern_code TEXT NOT NULL,
    processing_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (debate_id) REFERENCES debates(id),
    FOREIGN KEY (pattern_code) REFERENCES patterns(code)
  )`);
  save();
}

export async function insertLog(source: string, message: string): Promise<void> {
  const d = await getDb();
  d.run('INSERT INTO logs (source, message) VALUES (?, ?)', [source, message]);
  save();
}

export async function insertExpression(expression: string, context?: string): Promise<number> {
  const d = await getDb();
  d.run('INSERT INTO new_expressions (expression, context) VALUES (?, ?)', [expression, context ?? null]);
  save();
  return (d.exec('SELECT last_insert_rowid()') as any)[0]?.values?.[0]?.[0] as number;
}

export async function getExpressions(): Promise<{ id: number; expression: string; context: string | null; created_at: string }[]> {
  const d = await getDb();
  const rows = d.exec('SELECT id, expression, context, created_at FROM new_expressions ORDER BY id DESC');
  if (!rows.length) return [];
  return rows[0].values.map((r: any) => ({
    id: r[0],
    expression: r[1],
    context: r[2],
    created_at: r[3],
  }));
}

export async function deleteExpression(id: number): Promise<void> {
  const d = await getDb();
  d.run('DELETE FROM new_expressions WHERE id = ?', [id]);
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
  const id = (d.exec('SELECT last_insert_rowid()')[0].values[0][0]) as number;
  save();
  return id;
}

export async function getPendingMessages(): Promise<{ id: number; text: string }[]> {
  const d = await getDb();
  const rows = d.exec('SELECT id, text FROM messages WHERE analyzed = 0 ORDER BY created_at ASC');
  if (!rows.length) return [];
  return rows[0].values.map((r: any) => ({ id: r[0] as number, text: r[1] as string }));
}

export async function getMessageById(id: number): Promise<{ id: number; text: string } | null> {
  const d = await getDb();
  const rows = d.exec('SELECT id, text FROM messages WHERE id = ?', [id]);
  if (!rows.length || !rows[0].values.length) return null;
  return { id: rows[0].values[0][0] as number, text: rows[0].values[0][1] as string };
}

export async function getNewCorrectionsSince(lastId: number): Promise<{
  id: number; code: string; label: string;
  original: string; corrected: string; processing_ms: number | null;
}[]> {
  const d = await getDb();
  const rows = d.exec(`
    SELECT c.id, p.code, p.label, c.original, c.corrected, c.processing_ms
    FROM corrections c
    JOIN patterns p ON p.code = c.pattern_code
    WHERE c.id > ?
    ORDER BY c.created_at ASC
  `, [lastId]);
  if (!rows.length) return [];
  return rows[0].values.map((r: any) => ({
    id: r[0] as number,
    code: r[1] as string,
    label: r[2] as string,
    original: r[3] as string,
    corrected: r[4] as string,
    processing_ms: r[5] as number | null,
  }));
}

export async function insertCorrection(
  messageId: number,
  original: string,
  corrected: string,
  patternCode: string,
  processingMs?: number | null
): Promise<void> {
  const d = await getDb();
  d.run(
    'INSERT INTO corrections (message_id, original, corrected, pattern_code, processing_ms) VALUES (?, ?, ?, ?, ?)',
    [messageId, original, corrected, patternCode, processingMs ?? null]
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
  id: number; code: string; label: string;
  original: string; corrected: string; processing_ms: number | null;
}[]> {
  const d = await getDb();
  const rows = d.exec(`
    SELECT c.id, p.code, p.label, c.original, c.corrected, c.processing_ms
    FROM corrections c
    JOIN patterns p ON p.code = c.pattern_code
    ORDER BY c.id DESC
  `);
  if (!rows.length) return [];
  return rows[0].values.map((r: any) => ({
    id: r[0] as number,
    code: r[1] as string,
    label: r[2] as string,
    original: r[3] as string,
    corrected: r[4] as string,
    processing_ms: r[5] as number | null,
  }));
}

export async function getUnanalyzedCount(): Promise<number> {
  const d = await getDb();
  const rows = d.exec('SELECT COUNT(*) FROM messages WHERE analyzed = 0');
  if (!rows.length) return 0;
  return rows[0].values[0][0] as number;
}

export async function clearAll(): Promise<void> {
  const d = await getDb();
  d.run('DELETE FROM corrections');
  d.run('DELETE FROM debate_corrections');
  d.run('DELETE FROM debates');
  d.run('DELETE FROM messages');
  d.run('DELETE FROM new_expressions');
  d.run('DELETE FROM logs');
  save();
}

export async function insertDebate(topic: string, text: string, durationMs: number): Promise<number> {
  const d = await getDb();
  d.run('INSERT INTO debates (topic, text, duration_ms, analyzed) VALUES (?, ?, ?, 0)', [topic, text, durationMs]);
  const id = (d.exec('SELECT last_insert_rowid()')[0].values[0][0]) as number;
  save();
  return id;
}

export async function getDebateById(id: number): Promise<{ id: number; topic: string; text: string; duration_ms: number } | null> {
  const d = await getDb();
  const rows = d.exec('SELECT id, topic, text, duration_ms FROM debates WHERE id = ?', [id]);
  if (!rows.length || !rows[0].values.length) return null;
  const r = rows[0].values[0] as any[];
  return { id: r[0] as number, topic: r[1] as string, text: r[2] as string, duration_ms: r[3] as number };
}

export async function insertDebateCorrection(
  debateId: number,
  original: string,
  corrected: string,
  patternCode: string,
  processingMs?: number | null
): Promise<void> {
  const d = await getDb();
  d.run(
    'INSERT INTO debate_corrections (debate_id, original, corrected, pattern_code, processing_ms) VALUES (?, ?, ?, ?, ?)',
    [debateId, original, corrected, patternCode, processingMs ?? null]
  );
  save();
}

export async function markDebateAnalyzed(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const d = await getDb();
  const ph = ids.map(() => '?').join(',');
  d.run(`UPDATE debates SET analyzed = 1 WHERE id IN (${ph})`, ids);
  save();
}

export async function getNewDebateCorrectionsSince(lastId: number, debateId?: number | null): Promise<{
  id: number; code: string; label: string; original: string; corrected: string; processing_ms: number | null; debate_id: number;
}[]> {
  const d = await getDb();
  let sql = `
    SELECT c.id, p.code, p.label, c.original, c.corrected, c.processing_ms, c.debate_id
    FROM debate_corrections c
    JOIN patterns p ON p.code = c.pattern_code
    WHERE c.id > ?
  `;
  const params: any[] = [lastId];
  if (debateId) {
    sql += ` AND c.debate_id = ?`;
    params.push(debateId);
  }
  sql += ` ORDER BY c.created_at ASC`;
  const rows = d.exec(sql, params);
  if (!rows.length) return [];
  return rows[0].values.map((r: any) => ({
    id: r[0] as number,
    code: r[1] as string,
    label: r[2] as string,
    original: r[3] as string,
    corrected: r[4] as string,
    processing_ms: r[5] as number | null,
    debate_id: r[6] as number,
  }));
}

export async function getDebateCorrections(debateId?: number | null): Promise<{
  id: number; code: string; label: string; original: string; corrected: string; processing_ms: number | null; debate_id: number;
}[]> {
  const d = await getDb();
  let sql = `
    SELECT c.id, p.code, p.label, c.original, c.corrected, c.processing_ms, c.debate_id
    FROM debate_corrections c
    JOIN patterns p ON p.code = c.pattern_code
  `;
  const params: any[] = [];
  if (debateId) {
    sql += ` WHERE c.debate_id = ?`;
    params.push(debateId);
  }
  sql += ` ORDER BY c.id DESC`;
  const rows = params.length ? d.exec(sql, params) : d.exec(sql);
  if (!rows.length) return [];
  return rows[0].values.map((r: any) => ({
    id: r[0] as number,
    code: r[1] as string,
    label: r[2] as string,
    original: r[3] as string,
    corrected: r[4] as string,
    processing_ms: r[5] as number | null,
    debate_id: r[6] as number,
  }));
}

export async function clearDebateCorrections(debateId?: number | null): Promise<void> {
  const d = await getDb();
  if (debateId) d.run('DELETE FROM debate_corrections WHERE debate_id = ?', [debateId]);
  else d.run('DELETE FROM debate_corrections');
  save();
}

function save(): void {
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
}
