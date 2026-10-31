import { mkdirSync } from 'fs';
import { join } from 'path';

export const APP_DIR = process.env.FREESPEAK_APP_DIR || process.cwd();
export const DATA_DIR = process.env.FREESPEAK_DATA_DIR || APP_DIR;
export const TEMP_DIR = join(DATA_DIR, 'temp');
export const DB_PATH = join(DATA_DIR, 'data.db');
export const LOG_DIR = join(DATA_DIR, 'logs');

export function ensureDataDirs(): void {
  for (const dir of [DATA_DIR, TEMP_DIR, LOG_DIR]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {}
  }
}
