import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

let loaded = false;

export function ensureCaLoaded(): string[] {
  if (loaded) return [];
  loaded = true;

  const publicDir = path.resolve(process.cwd(), 'public');

  let files: string[] = [];
  try {
    files = fs.readdirSync(publicDir);
  } catch {
    console.log('[ca-loader] No se pudo leer el directorio public/');
    return [];
  }

  const crtFiles = files.filter((f) => f.toLowerCase().endsWith('.crt'));
  if (crtFiles.length === 0) {
    console.log('[ca-loader] No se encontraron archivos .crt en public/');
    return [];
  }

  const certs: Buffer[] = [];
  for (const file of crtFiles) {
    try {
      certs.push(fs.readFileSync(path.join(publicDir, file)));
      console.log(`[ca-loader] Certificado cargado: public/${file}`);
    } catch (err) {
      console.error(`[ca-loader] No se pudo leer public/${file}:`, err);
    }
  }

  if (certs.length === 0) return [];

  const original = tls.createSecureContext;
  tls.createSecureContext = ((options?: tls.SecureContextOptions) => {
    const ctx = original(options ?? {});
    for (const cert of certs) {
      try {
        (ctx as any).context.addCACert(cert);
      } catch (err) {
        console.error('[ca-loader] Error al añadir la CA al contexto TLS:', err);
      }
    }
    return ctx;
  }) as typeof tls.createSecureContext;

  console.log(
    `[ca-loader] TLS configurado para confiar en ${certs.length} certificado(s) .crt de public/`
  );

  return crtFiles.map((f) => path.join(publicDir, f));
}

ensureCaLoaded();
