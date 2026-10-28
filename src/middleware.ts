import { defineMiddleware } from 'astro:middleware';
import { getToken, estaBloqueado } from './lib/license-store';
import { inicializarLicencia } from './lib/license-client';
import { addLog } from './lib/log-store';

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  if (
    path.startsWith('/_astro') ||
    path.startsWith('/favicon') ||
    path === '/licencia-bloqueada' ||
    path === '/log' ||
    path === '/licencia-logs'
  ) {
    addLog('[mid] path excluido');
    return next();
  }

  if (!getToken() && !estaBloqueado()) {
    addLog('[mid] inicializarLicencia llamado');
    await inicializarLicencia();
  }

  if (estaBloqueado() || !getToken()) {
    addLog('[mid] bloqueo o sin token, redirecting');
    return context.redirect('/licencia-bloqueada');
  }

  return next();
});
