export type License = {
  hwid: string;
  email: string;
  phone: string;
  status: 'active' | 'expired' | 'blocked';
  expiresAt: string;
};

export const LICENSES: License[] = [
  {
    hwid: 'REEMPLAZAR_POR_HWID_REAL',
    email: 'cliente@correo.com',
    phone: '+54 9 11 1234-5678',
    status: 'active',
    expiresAt: '2026-12-31T23:59:59Z',
  },
  // Agregar aquí cada licencia vendida
];
