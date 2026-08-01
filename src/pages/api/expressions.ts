import type { APIRoute } from 'astro';
import { getExpressions } from '../../lib/database';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const { initDB } = await import('../../lib/database');
    await initDB();
    const expressions = await getExpressions();
    return new Response(JSON.stringify({ expressions }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching expressions:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch expressions' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
