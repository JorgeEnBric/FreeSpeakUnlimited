import type { APIRoute } from 'astro';
import { clearAll } from '../../lib/database';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const { initDB } = await import('../../lib/database');
    await initDB();
    await clearAll();
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error clearing database:', error);
    return new Response(JSON.stringify({ error: 'Failed to clear database' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
