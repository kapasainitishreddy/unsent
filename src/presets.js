// Shared preset data. Used by:
//   - src/routes/affirmations.js (POST /api/affirmations/seed-presets, idempotent)
//   - src/seed.js                      (standalone `pnpm seed` CLI for the dev user)
//
// Single source of truth. Keep them in lockstep if you add fields.

export const CATEGORIES = [
  'general', 'self_worth', 'anxiety', 'breakup', 'work', 'morning', 'night',
];

export const PRESETS = [
  { text: 'I can feel this without acting on it.',                  mood_filter: 'angry',    category: 'general' },
  { text: 'I do not need to send every thought I have.',            mood_filter: 'angry',    category: 'general' },
  { text: 'My feelings are valid, but I can choose my response.',   mood_filter: 'hurt',     category: 'general' },
  { text: 'I can miss someone and still protect my peace.',         mood_filter: 'lonely',   category: 'breakup' },
  { text: 'I am allowed to pause.',                                 mood_filter: 'anxious',  category: 'anxiety' },
  { text: 'One hard moment is not my whole life.',                  mood_filter: 'sad',      category: 'general' },
  { text: 'I am allowed to take up space.',                         mood_filter: 'hurt',     category: 'self_worth' },
  { text: 'Today, I choose one small act of care for myself.',      mood_filter: 'stressed', category: 'morning' },
  { text: 'My nervous system is doing its best. I can work with it.', mood_filter: 'anxious', category: 'anxiety' },
  { text: 'I do not have to be perfect to be loved.',               mood_filter: 'hurt',     category: 'self_worth' },
  { text: 'Rest is not laziness. It is maintenance.',               mood_filter: 'tired',    category: 'night' },
  { text: 'I release what I cannot control.',                       mood_filter: 'stressed', category: 'work' },
  { text: 'I am allowed to outgrow people who once felt safe.',     mood_filter: 'lonely',   category: 'breakup' },
  { text: 'I am the calm in my own storm.',                         mood_filter: 'anxious',  category: 'anxiety' },
  { text: 'I do not need to earn my own kindness.',                 mood_filter: 'hurt',     category: 'self_worth' },
];
