import { type APIRoute } from 'astro';
import '../../lib/ca-loader';

export const prerender = false;

const BACKEND = process.env.BACKEND_URL || 'https://backendfreespeek.vercel.app';

function serializeError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { message: String(err) };
  const e = err as any;
  const result: Record<string, unknown> = {
    name: e.name,
    message: e.message,
    code: e.code,
    errno: e.errno,
    syscall: e.syscall,
    address: e.address,
    port: e.port,
    stack: e.stack,
  };
  if (e.cause) result.cause = serializeError(e.cause);
  return result;
}

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
    const backendUrl = `${BACKEND}/api/validate`;
    return new Response(
      JSON.stringify({
        error: 'Network error calling backend',
        ...serializeError(err),
        backendUrl,
        nodeVersion: process.version,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};