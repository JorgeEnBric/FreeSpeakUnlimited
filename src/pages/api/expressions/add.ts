import type { APIRoute } from 'astro';
import { insertExpression } from '../../../lib/database';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const expression = body.expression?.trim();

    if (!expression) {
      return new Response(JSON.stringify({ error: 'No expression provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { initDB } = await import('../../../lib/database');
    await initDB();
    const id = await insertExpression(expression, null);

    return new Response(JSON.stringify({ success: true, id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error saving expression:', error);
    return new Response(JSON.stringify({ error: 'Failed to save expression' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
