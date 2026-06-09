// AI safety layer — runs BEFORE the LLM is ever called.
// Per the brief, section 18+19+20, the AI must:
//   - validate feelings, never validate harmful actions
//   - never impersonate the uploaded person / avatar
//   - never escalate anger, encourage revenge, stalking, harassment
//   - never provide sexual content involving uploaded people
//   - detect self-harm / suicide / harm-to-others and route to crisis resources
//   - never claim to be a therapist, never diagnose
//   - encourage professional help when needed
//
// Implementation: a deterministic keyword/pattern check on the user's input.
// When a crisis category fires, we DO NOT call the LLM. We return a fixed,
// crisis-resources-shown response. Otherwise we wrap the LLM response with
// a pre/post safety frame and run a final post-check on the LLM output.

// ---- Crisis detection patterns -------------------------------------------
// Each pattern has a category and the matched trigger phrase (lowercased).
// The order matters: the most severe category wins on overlap.
const CRISIS_PATTERNS = [
  { category: 'suicide',         re: /\b(kill myself|end my life|take my life|suicide|don'?t want to live|better off dead|no reason to live)\b/i },
  { category: 'self_harm',       re: /\b(cut myself|hurt myself|harm myself|self[- ]?harm|burn myself|hit myself)\b/i },
  { category: 'immediate_danger',re: /\b(about to|going to|planning to) (hurt|kill|harm) (myself|someone|them)\b/i },
  { category: 'harm_others',     re: /\b(kill him|kill her|hurt him|hurt her|kill them|hurt them|want( to)? (kill|hurt|attack))\b/i },
  { category: 'abuse',           re: /\b(he (hits|beats|touches) me|she (hits|beats|touches) me|being abused|domestic violence|rape|sexual assault|molested)\b/i },
];

// Soft flags — not a crisis, but the LLM must be told to redirect.
const SOFT_FLAG_PATTERNS = [
  { tag: 'revenge',       re: /\b(revenge|get back at (him|her|them)|make (him|her|them) pay)\b/i },
  { tag: 'stalking',      re: /\b(stalk(ing|er)?|track (him|her|them) down|follow (him|her|them))\b/i },
  { tag: 'doxxing',       re: /\b(doxx?|expose (him|her|them) (on|to)|leak (his|her|their))\b/i },
  { tag: 'do_not_text',   re: /\b(want to text (him|her|them)|about to text (him|her|them)|texting (him|her|them) (right )?now)\b/i },
];

// Crisis resources by region. We show the US set by default; the user can
// adjust via the settings screen (future: geolocation prompt).
export const CRISIS_RESOURCES = {
  US: [
    { name: '988 Suicide & Crisis Lifeline',  detail: 'Call or text 988',                          href: 'tel:988' },
    { name: 'Crisis Text Line',               detail: 'Text HOME to 741741',                       href: 'sms:741741' },
    { name: 'Emergency Services',             detail: 'Call 911',                                  href: 'tel:911' },
    { name: 'The Trevor Project (LGBTQ+ youth)', detail: 'Call 1-866-488-7386 or text START to 678-678', href: 'tel:18664887386' },
  ],
  UK: [
    { name: 'Samaritans',                     detail: 'Call 116 123 (free, 24/7)',                 href: 'tel:116123' },
    { name: 'Emergency Services',             detail: 'Call 999',                                  href: 'tel:999' },
  ],
  IN: [
    { name: 'iCall',                          detail: 'Call 9152987821',                           href: 'tel:9152987821' },
    { name: 'Vandrevala Foundation',          detail: 'Call 1860-2662-345 (24/7)',                 href: 'tel:18602662345' },
    { name: 'Emergency Services',             detail: 'Call 112',                                  href: 'tel:112' },
  ],
};

export function detectCrisis(text) {
  if (!text || typeof text !== 'string') return null;
  for (const p of CRISIS_PATTERNS) {
    if (p.re.test(text)) return p.category;
  }
  return null;
}

export function detectSoftFlags(text) {
  if (!text || typeof text !== 'string') return [];
  return SOFT_FLAG_PATTERNS.filter(p => p.re.test(text)).map(p => p.tag);
}

// ---- Crisis response (returned verbatim; LLM is NOT called) -------------
const CRISIS_RESPONSES = {
  suicide: `I hear you, and I'm glad you said that out loud. What you're feeling sounds really heavy, and you don't have to carry it alone.

Please reach out to someone who can be with you right now:
- 988 Suicide & Crisis Lifeline — call or text 988 (US, 24/7)
- Crisis Text Line — text HOME to 741741 (US, 24/7)
- If you're in immediate danger, call 911.

You can keep writing here, but I want you to talk to a person who can help. You matter, and this feeling — even when it's this sharp — can change.`,

  self_harm: `Thank you for telling me. The urge to hurt yourself is real, and it's a sign that something is hurting, not that you deserve to be hurt.

Can you try one of these right now?
- Hold ice in your hand for as long as you can stand
- Text HOME to 741741 (Crisis Text Line) to talk to a counselor
- Move to a different room or step outside

If you feel like you might act on it, please call 988 (US) or your local emergency number. You don't have to be alone with this.`,

  immediate_danger: `Stop. Please don't act on that right now. Your safety matters more than whatever just happened.

- If you're in the US, call 911 now.
- 988 Suicide & Crisis Lifeline — call or text 988.
- If you can, move to a different location and stay with someone you trust.

I'll stay here. Write to me when you can. You're not in trouble. You're not a bad person. Please get to safety first.`,

  harm_others: `I can't help with hurting someone, even when the anger is real. The anger is telling you something important — that something has been hurt in you, too.

Can we work with the anger here, in this room, instead? Options:
- Write everything you want to say to them, then Release it (no one will see it).
- Breathe for one minute — I'll guide you.
- Tell me what they did, in your own words. I'll listen.

Hurting them won't undo what they did. It might make the world smaller. Want to write instead?`,

  abuse: `I'm really sorry. None of that is okay, and it's not your fault.

If you're safe enough to read this:
- US: National Domestic Violence Hotline 1-800-799-7233 (SAFE), or text START to 88788
- US: RAINN Sexual Assault Hotline 1-800-656-4673 (HOPE)
- UK: National Domestic Abuse Helpline 0808 2000 247
- If you're in immediate danger, call 911 / 999.

You can write here for as long as you need. You can save it, delete it, or just let it out. You're not alone.`,
};

// ---- System prompt for the LLM ----------------------------------------
// The 18 rules from the brief, plus 5 example exchanges, plus a hard
// output shape (≤ 90 words, 1-3 short paragraphs, no medical claims).
export const SYSTEM_PROMPT = `You are "Unsent Companion" — a private wellness companion inside a journaling app. You are NOT a therapist, NOT a doctor, NOT a replacement for professional help. You never diagnose. You never claim credentials.

Your only job is to help the user reflect on what they feel and gently suggest safe next steps (release, rewrite calmly, breathe, journal, talk to someone they trust). You validate feelings without validating harmful actions.

HARD RULES (you will be terminated if you break any of these):
1. Be compassionate and calm. Use short, warm sentences.
2. Validate the feeling, but do NOT validate harmful actions.
3. Never impersonate, roleplay as, or speak for the uploaded person / avatar.
4. Never reply AS the avatar. The avatar only listens; it does not speak.
5. Never escalate anger. Never encourage revenge, retaliation, "showing them", or "making them pay".
6. Never provide stalking, harassment, doxxing, or surveillance ideas.
7. Never provide violence advice, weapons instructions, or harm planning.
8. Never provide sexual content involving any uploaded or referenced person.
9. Never provide self-harm instructions or suicide methods. If the user is in immediate danger, your job is to point to crisis resources and stop.
10. Never diagnose (no "you have depression", "you have PTSD", "you have anxiety disorder"). Use feeling language, not label language.
11. Never claim to be a therapist, counselor, or medical professional.
12. Gently redirect harmful statements toward private reflection, breathing, or talking to a trusted person.
13. Help users rewrite angry messages into calmer messages when they ask.
14. Help turn vents into private journal reflections.
15. Help create affirmations only when asked.
16. Encourage a pause before sending real messages.
17. Show crisis resources if you sense self-harm, suicide, harm to others, or abuse.
18. Keep responses under 90 words. 1–3 short paragraphs. No bullet lists. No emoji.

EXAMPLES (use them as the voice and shape, do not parrot them):

User: "I hate him. I want to text him right now."
You: "That sounds really painful. You can write everything here first. You do not have to send it while the feeling is this intense. Want to release it, rewrite it calmly, or breathe for one minute?"

User: "I miss her and I feel lonely."
You: "Missing someone can feel heavy. You are allowed to feel it without chasing a reply. Write what you wish they understood, then we can turn it into a private reflection."

User: "I want revenge."
You: "I cannot help with revenge or harm. But I can help you release the anger safely and protect your peace. What hurt you the most?"

User: "I think I messed up at work today."
You: "Work stress can sit in your chest. Want to write what happened in two sentences? Sometimes getting it out is the first move, before we figure out what to do next."

OUTPUT SHAPE: 1–3 short paragraphs, total ≤ 90 words. No headings. No bullet lists. No emoji. Plain warm prose.`;

// ---- LLM call (OpenRouter-compatible) ---------------------------------
// OpenRouter is OpenAI-compatible. We send {system, user} and parse the reply.

const CRISIS_REGIONS = ['US', 'UK', 'IN'];  // user picks one in settings; default US

export async function callCompanion({
  userText,
  mood = null,
  history = [],          // [{role, content}] — last few turns
  apiKey,                 // OPENROUTER_API_KEY
  model = 'meta-llama/llama-3.3-70b-instruct:free',
  baseUrl = 'https://openrouter.ai/api/v1',
}) {
  // Step 1: crisis pre-check. If crisis, return fixed response + log.
  const crisis = detectCrisis(userText);
  if (crisis) {
    return {
      kind: 'crisis',
      crisis_category: crisis,
      text: CRISIS_RESPONSES[crisis],
      resources: CRISIS_RESOURCES[process.env.UNSENT_REGION || 'US'],
    };
  }

  // Step 2: soft flags — tell the LLM to redirect gently.
  const softFlags = detectSoftFlags(userText);

  // Step 3: call the LLM.
  if (!apiKey) {
    return {
      kind: 'mock',
      text: mockCompanionReply(userText, mood, softFlags),
      soft_flags: softFlags,
    };
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-6),                            // cap context window
    { role: 'user', content: composeUserMessage(userText, mood, softFlags) },
  ];

  let resp;
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:4000',
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
    return { kind: 'error', text: mockCompanionReply(userText, mood, softFlags), error: String(netErr) };
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return { kind: 'error', text: mockCompanionReply(userText, mood, softFlags), error: `LLM ${resp.status}: ${errText.slice(0, 200)}` };
  }

  const json = await resp.json();
  const raw = json?.choices?.[0]?.message?.content?.trim() || '';

  // Step 4: post-check the LLM output. If it crossed a line, replace it.
  const cleaned = postClean(raw, softFlags);

  return { kind: 'llm', text: cleaned, soft_flags: softFlags };
}

function composeUserMessage(text, mood, softFlags) {
  let msg = text;
  if (mood) msg = `[User mood: ${mood}]\n${msg}`;
  if (softFlags.length) msg = `[Private notes: gently redirect away from: ${softFlags.join(', ')}]\n${msg}`;
  return msg;
}

function postClean(text, softFlags) {
  if (!text) return mockCompanionReply('', null, softFlags);

  // Strip anything that tries to give instructions for harm.
  const forbidden = [
    /\bhere'?s how to (hurt|kill|harm|stalk|track|dox|expose)/i,
    /\b(revenge ideas?|ways to (hurt|get back at))/i,
    /\b(buy a (gun|knife|weapon)|where to (buy|find) a)/i,
    /\b(suicide method|how to kill yourself)/i,
  ];
  for (const re of forbidden) {
    if (re.test(text)) return mockCompanionReply('', null, softFlags);
  }

  // Cap length: 110 words safety cap (in case the model runs hot).
  const words = text.split(/\s+/);
  if (words.length > 110) return words.slice(0, 100).join(' ') + '…';

  return text;
}

// ---- Mock companion (used when no API key) -----------------------------
// The brief's example responses are the gold standard; we lean on them
// plus a small set of mood-conditional branches so the app feels alive
// even without a key.
function mockCompanionReply(userText, mood, softFlags = []) {
  const t = (userText || '').toLowerCase();

  // 1. Hard-coded from brief's section 19 (the example responses)
  if (/hate (him|her|them)/.test(t) || /want to text/.test(t)) {
    return 'That sounds really painful. You can write everything here first. You do not have to send it while the feeling is this intense. Want to release it, rewrite it calmly, or breathe for one minute?';
  }
  if (/miss (him|her|them)/.test(t) || /lonely/.test(t)) {
    return 'Missing someone can feel heavy. You are allowed to feel it without chasing a reply. Write what you wish they understood, then we can turn it into a private reflection.';
  }
  if (softFlags.includes('revenge')) {
    return 'I cannot help with revenge or harm. But I can help you release the anger safely and protect your peace. What hurt you the most?';
  }

  // 2. Mood-conditional branches
  if (mood === 'anxious' || /anxious|anxiety|panic|overwhelm/.test(t)) {
    return 'Anxiety can feel like everything is closing in. You don\'t have to solve it right now. Try one slow breath with me — in for four, out for six — and then write down the one thing that\'s loudest in your head.';
  }
  if (mood === 'angry' || /angry|mad|furious|pissed/.test(t)) {
    return 'The anger is real and it\'s telling you something. You don\'t have to send it or fix it yet. Write it raw here — I\'ll hold it with you. When you\'re ready, we can soften it into something you keep for yourself.';
  }
  if (mood === 'sad' || /sad|crying|tearful|hurts/.test(t)) {
    return 'Sadness this deep deserves to be felt, not fixed. You don\'t have to be okay right now. Want to write what happened, or would you rather just sit with it for a minute?';
  }
  if (mood === 'lonely' || /alone|nobody|none/.test(t)) {
    return 'Loneliness is painful in a quiet way. I\'m here, and so is this space. Write what you wish someone would say to you right now — and then we can start there.';
  }
  if (mood === 'hopeful' || /hopeful|optimistic|good day/.test(t)) {
    return 'I\'m glad something felt lighter today. Hold onto that. What is one small thing you want to protect about this moment?';
  }
  if (mood === 'grateful' || /grateful|thankful/.test(t)) {
    return 'Gratitude like that is worth naming. What is one thing you want to carry into tomorrow from today?';
  }

  // 3. Generic but warm fallback
  return 'I\'m listening. Take your time. You can say as much or as little as you want, and nothing leaves this room.';
}
