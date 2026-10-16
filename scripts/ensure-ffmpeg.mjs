import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
} catch {
  ffmpegPath = null;
}

if (ffmpegPath && existsSync(ffmpegPath)) {
  console.log('[ensure-ffmpeg] Binario de ffmpeg presente:', ffmpegPath);
  process.exit(0);
}

const installer = join(projectRoot, 'node_modules', 'ffmpeg-static', 'install.js');
if (!existsSync(installer)) {
  console.warn('[ensure-ffmpeg] ffmpeg-static no esta instalado; se omite la verificacion.');
  process.exit(0);
}

try {
  console.log('[ensure-ffmpeg] ffmpeg ausente; ejecutando la descarga de ffmpeg-static...');
  execFileSync(process.execPath, [installer], { cwd: dirname(installer), stdio: 'inherit' });
  console.log('[ensure-ffmpeg] ffmpeg listo.');
} catch (err) {
  console.warn('[ensure-ffmpeg] No se pudo descargar ffmpeg automaticamente:', err.message);
  console.warn('[ensure-ffmpeg] Ejecuta manualmente: npm rebuild ffmpeg-static');
}
process.exit(0);
