import type { APIRoute } from 'astro';
import { isDebateAnalyzing_, getDebateQueueLength } from '../../lib/fluencyCorrections';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const { initDB, getDebateCorrections, getNewDebateCorrectionsSince } = await import('../../lib/database');
    await initDB();

    const sinceParam = url.searchParams.get('since');
    const sinceId = sinceParam ? parseInt(sinceParam, 10) : 0;
    const debateIdParam = url.searchParams.get('debateId');
    const debateId = debateIdParam ? parseInt(debateIdParam, 10) : null;

    if (sinceId > 0) {
      const newCorrections = await getNewDebateCorrectionsSince(sinceId, debateId);
      return new Response(JSON.stringify({
        newCorrections,
        queueLength: getDebateQueueLength(),
        analyzing: isDebateAnalyzing_(),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const corrections = await getDebateCorrections(debateId);
    return new Response(JSON.stringify({
      corrections,
      analyzing: isDebateAnalyzing_(),
      queueLength: getDebateQueueLength(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg, corrections: [], analyzing: false, queueLength: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
