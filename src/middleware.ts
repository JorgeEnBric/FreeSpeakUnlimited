import { defineMiddleware } from 'astro:middleware';
import { getToken, estaBloqueado } from './lib/license-store';
import { inicializarLicencia } from './lib/license-client';

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  if (
    path.startsWith('/_astro') ||
    path.startsWith('/favicon') ||
    path === '/licencia-bloqueada'
  ) {
    return next();
  }

  if (!getToken() && !estaBloqueado()) {
    await inicializarLicencia();
  }

  if (estaBloqueado() || !getToken()) {
    return context.redirect('/licencia-bloqueada');
  }

  return next();
});
