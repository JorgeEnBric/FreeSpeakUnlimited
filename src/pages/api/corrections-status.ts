import type { APIRoute } from 'astro';
import { isAnalyzing } from '../../lib/corrections';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const { initDB, getPendingMessages, getCorrectionsByPattern } = await import('../../lib/database');
    await initDB();

    const pending = await getPendingMessages();
    const corrections = await getCorrectionsByPattern();

    return new Response(JSON.stringify({
      corrections,
      unanalyzed: pending.length,
      analyzing: isAnalyzing(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg, corrections: [], unanalyzed: 0, analyzing: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
