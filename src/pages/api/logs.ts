import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
  const { initDB, getLogs } = await import('../../lib/database');
  await initDB();
  const logs = await getLogs(100);
  return new Response(JSON.stringify(logs), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
