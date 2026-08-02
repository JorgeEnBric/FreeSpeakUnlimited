import type { APIRoute } from 'astro';

export const prerender = false;

export const DELETE: APIRoute = async ({ params }) => {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return new Response(JSON.stringify({ error: 'Invalid id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { initDB, deleteExpression } = await import('../../../lib/database');
    await initDB();
    await deleteExpression(id);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting expression:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete expression' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
