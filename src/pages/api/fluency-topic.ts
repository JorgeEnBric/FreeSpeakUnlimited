import type { APIRoute } from 'astro';
import { FLUENCY_DEBATE_PROMPT } from '../../lib/prompts';

export const prerender = false;

const CATEGORIES = [
  'work and careers',
  'money and saving',
  'family',
  'friendship',
  'romantic relationships',
  'food and diet',
  'travel',
  'cities and transport',
  'housing and rent',
  'sports and exercise',
  'music and concerts',
  'films and series',
  'advertising and consumerism',
  'privacy and data',
  'health and habits',
  'pets and animals',
  'environment in daily life',
  'school vs real life',
  'crime and punishment',
  'technology (devices, internet, AI)',
  'social media',
  'ageing and pensions',
];

const FALLBACK_TOPICS_BY_CATEGORY: Record<string, string[]> = {
  'work and careers': [
    'Is a high salary more important than enjoying your job?',
    'Should everyone have the right to work only four days a week?',
    'Is changing jobs often a sign of ambition or instability?',
  ],
  'money and saving': [
    'Is it better to save money or spend it on experiences?',
    'Should schools teach children how to manage money?',
    'Does money buy happiness?',
  ],
  'family': [
    'Should adult children live with their parents until their thirties?',
    'Is it a duty to take care of your parents when they get old?',
    'Do families spend enough time together nowadays?',
  ],
  friendship: [
    'Can men and women really be just friends?',
    'Is it better to have a few close friends or many casual ones?',
    'Should you tell a friend an unpleasant truth, even if it hurts?',
  ],
  'romantic relationships': [
    'Is love enough to make a relationship last?',
    'Should couples share all their passwords?',
    'Is it acceptable to break up with someone by message?',
  ],
  'food and diet': [
    'Should fast food be taxed more heavily?',
    'Is vegetarianism the most ethical choice for the future?',
    'Do people eat too much processed food out of laziness?',
  ],
  travel: [
    'Is tourism destroying the places people love to visit?',
    'Should rich countries pay for the damage their flights cause?',
    'Is travelling more valuable than studying?',
  ],
  'cities and transport': [
    'Should city centres ban private cars completely?',
    'Is living in a big city better than living in a village?',
    'Should public transport be free for everyone?',
  ],
  'housing and rent': [
    'Should young people receive help to pay their first rent?',
    'Is owning a home more important than travelling?',
    'Should cities limit the number of tourist apartments?',
  ],
  'sports and exercise': [
    'Should professional athletes earn less than doctors or teachers?',
    'Is competitive sport too aggressive for children?',
    'Do video games count as a real sport?',
  ],
  'music and concerts': [
    'Should streaming services pay artists more fairly?',
    'Is live music better than listening at home?',
    'Does modern pop music have less value than older music?',
  ],
  'films and series': [
    'Are remakes killing originality in cinema?',
    'Do series teach more than films?',
    'Should violent films be banned for teenagers?',
  ],
  'advertising and consumerism': [
    'Should advertising to children be illegal?',
    'Do people buy things they do not need because of influencers?',
    'Are Black Friday discounts a real benefit for consumers?',
  ],
  'privacy and data': [
    'Is giving up privacy worth the convenience of free apps?',
    'Should employers be allowed to check what employees post online?',
    'Do security cameras make cities safer or just more watched?',
  ],
  'health and habits': [
    'Should sugary drinks be banned for children?',
    'Is sleeping less a sign of being productive?',
    'Should the state promote sports instead of treating illness?',
  ],
  'pets and animals': [
    'Is buying a pet from a shop wrong when shelters are full?',
    'Should owners be allowed to take dogs everywhere?',
    'Is it ethical to keep wild animals as pets?',
  ],
  'environment in daily life': [
    'Should single-use plastic be banned completely?',
    'Is it realistic to expect everyone to recycle?',
    'Should people pay a tax for throwing away food?',
  ],
  'school vs real life': [
    'Should schools teach practical skills like taxes and cooking?',
    'Is university education overrated for many careers?',
    'Do exams measure intelligence or just memory?',
  ],
  'crime and punishment': [
    'Should serious criminals lose the right to vote?',
    'Is prison the best way to reduce crime?',
    'Should teenagers be treated as adults by the law?',
  ],
  'technology (devices, internet, AI)': [
    'Should children under twelve have their own smartphone?',
    'Is AI making people too dependent on machines?',
    'Does technology bring people closer together or push them apart?',
  ],
  'social media': [
    'Should social media require a minimum age of sixteen?',
    'Is life better before social media?',
    'Should likes and followers be hidden to protect mental health?',
  ],
  'ageing and pensions': [
    'Should the retirement age keep rising?',
    'Is it fair that young people will support a growing elderly population?',
    'Should elderly people live with their families instead of in homes?',
  ],
};

const CATEGORY_NAMES = Object.keys(FALLBACK_TOPICS_BY_CATEGORY);

// Rotating category index: next call always gets a different category.
let categoryRotation = Math.floor(Math.random() * CATEGORIES.length);

function pickCategory(): string {
  categoryRotation = (categoryRotation + 1) % CATEGORIES.length;
  return CATEGORIES[categoryRotation];
}

function fallbackTopic(category: string): string {
  const pool = FALLBACK_TOPICS_BY_CATEGORY[category];
  if (pool && pool.length) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const anyCategory = CATEGORY_NAMES[Math.floor(Math.random() * CATEGORY_NAMES.length)];
  const anyPool = FALLBACK_TOPICS_BY_CATEGORY[anyCategory];
  return anyPool[Math.floor(Math.random() * anyPool.length)];
}

export const POST: APIRoute = async () => {
  try {
    const { checkModels } = await import('../../lib/modelManager');
    const modelStatus = checkModels();

    const category = pickCategory();

    if (!modelStatus.gemma) {
      const topic = fallbackTopic(category);
      return new Response(JSON.stringify({ topic, category }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { ensureStarted, isRunning, complete } = await import('../../lib/llamaServer');
    await ensureStarted();

    if (isRunning()) {
      const prompt = FLUENCY_DEBATE_PROMPT.replace('{category}', category);
      const result = await complete('', prompt, { n_predict: 40, temperature: 0.8, timeoutMs: 30000 });
      if (result) {
        let topic = result.trim().replace(/^["']|["']$/g, '').trim();
        if (!topic.endsWith('?')) topic += '?';
        if (topic.length > 5 && topic.length < 300) {
          return new Response(JSON.stringify({ topic, category }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    const topic = fallbackTopic(category);
    return new Response(JSON.stringify({ topic, category }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Fluency topic error:', error);
    const category = pickCategory();
    const topic = fallbackTopic(category);
    return new Response(JSON.stringify({ topic, category }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async () => {
  return POST({ request: new Request('http://localhost', { method: 'POST' }) } as any);
};
