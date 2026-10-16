import type { APIRoute } from 'astro';
import { DICE_STRUCTURES, getStructureByCode, pickFallbackQuestion, pickRandomStructure, sanitizeQuestion, validateQuestion } from '../../lib/dice';
import { DICE_QUESTION_PROMPT } from '../../lib/prompts';

export const prerender = false;

function json(payload: object): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildRollResult(structure: ReturnType<typeof pickRandomStructure>, question: string): Response {
  const index = DICE_STRUCTURES.findIndex((s) => s.code === structure.code);
  return json({
    roll: index + 1,
    code: structure.code,
    label: structure.label,
    hint: structure.hint,
    question,
  });
}

export const POST: APIRoute = async ({ request }) => {
  let structure = pickRandomStructure();
  try {
    let code: string | null = null;
    try {
      const body = await request.json();
      code = body?.code ?? null;
    } catch {
      // no body: roll a random structure
    }
    structure = getStructureByCode(code) ?? structure;

    const { checkModels } = await import('../../lib/modelManager');
    const modelStatus = checkModels();

    if (modelStatus.gemma) {
      const { ensureStarted, isRunning, complete } = await import('../../lib/llamaServer');
      await ensureStarted();

      if (isRunning()) {
        const examples = structure.examples.slice(0, 2).map((example) => `- ${example}`).join('\n');
        const userPrompt = `Target grammar structure: ${structure.label} (${structure.hint}).\nExample questions in this structure:\n${examples}\nWrite one new question in this structure.`;
        const result = await complete(userPrompt, DICE_QUESTION_PROMPT, {
          n_predict: 48,
          temperature: 0.7,
          timeoutMs: 30000,
        });
        if (result) {
          let question = sanitizeQuestion(result).replace(/^["']|["']$/g, '').trim();
          if (question && !question.endsWith('?')) question += '?';
          if (question.length >= 8 && question.length < 220) {
            if (validateQuestion(structure.code, question)) {
              return buildRollResult(structure, question);
            }
            console.warn(`Dice roll: rejected off-structure question for ${structure.code}: ${question}`);
          }
        }
      }
    }

    return buildRollResult(structure, pickFallbackQuestion(structure));
  } catch (error) {
    console.error('Dice roll error:', error);
    return buildRollResult(structure, pickFallbackQuestion(structure));
  }
};
