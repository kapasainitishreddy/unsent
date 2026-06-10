// Static "meta" data — option lists the client needs to render pickers, filters,
// swatches, etc. These are constants, not user data, so they're public (no auth).
//
// The avatar-related lists (skin_tone / hair_color / glasses / expressions) are
// kept in lockstep with src/routes/avatar.js — they share the same string values
// and constraints. If you change the zod enum in avatar.js, change the matching
// list here too.

export const MOODS = [
  { id: 'happy',     name: 'Happy',     emoji: '😊' },
  { id: 'calm',      name: 'Calm',      emoji: '🌿' },
  { id: 'anxious',   name: 'Anxious',   emoji: '😰' },
  { id: 'sad',       name: 'Sad',       emoji: '😢' },
  { id: 'angry',     name: 'Angry',     emoji: '😤' },
  { id: 'tired',     name: 'Tired',     emoji: '😴' },
  { id: 'numb',      name: 'Numb',      emoji: '😶' },
  { id: 'lonely',    name: 'Lonely',    emoji: '🫂' },
  { id: 'hopeful',   name: 'Hopeful',   emoji: '🌅' },
  { id: 'overwhelmed', name: 'Overwhelmed', emoji: '🌊' },
];

// skin/hair colors are advisory swatches only — the avatar PATCH validates against
// a hex regex. We surface both the friendly name and the hex so the client can
// either send the name (and the server can map) or the hex directly. The avatar
// route accepts hex (#rrggbb), so the client sends hex.
export const SKIN_TONES = [
  { value: '#f4e3d3', name: 'Porcelain' },
  { value: '#eac4a1', name: 'Fair' },
  { value: '#dca480', name: 'Light' },
  { value: '#c18560', name: 'Medium' },
  { value: '#a06b3f', name: 'Tan' },
  { value: '#6f4423', name: 'Deep' },
];

export const HAIR_COLORS = [
  { value: '#1a1410', name: 'Black' },
  { value: '#5b3a1e', name: 'Brown' },
  { value: '#8b3a1a', name: 'Auburn' },
  { value: '#d4a85a', name: 'Blonde' },
  { value: '#9c9c9c', name: 'Gray' },
  { value: '#c8c8d0', name: 'Silver' },
  { value: '#c2410c', name: 'Red' },
  { value: '#e8e0d0', name: 'Platinum' },
];

// Must match GLASSES enum in src/routes/avatar.js
export const GLASSES = [
  { value: 'none'  },
  { value: 'round' },
  { value: 'square'},
];

// Must match EXPRESSIONS enum in src/routes/avatar.js
export const EXPRESSIONS = [
  { value: 'calm' },
  { value: 'listening' },
  { value: 'nodding' },
  { value: 'soft_smile' },
  { value: 'concerned' },
  { value: 'breathing' },
  { value: 'heart' },
  { value: 'release' },
];

export const COPING_TOOLS = [
  { id: 'breath_478',      name: '4-7-8 breath' },
  { id: 'box_breath',      name: 'Box breath' },
  { id: 'ground_54321',    name: '5-4-3-2-1 grounding' },
  { id: 'walk',            name: 'Walk' },
  { id: 'shower',          name: 'Cold shower' },
  { id: 'call_friend',     name: 'Call a friend' },
  { id: 'journal_freewrite', name: 'Freewrite' },
  { id: 'music',           name: 'Music' },
  { id: 'stretch',         name: 'Stretch' },
  { id: 'meditation',      name: 'Meditation' },
];

export default async function (fastify) {
  fastify.get('/api/meta', async () => ({
    moods: MOODS,
    skin: SKIN_TONES,
    hair: HAIR_COLORS,
    glasses: GLASSES,
    expressions: EXPRESSIONS,
    coping_tools: COPING_TOOLS,
    unsent_shapes: ['letter', 'apology', 'confession', 'goodbye', 'thank_you'],
    unsent_outcomes: ['private', 'deleted', 'sent'],
    affirmation_mood_filters: ['anxious', 'sad', 'angry', 'low', 'numb', 'hurt', 'lonely', 'tired', 'stressed'],
  }));
}
