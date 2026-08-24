import type { APIRoute } from 'astro';
import { isAnalyzing, getQueueLength } from '../../lib/corrections';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const { initDB, getPendingMessages, getCorrectionsByPattern, getNewCorrectionsSince } = await import('../../lib/database');
    await initDB();

    const sinceParam = url.searchParams.get('since');
    const sinceId = sinceParam ? parseInt(sinceParam, 10) : 0;

    if (sinceId > 0) {
      const newCorrections = await getNewCorrectionsSince(sinceId);
      return new Response(JSON.stringify({
        newCorrections,
        queueLength: getQueueLength(),
        analyzing: isAnalyzing(),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pending = await getPendingMessages();
    const corrections = await getCorrectionsByPattern();

    return new Response(JSON.stringify({
      corrections,
      unanalyzed: pending.length,
      analyzing: isAnalyzing(),
      queueLength: getQueueLength(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg, corrections: [], unanalyzed: 0, analyzing: false, queueLength: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
