import { getHWID } from './hwid';
import {
  setToken,
  getToken,
  bloquear,
  estaInicializado,
  marcarInicializado,
} from './license-store';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3333';

let intervaloActivo = false;

export async function inicializarLicencia(): Promise<boolean> {
  if (estaInicializado()) return getToken() !== null;

  const hwid = getHWID();
  try {
    const res = await fetch(`${BACKEND}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hwid }),
    });

    if (!res.ok) {
      bloquear();
      marcarInicializado();
      return false;
    }

    const { token } = await res.json();
    setToken(token);
    marcarInicializado();

    if (!intervaloActivo) {
      intervaloActivo = true;
      setInterval(async () => {
        const t = getToken();
        if (!t) { bloquear(); return; }
        try {
          const r = await fetch(`${BACKEND}/api/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: t }),
          });
          if (!r.ok) bloquear();
        } catch {
          bloquear();
        }
      }, 20 * 60 * 1000);
    }

    return true;
  } catch {
    bloquear();
    marcarInicializado();
    return false;
  }
}

export function getHWIDExport(): string {
  return getHWID();
}
