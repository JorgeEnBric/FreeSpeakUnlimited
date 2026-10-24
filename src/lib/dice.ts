export interface DiceStructure {
  code: string;
  label: string;
  hint: string;
  examples: string[];
}

export const DICE_STRUCTURES: DiceStructure[] = [
  {
    code: 'present_simple',
    label: 'Present Simple',
    hint: 'base verb / verb + s for habits, routines and facts',
    examples: [
      'What do you usually do on weekends?',
      'How often do you exercise?',
      'What time do you normally wake up?',
    ],
  },
  {
    code: 'present_continuous',
    label: 'Present Continuous',
    hint: 'am / is / are + verb-ing for actions happening now',
    examples: [
      'What are you doing right now?',
      'What are you wearing today?',
      'Who are you living with at the moment?',
    ],
  },
  {
    code: 'past_simple',
    label: 'Past Simple',
    hint: 'verb-ed / irregular past for finished actions',
    examples: [
      'What did you do yesterday?',
      'Where did you go on your last holiday?',
      'What did you eat for breakfast this morning?',
    ],
  },
  {
    code: 'past_continuous',
    label: 'Past Continuous',
    hint: 'was / were + verb-ing for actions in progress in the past',
    examples: [
      'What were you doing at eight o’clock last night?',
      'What were you thinking about on your way here?',
      'What were you doing when you heard the news?',
    ],
  },
  {
    code: 'present_perfect',
    label: 'Present Perfect',
    hint: 'have / has + past participle for experiences and results',
    examples: [
      'Have you ever travelled abroad?',
      'What is the best film you have ever seen?',
      'How long have you lived in your city?',
    ],
  },
  {
    code: 'present_perfect_continuous',
    label: 'Present Perfect Continuous',
    hint: 'have / has been + verb-ing for ongoing duration',
    examples: [
      'What have you been working on lately?',
      'How long have you been learning English?',
      'What have you been doing this week?',
    ],
  },
  {
    code: 'future_will',
    label: 'Future (Will)',
    hint: 'will + base verb for predictions and spontaneous decisions',
    examples: [
      'What do you think you will do next weekend?',
      'What will the weather be like tomorrow?',
      'How will technology change in ten years?',
    ],
  },
  {
    code: 'future_going_to',
    label: 'Future (Going to)',
    hint: 'am / is / are going to + verb for plans and intentions',
    examples: [
      'What are you going to do after this lesson?',
      'Where are you going to travel next?',
      'What are you going to have for dinner tonight?',
    ],
  },
  {
    code: 'passive_voice',
    label: 'Passive Voice',
    hint: 'be + past participle when the action matters more than the doer',
    examples: [
      'How is coffee made in your country?',
      'When was your city founded?',
      'What is your favourite meal made with?',
    ],
  },
  {
    code: 'comparative_superlative',
    label: 'Comparative and Superlative',
    hint: 'comparatives (-er / more) and superlatives (-est / most)',
    examples: [
      'What is the best city you have visited?',
      'Is it better to live in the city or the countryside?',
      'Who is the funniest person you know?',
    ],
  },
  {
    code: 'direct_questions',
    label: 'Direct Questions',
    hint: 'questions beginning with a question word (what, where, when...)',
    examples: [
      'Where did you grow up?',
      'What kind of music do you like?',
      'When do you feel most productive?',
    ],
  },
  {
    code: 'indirect_questions',
    label: 'Indirect Questions',
    hint: 'polite embedded questions (Could you tell me...? Do you know...?)',
    examples: [
      'Could you tell me where you are from?',
      'Do you know what time it is?',
      'Can you explain how you got here today?',
    ],
  },
];

export const DICE_FALLBACK_ANSWERS: Record<string, string[]> = {
  present_simple: ['On weekends I usually relax at home and meet my friends.', 'I normally wake up early and go for a short run.'],
  present_continuous: ['Right now I am answering your question and thinking about my day.', 'At the moment I am sitting at my desk with a cup of coffee.'],
  past_simple: ['Yesterday I went to the park and met an old friend.', 'Last weekend I stayed home and watched a good film.'],
  past_continuous: ['At eight o’clock last night I was cooking dinner.', 'I was walking home when I heard the news.'],
  present_perfect: ['I have travelled to several countries in Europe.', 'I have never tried sushi, but I would love to.'],
  present_perfect_continuous: ['I have been learning English for about three years.', 'Lately I have been working on a new project at home.'],
  future_will: ['I think I will visit my family next weekend.', 'I will probably stay home tomorrow if it rains.'],
  future_going_to: ['After this lesson I am going to cook something nice.', 'I am going to travel to the coast next month.'],
  passive_voice: ['Coffee is made from roasted beans.', 'My city was founded more than two hundred years ago.'],
  comparative_superlative: ['The best city I have visited is Lisbon.', 'I think it is better to live in the countryside.'],
  direct_questions: ['I grew up in a small town near the mountains.', 'I like rock music and a bit of jazz.'],
  indirect_questions: ['I am from a small town near the coast.', 'I think it is about half past nine.'],
};

export function getStructureByCode(code: string | null | undefined): DiceStructure | null {
  if (!code) return null;
  return DICE_STRUCTURES.find((s) => s.code === code) ?? null;
}

export function pickRandomStructure(): DiceStructure {
  return DICE_STRUCTURES[Math.floor(Math.random() * DICE_STRUCTURES.length)];
}

export function pickFallbackQuestion(structure: DiceStructure): string {
  const list = structure.examples;
  return list[Math.floor(Math.random() * list.length)];
}

export function pickFallbackAnswers(structure: DiceStructure, count = 2): string[] {
  const list = DICE_FALLBACK_ANSWERS[structure.code] ?? [];
  return list.slice(0, count);
}

export function sanitizeQuestion(raw: string): string {
  let question = (raw ?? '').trim();
  const firstLine = question.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
  question = firstLine ?? '';
  question = question.replace(/`/g, '').replace(/[*_]/g, '');
  const questionMark = question.indexOf('?');
  if (questionMark !== -1) question = question.slice(0, questionMark + 1);
  return question.replace(/\s+/g, ' ').trim();
}

const PARTICIPLES =
  '(?:\\w+ed|born|made|built|founded|written|done|given|taken|seen|known|shown|used|sold|told|held|kept|left|sent|paid|met|read|put|cut|bought|brought|taught|caught|thought|found|eaten|spoken|chosen|broken|driven|frozen|stolen|worn|won|sung|swum|rung|thrown|grown|blown|flown|drawn)';

function isContinuous(question: string): boolean {
  return /\b(am|is|are|was|were)\b[^.?!]*\b\w+ing\b/i.test(question);
}

function isPerfectContinuous(question: string): boolean {
  return /\b(have|has)\b[^.?!]*\bbeen\b[^.?!]*\b\w+ing\b/i.test(question);
}

function isPresentPerfect(question: string): boolean {
  return new RegExp(`\\b(have|has)\\b[^.?!]*\\b${PARTICIPLES}\\b`, 'i').test(question);
}

function isPast(question: string): boolean {
  return /\b(did|was|were)\b/i.test(question);
}

function isPassive(question: string): boolean {
  return new RegExp(`\\b(am|is|are|was|were|be|been|being|get|gets|got|gotten)\\b[^.?!]*\\b${PARTICIPLES}\\b`, 'i').test(question);
}

const QUESTION_VALIDATORS: Record<string, (question: string) => boolean> = {
  present_simple: (q) => !(isContinuous(q) || isPerfectContinuous(q) || isPresentPerfect(q) || /\bwill\b/i.test(q) || /\b(going to|gonna)\b/i.test(q) || isPast(q)),
  present_continuous: (q) => /\b(am|is|are)\b[^.?!]*\b\w+ing\b/i.test(q),
  past_simple: (q) => isPast(q) && !/\b(was|were)\b[^.?!]*\b\w+ing\b/i.test(q) && !/\bhave\b/i.test(q),
  past_continuous: (q) => /\b(was|were)\b[^.?!]*\b\w+ing\b/i.test(q),
  present_perfect: (q) => /\b(have|has)\b/i.test(q) && !isPerfectContinuous(q),
  present_perfect_continuous: (q) => isPerfectContinuous(q),
  future_will: (q) => /\bwill\b/i.test(q) && !/\b(going to|gonna)\b/i.test(q),
  future_going_to: (q) => /\b(going to|gonna)\b/i.test(q),
  passive_voice: (q) => isPassive(q),
  comparative_superlative: (q) => /\b(more|most|less|least|better|best|worse|worst)\b/i.test(q) || /\b\w+est\b/i.test(q) || /\bthan\b/i.test(q),
  direct_questions: (q) => /^(what|where|when|why|who|whom|whose|which|how)\b/i.test(q.trim()),
  indirect_questions: (q) => /^(could|can|would|do you know|do you happen|do you remember|i wonder|would you mind|is there any chance|have you any idea)\b/i.test(q.trim()),
};

export function validateQuestion(code: string, question: string): boolean {
  const validator = QUESTION_VALIDATORS[code];
  if (!validator) return true;
  const trimmed = (question ?? '').trim();
  if (!trimmed) return false;
  return validator(trimmed);
}
