import { type APIRoute } from 'astro';
import { getLogs, clearLogs } from '../../lib/log-store';

export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({ logs: getLogs() }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

export const POST: APIRoute = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { clear } = body;
  if (clear === true) {
    clearLogs();
    return new Response(JSON.stringify({ cleared: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ error: 'Invalid request' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
};