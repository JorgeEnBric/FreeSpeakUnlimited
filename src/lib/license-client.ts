import './ca-loader';
import { getHWID } from './hwid';
import {
  setToken,
  getToken,
  bloquear,
  estaInicializado,
  marcarInicializado,
} from './license-store';
import { addLog } from './log-store';

const BACKEND = process.env.BACKEND_URL || 'https://backendfreespeek.vercel.app';

let intervaloActivo = false;

export async function inicializarLicencia(): Promise<boolean> {
  if (estaInicializado()) {
    addLog('[lic] licencia ya inicializada');
    return getToken() !== null;
  }

  const hwid = getHWID();
  try {
    const res = await fetch(`${BACKEND}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hwid }),
    });
    addLog('[lic] validate request sent');

    if (!res.ok) {
      addLog('[lic] validate response error, status=' + res.status);
      bloquear();
      marcarInicializado();
      return false;
    }

    const { token } = await res.json();
    addLog('[lic] validate response 200, token recibido');
    setToken(token);
    marcarInicializado();

    if (!intervaloActivo) {
      intervaloActivo = true;
      addLog('[lic] iniciar verify interval');
      setInterval(async () => {
        addLog('[lic] verify interval ejecucion');
        const t = getToken();
        if (!t) { bloquear(); return; }
        try {
          const r = await fetch(`${BACKEND}/api/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: t }),
          });
          addLog('[lic] verify response, ok=' + r.ok);
          if (!r.ok) bloquear();
        } catch {
          addLog('[lic] verify interval error');
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
