import { type APIRoute } from 'astro';

export const prerender = false;

const BACKEND = process.env.BACKEND_URL || 'https://backendfreespeek.vercel.app';

export const POST: APIRoute = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON', detail: String(err) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { hwid } = body;
  if (!hwid) {
    return new Response(JSON.stringify({ error: 'No hwid provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch(`${BACKEND}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hwid }),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Network error: ${(err as any)?.message || err}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};