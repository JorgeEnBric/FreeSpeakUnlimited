import type { APIRoute } from 'astro';

export const prerender = false;

const MAX_TEXT_LENGTH = 500;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const text = body.text?.trim();

    if (!text) {
      return new Response(JSON.stringify({ error: 'No text provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return new Response(JSON.stringify({ error: 'Text too long' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Translate API error: ${res.status}`);
    }

    const data = await res.json();
    const translated = (data?.[0] || [])
      .map((segment: unknown[]) => segment?.[0] ?? '')
      .join('');

    return new Response(JSON.stringify({ translated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error translating text:', error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: 'Translation failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
