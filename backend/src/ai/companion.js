// AI safety layer + companion call for Unsent.
//
// Two phases of safety, both deterministic and reviewable:
//
//   1. CRISIS PRE-CHECK on user input. If a crisis category fires, we do
//      not call the LLM. We return a fixed response + resources.
//   2. POST-CLEAN on LLM output. The model can still slip; we strip
//      em dashes, emoji, bullet lists, and any banned coaching / therapy
//      language. If banned content is found, we return a safe fallback.
//
// Memory:
//   We pull short, non-clinical cues from the user's recent vents and
//   unsent messages and pass them to the model as "things you remember".
//   The model can choose to bring them up. We do not pull journal entries
//   or mood logs (too clinical). We do not include identifying details
//   beyond roles (mom, ex, boss). Everything is per-user and scoped to
//   the authenticated user only.

import { SYSTEM_PROMPT, composeUserMessage, postClean } from './prompts.js';

// ---- Crisis detection patterns ----------------------------------------
// Each pattern has a category. The first match wins (most severe first).
const CRISIS_PATTERNS = [
  { category: 'suicide',          re: /\b(kill myself|end my life|take my life|suicide|don'?t want to live|better off dead|no reason to live)\b/i },
  { category: 'self_harm',        re: /\b(cut myself|hurt myself|harm myself|self[- ]?harm|burn myself|hit myself)\b/i },
  { category: 'immediate_danger', re: /\b(about to|going to|planning to) (hurt|kill|harm) (myself|someone|them)\b/i },
  { category: 'harm_others',      re: /\b(kill him|kill her|hurt him|hurt her|kill them|hurt them|want( to)? (kill|hurt|attack))\b/i },
  { category: 'abuse',            re: /\b(he (hits|beats|touches) me|she (hits|beats|touches) me|being abused|domestic violence|rape|sexual assault|molested)\b/i },
];

const SOFT_FLAG_PATTERNS = [
  { tag: 'revenge',     re: /\b(revenge|get back at (him|her|them)|make (him|her|them) pay)\b/i },
  { tag: 'stalking',    re: /\b(stalk(ing|er)?|track (him|her|them) down|follow (him|her|them))\b/i },
  { tag: 'doxxing',     re: /\b(doxx?|expose (him|her|them) (on|to)|leak (his|her|their))\b/i },
  { tag: 'do_not_text', re: /\b(want to text (him|her|them)|about to text (him|her|them)|texting (him|her|them) (right )?now)\b/i },
];

// Crisis resources by region. Shown only when crisis is detected.
export const CRISIS_RESOURCES = {
  US: [
    { name: '988 Suicide & Crisis Lifeline',     detail: 'Call or text 988',                              href: 'tel:988' },
    { name: 'Crisis Text Line',                  detail: 'Text HOME to 741741',                           href: 'sms:741741' },
    { name: 'Emergency Services',                detail: 'Call 911',                                      href: 'tel:911' },
    { name: 'The Trevor Project (LGBTQ+ youth)', detail: 'Call 1-866-488-7386 or text START to 678-678',  href: 'tel:18664887386' },
  ],
  UK: [
    { name: 'Samaritans',        detail: 'Call 116 123 (free, 24/7)',  href: 'tel:116123' },
    { name: 'Emergency Services', detail: 'Call 999',                  href: 'tel:999' },
  ],
  IN: [
    { name: 'iCall',                  detail: 'Call 9152987821',           href: 'tel:9152987821' },
    { name: 'Vandrevala Foundation',   detail: 'Call 1860-2662-345 (24/7)',  href: 'tel:18602662345' },
    { name: 'Emergency Services',     detail: 'Call 112',                   href: 'tel:112' },
  ],
};

export function detectCrisis(text) {
  if (!text || typeof text !== 'string') return null;
  for (const p of CRISIS_PATTERNS) if (p.re.test(text)) return p.category;
  return null;
}

export function detectSoftFlags(text) {
  if (!text || typeof text !== 'string') return [];
  return SOFT_FLAG_PATTERNS.filter(p => p.re.test(text)).map(p => p.tag);
}

// ---- Crisis responses (fixed, no LLM) --------------------------------
const CRISIS_RESPONSES = {
  suicide: `I hear you. I am glad you said it out loud, and I am not going anywhere. What you are feeling sounds really heavy, and you do not have to carry it alone.

Please reach out to a person who can be with you right now.
- 988 Suicide and Crisis Lifeline. Call or text 988 (US, 24/7).
- Crisis Text Line. Text HOME to 741741 (US, 24/7).
- If you are in immediate danger, call 911.

You can keep writing to me, but I want you to talk to a person who can help. You matter, and this feeling, even when it is this sharp, can change.`,

  self_harm: `Thank you for telling me. The urge to hurt yourself is real, and it is a sign that something is hurting, not that you deserve to be hurt.

Can you try one of these right now.
- Hold ice in your hand for as long as you can stand.
- Text HOME to 741741 to talk to a counselor.
- Move to a different room or step outside.

If you feel like you might act on it, please call 988 (US) or your local emergency number. You do not have to be alone with this.`,

  immediate_danger: `Stop. Please do not act on that right now. Your safety matters more than whatever just happened.

- If you are in the US, call 911 now.
- 988 Suicide and Crisis Lifeline. Call or text 988.
- If you can, move to a different location and stay with someone you trust.

I will stay here. Write to me when you can. You are not in trouble. You are not a bad person. Please get to safety first.`,

  harm_others: `I cannot help with hurting someone, even when the anger is real. The anger is telling you something important, that something has been hurt in you too.

Can we work with the anger here, in this room, instead.
- Write everything you want to say to them, then Release it. No one will see it.
- Tell me what they did, in your own words. I will listen.

Hurting them will not undo what they did. It might make the world smaller. Want to write instead?`,

  abuse: `I am really sorry. None of that is okay, and it is not your fault.

If you are safe enough to read this.
- US: National Domestic Violence Hotline 1-800-799-7233, or text START to 88788.
- US: RAINN Sexual Assault Hotline 1-800-656-4673.
- UK: National Domestic Abuse Helpline 0808 2000 247.
- If you are in immediate danger, call 911 or 999.

You can write here for as long as you need. You can save it, delete it, or just let it out. You are not alone.`,
};

// ---- Memory extraction -----------------------------------------------
// Pull short, role-based cues from recent user content. NEVER pull
// journal entries or mood logs (too clinical, too leading). NEVER
// include names. NEVER include more than 3 cues (model gets overwhelmed).
const ROLE_RE = /\b(my (mom|mother|dad|father|sister|brother|wife|husband|girlfriend|boyfriend|partner|ex|son|daughter|kid|child|boss|manager|friend|coworker|co-worker|boyfriend|girlfriend|therapist|counselor|doctor))\b/gi;
const SHORT_PROBLEM_RE = /\b(anxious|anxiety|panic|depressed|depression|lonely|loneliness|overwhelmed|burned out|exhausted|numb|insomnia|can't sleep|grief|grieving|heartbroken)\b/i;

export function extractMemoryCues(rows = []) {
  const cues = new Set();
  const people = new Set();
  const feelings = new Set();
  for (const row of rows) {
    const text = row.body || row.title || '';
    if (!text) continue;
    let m;
    ROLE_RE.lastIndex = 0;
    while ((m = ROLE_RE.exec(text)) !== null) {
      people.add(m[1].toLowerCase());
    }
    if (SHORT_PROBLEM_RE.test(text)) {
      const f = text.match(SHORT_PROBLEM_RE);
      if (f) feelings.add(f[1].toLowerCase());
    }
  }
  for (const p of people) cues.add(`user has mentioned their ${p}`);
  for (const f of feelings) cues.add(`user has felt ${f} before`);
  return Array.from(cues).slice(0, 3);
}

// ---- Main entry point ------------------------------------------------
export async function callCompanion({
  userText,
  mood = null,
  history = [],
  memoryCues = [],
  apiKey,
  model = process.env.UNSENT_LLM_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  baseUrl = process.env.UNSENT_LLM_BASE || 'https://openrouter.ai/api/v1',
  region = process.env.UNSENT_REGION || 'US',
}) {
  // 1. Crisis pre-check
  const crisis = detectCrisis(userText);
  if (crisis) {
    return {
      kind: 'crisis',
      crisis_category: crisis,
      text: CRISIS_RESPONSES[crisis],
      resources: CRISIS_RESOURCES[region] || CRISIS_RESOURCES.US,
    };
  }

  const softFlags = detectSoftFlags(userText);

  // 2. No API key = mock mode. The mock is still a friend who remembers.
  if (!apiKey) {
    return {
      kind: 'mock',
      text: mockCompanionReply(userText, mood, softFlags, memoryCues),
      soft_flags: softFlags,
    };
  }

  // 3. Build the message list
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-6).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: composeUserMessage({ text: userText, mood, softFlags, memoryCues }) },
  ];

  // 4. Call the LLM
  let resp;
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://unsent.app',
        'X-Title': 'Unsent',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 220,
        temperature: 0.7,
        top_p: 0.9,
      }),
    });
  } catch (netErr) {
    return { kind: 'error', text: mockCompanionReply(userText, mood, softFlags, memoryCues), error: String(netErr) };
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return {
      kind: 'error',
      text: mockCompanionReply(userText, mood, softFlags, memoryCues),
      error: `LLM ${resp.status}: ${errText.slice(0, 200)}`,
    };
  }

  const json = await resp.json();
  const raw = json?.choices?.[0]?.message?.content?.trim() || '';

  // 5. Post-clean. If banned content is detected, fall back to safe response.
  const cleaned = postClean(raw);
  if (!cleaned) {
    return {
      kind: 'fallback',
      text: mockCompanionReply(userText, mood, softFlags, memoryCues),
      soft_flags: softFlags,
    };
  }

  return { kind: 'llm', text: cleaned, soft_flags: softFlags };
}

// ---- Mock companion (used when no API key) ----------------------------
// Friend voice. No em dashes. No bullet lists. No coaching. Sits with it.
function mockCompanionReply(userText, mood, softFlags = [], memoryCues = []) {
  const t = (userText || '').toLowerCase();
  const cueHit = memoryCues.find(c => c.includes('sister') || c.includes('brother') || c.includes('mom') || c.includes('dad') || c.includes('boss') || c.includes('partner') || c.includes('ex'));

  // Crisis-adjacent
  if (/hate (him|her|them)/.test(t) || /want to text/.test(t)) {
    return 'That sounds really painful. You can write everything here first. You do not have to send it while the feeling is this intense.';
  }
  if (/miss (him|her|them)/.test(t) || /lonely/.test(t)) {
    return 'Missing someone can feel heavy. You are allowed to feel it without chasing a reply. Write what you wish they understood.';
  }
  if (softFlags.includes('revenge')) {
    return 'I cannot help with revenge or harm. But I am here, and so is this space. What hurt you the most?';
  }

  // Mood-conditional (sit with it, do not coach)
  if (mood === 'anxious' || /anxious|anxiety|panic|overwhelm/.test(t)) {
    return 'Anxiety that big deserves to be felt, not solved right now. I am here. Take as long as you need.';
  }
  if (mood === 'angry' || /angry|mad|furious|pissed/.test(t)) {
    return 'The anger is real and it is telling you something. You do not have to send it or fix it yet. I am holding it with you.';
  }
  if (mood === 'sad' || /sad|crying|tearful|hurts/.test(t)) {
    return 'Sadness this deep deserves to be felt, not fixed. You do not have to be okay right now.';
  }
  if (mood === 'lonely' || /alone|nobody/.test(t)) {
    return 'Loneliness is painful in a quiet way. I am here, and so is this space.';
  }
  if (mood === 'hopeful' || /hopeful|optimistic|good day/.test(t)) {
    return 'I am glad something felt lighter today. Hold onto that.';
  }
  if (mood === 'grateful' || /grateful|thankful/.test(t)) {
    return 'Gratitude like that is worth naming. Thank you for sharing it.';
  }

  // Memory cue follow-up (only if the user has not said something specific)
  if (cueHit && t.length < 60) {
    return `I remember you mentioned that. How is it sitting with you today?`;
  }

  // Short messages: match the silence
  if (t.length < 8 || /^(idk|i don'?t know|tired|huh|ok|okay|k)\b/.test(t)) {
    return 'I am here.';
  }

  // Default
  return 'I am listening. Take your time. Nothing leaves this room.';
}
