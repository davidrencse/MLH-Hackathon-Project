// Office chatter: basic-employee SF AI slang. Add or remove lines freely.
export const SF_LINES = [
  "we're so back", "it's over", "this is so AGI-pilled", "ship it, we'll fix in prod",
  "is this a wrapper?", "feel the AGI", "just vibe code it", "who touched my prompt?",
  "context window's cooked", "we need more evals", "that's a skill issue", "LGTM 🚀",
  "can we make it agentic?", "10x engineer energy", "just add RAG", "let's 0 to 1 this",
  "ping me async", "circle back post-standup", "pre-seed, post-vibes", "is the model cooked?",
  "tokens are basically free", "my agent has an agent", "we pivoted again", "YC W27 hopefuls",
  "hallucination or feature?", "rate limited again 😭", "Waymo'd here today", "matcha + GPUs",
  "Series A is vibes", "touch grass? in this economy?", "prompt engineering is dead", "long live prompt engineering",
  "need H100s yesterday", "the vibes are immaculate", "low-key cracked", "just a thin layer on top",
  "we're default alive", "move fast, burn tokens", "it works on my agent", "demo day energy",
]
export const pickLine = (seed: number, tick: number) => SF_LINES[Math.abs(seed * 7919 + tick * 104729) % SF_LINES.length]
