import type { APIRoute } from 'astro';
import { warmup } from '../../lib/llamaServer';

export const prerender = false;

export const POST: APIRoute = async () => {
  await warmup();
  return new Response(JSON.stringify({ status: 'ready' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
