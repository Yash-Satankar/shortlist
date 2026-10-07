# ADR 0007: AI is bring-your-own-key, with cost controls in one place

Status: accepted

## Decision
- Users add their own provider keys (Anthropic, Groq, Together, or any OpenAI-compatible endpoint). Keys are encrypted, never returned, validated with a free call, and deletable. A public instance runs with no shared keys; instance keys (self-hosting) serve admins only.
- Every model call goes through one function, `runLlm`, which in order: checks the feature switches, limits the input size, checks the per-user cache, enforces the monthly cap (in the user's currency), rate-limits, calls the provider, validates the JSON output against a schema, and logs tokens and estimated cost.
- Cheap tasks (reading job pages, sorting emails) default to small models; writing tasks (prep packs, chat) to strong ones. Models, provider order and prices are env-tunable, and users can pick a model per task.
- Prep packs show the estimated cost before every generation. Answers built from decrypted emails are never cached.

## Consequences
No surprise bills, no vendor lock-in, and the app works fully without any key (the AI features are simply hidden).
