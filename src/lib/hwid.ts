import os from 'os';
import crypto from 'crypto';

export function getHWID(): string {
  const data = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.release(),
    os.cpus()[0]?.model ?? '',
    ...Object.values(os.networkInterfaces() ?? {})
      .flat()
      .map((n: any) => n?.mac ?? ''),
  ].join('|');

  return crypto.createHash('sha256').update(data).digest('hex');
}
