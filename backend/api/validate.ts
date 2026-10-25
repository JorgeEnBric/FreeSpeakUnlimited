import jwt from 'jsonwebtoken';
import { LICENSES } from '../licenses';

export default function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  const { hwid } = req.body ?? {};
  const lic = LICENSES.find(l => l.hwid === hwid);

  if (!lic || lic.status !== 'active' || new Date(lic.expiresAt) < new Date()) {
    return res.status(403).json({ error: 'Licencia no válida o expirada' });
  }

  const token = jwt.sign(
    { hwid: lic.hwid, email: lic.email, phone: lic.phone },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  );

  res.status(200).json({ token });
}
