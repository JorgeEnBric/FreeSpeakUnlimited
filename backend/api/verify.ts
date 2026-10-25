import jwt from 'jsonwebtoken';
import { LICENSES } from '../licenses';

export default function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  const { token } = req.body ?? {};
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { hwid: string };
    const lic = LICENSES.find(l => l.hwid === payload.hwid);

    if (!lic || lic.status !== 'active' || new Date(lic.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Licencia bloqueada o expirada' });
    }

    res.status(200).json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}
