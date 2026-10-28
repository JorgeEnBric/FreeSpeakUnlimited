let logs: Array<[number, string]> = [];
const MAX_ENTRIES = 500;

export function addLog(msg: string) {
  const now = Date.now();
  if (logs.length >= MAX_ENTRIES) logs.shift();
  logs.push([now, msg]);
}

export function getLogs(): Array<[number, string]> {
  return logs;
}

export function clearLogs() {
  logs = [];
}