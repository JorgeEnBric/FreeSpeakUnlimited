import type { APIRoute } from 'astro';
import { FLUENCY_DEBATE_PROMPT } from '../../lib/prompts';

export const prerender = false;

const FALLBACK_TOPICS = [
  'Should artificial intelligence replace teachers in schools?',
  'Is remote work more productive than office work?',
  'Should governments ban single-use plastics completely?',
  'Is social media harmful to teenage mental health?',
  'Should university education be free for everyone?',
  'Is climate change the most urgent global issue?',
  'Should animals be used for scientific testing?',
  'Is online learning as effective as classroom learning?',
  'Should cities ban private cars in city centers?',
  'Is universal basic income a good idea?',
];

export const POST: APIRoute = async () => {
  try {
    const { checkModels } = await import('../../lib/modelManager');
    const modelStatus = checkModels();

    if (!modelStatus.gemma) {
      const topic = FALLBACK_TOPICS[Math.floor(Math.random() * FALLBACK_TOPICS.length)];
      return new Response(JSON.stringify({ topic }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { ensureStarted, isRunning, complete } = await import('../../lib/llamaServer');
    await ensureStarted();

    if (isRunning()) {
      const result = await complete('', FLUENCY_DEBATE_PROMPT, { n_predict: 40, temperature: 0.8, timeoutMs: 30000 });
      if (result) {
        let topic = result.trim().replace(/^["']|["']$/g, '').trim();
        if (!topic.endsWith('?')) topic += '?';
        if (topic.length > 5 && topic.length < 300) {
          return new Response(JSON.stringify({ topic }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    const topic = FALLBACK_TOPICS[Math.floor(Math.random() * FALLBACK_TOPICS.length)];
    return new Response(JSON.stringify({ topic }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Fluency topic error:', error);
    const topic = FALLBACK_TOPICS[Math.floor(Math.random() * FALLBACK_TOPICS.length)];
    return new Response(JSON.stringify({ topic }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async () => {
  return POST({ request: new Request('http://localhost', { method: 'POST' }) } as any);
};
