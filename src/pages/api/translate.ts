import type { APIRoute } from 'astro';
declare const process: any;

export const prerender = false;

const MAX_TEXT_LENGTH = 500;

export const POST: APIRoute = async ({ request }) => {
  let text = '';
  try {
    const body = await request.json();
    text = body.text?.trim() ?? '';

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

    // Bypass TLS UNABLE_TO_GET_ISSUER_CERT_LOCALLY solo para api.mymemory (https) - scoped
    const prevReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    let translated: string | null = null;
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|es`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`MyMemory ${res.status}`);
      const data = (await res.json()) as {
        responseStatus?: number;
        responseData?: { translatedText?: string };
        responseDetails?: string;
      };
      if (data.responseStatus !== 200) throw new Error(data.responseDetails || 'MyMemory failed');
      const t = data.responseData?.translatedText?.trim() ?? '';
      if (!t) throw new Error('Empty MyMemory translation');
      translated = t;
    } finally {
      if (prevReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevReject;
    }
    if (!translated) throw new Error('MyMemory empty');

    return new Response(JSON.stringify({ translated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[translate] failed', {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : typeof error,
      cause: error instanceof Error ? ((error as any).cause?.message ?? String((error as any).cause ?? '')) : undefined,
      causeCode: error instanceof Error ? (error as any).cause?.code : undefined,
      causeStack: error instanceof Error ? (error as any).cause?.stack?.slice(0, 500) : undefined,
      stack: error instanceof Error ? error.stack?.slice(0, 800) : undefined,
      url: `https://api.mymemory.translated.net/get?q=${encodeURIComponent((typeof text === 'string' ? text.slice(0, 30) : ''))}&langpair=en|es`,
      textLen: typeof text === 'string' ? text.length : 0,
    });
    return new Response(JSON.stringify({ error: 'Translation failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
