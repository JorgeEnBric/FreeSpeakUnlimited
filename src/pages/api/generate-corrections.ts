import type { APIRoute } from 'astro';
import { notifyNewMessage } from '../../lib/corrections';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const { initDB, getPendingMessages } = await import('../../lib/database');
    await initDB();

    const pending = await getPendingMessages();
    for (const msg of pending) {
      notifyNewMessage(msg.id);
    }

    return new Response(JSON.stringify({ queued: pending.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
