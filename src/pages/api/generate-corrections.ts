import type { APIRoute } from 'astro';
import { analyzePendingCorrections } from '../../lib/corrections';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    await analyzePendingCorrections();

    const { initDB, getCorrectionsByPattern, getPendingMessages } = await import('../../lib/database');
    await initDB();

    const corrections = await getCorrectionsByPattern();
    const pending = await getPendingMessages();

    return new Response(JSON.stringify({ corrections, unanalyzed: pending.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg, unanalyzed: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
