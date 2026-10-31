import { appendFileSync, existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, ensureDataDirs } from './paths';

const MAX_ENTRIES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

let logs: Array<[number, string]> = [];

function writeToFile(ts: number, msg: string): void {
  try {
    ensureDataDirs();
    const file = join(LOG_DIR, 'app.log');
    if (existsSync(file) && statSync(file).size > MAX_FILE_BYTES) {
      writeFileSync(file, '');
    }
    appendFileSync(file, `[${new Date(ts).toISOString()}] ${msg}\n`);
  } catch {}
}

export function addLog(msg: string) {
  const now = Date.now();
  if (logs.length >= MAX_ENTRIES) logs.shift();
  logs.push([now, msg]);
  writeToFile(now, msg);
}

export function getLogs(): Array<[number, string]> {
  return logs;
}

export function clearLogs() {
  logs = [];
}
