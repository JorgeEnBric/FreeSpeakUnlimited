import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const text = body.text?.trim() ?? '';
    const structure = body.structure?.trim() ?? 'Dice';
    const question = body.question?.trim() ?? '';
    const durationMs = body.durationMs ? Number(body.durationMs) : 0;

    if (!text) {
      return new Response(JSON.stringify({ error: 'No text provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { initDB, insertDebate } = await import('../../lib/database');
    await initDB();

    const topic = `${structure}${question ? ' — ' + question : ''}`.slice(0, 300);
    const debateId = await insertDebate(topic, text, durationMs);

    const { notifyDebateMessage } = await import('../../lib/fluencyCorrections');
    notifyDebateMessage(debateId);

    return new Response(JSON.stringify({ debateId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Dice submit error:', error);
    return new Response(JSON.stringify({ error: 'Failed to submit answer' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
