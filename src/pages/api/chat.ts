import type { APIRoute } from 'astro';
import { checkModels, generateResponse } from '../../lib/modelManager';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const text = body.text?.trim();
    const startTime = body.startTime ? Number(body.startTime) : null;

    if (!text) {
      return new Response(JSON.stringify({ error: 'No text provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const modelStatus = checkModels();

    const t0 = Date.now();
    let responseText: string;

    if (modelStatus.gemma) {
      responseText = await generateResponse(text);
    } else {
      const responses = [
        "That's great! Can you tell me more about that?",
        "I hear you! Let's practice another sentence together.",
        "Good job! Keep practicing your English speaking skills.",
        "Interesting point! How would you say that in a different way?",
        "Excellent! You're making great progress with your English."
      ];
      responseText = responses[Math.floor(Math.random() * responses.length)];
    }

    const modelMs = Date.now() - t0;
    console.log(`Tiempo en modelo IA: ${Math.round(modelMs / 1000)} segundos`);
    if (startTime) {
      console.log(`Tiempo total: ${Math.round((Date.now() - startTime) / 1000)} segundos`);
    }

    return new Response(JSON.stringify({ response: responseText }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Chat error:', error);
    return new Response(JSON.stringify({ error: 'Failed to process message' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
