import type { APIRoute } from 'astro';
import { suggestWord } from '../../lib/modelManager';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const sentence = body.sentence?.trim();

    if (!sentence) {
      return new Response(JSON.stringify({ error: 'No sentence provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const word = await suggestWord(sentence);
    return new Response(JSON.stringify({ word: word || '' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Suggest-word error:', error);
    return new Response(JSON.stringify({ error: 'Failed to suggest word' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
