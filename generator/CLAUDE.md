# generator — the LLM front-end

Turns natural language into a `Strategy` subclass. Built **last**: it is the
commodity part (the brief calls it "bolt on in an afternoon"). The defensible
value is the validation core, not this.

## Contract

- Output is a `core.Strategy` subclass — nothing special, the same contract a
  hand-written strategy fills.
- Generated code is **untrusted like any other strategy**. It goes through the
  sandbox and the full validation gate. The generator gets NO trust shortcut.
- Feed validation results back into regeneration ("rejected: lost in 4/6 forward
  windows") so the model can revise.

## Stack

- **Anthropic Claude API** (latest models) with **prompt caching** (cache the
  system prompt / contract docs / few-shot examples — they're stable across
  calls).
- Keep prompts and the `Strategy` contract in sync; the model must emit code that
  satisfies `core` exactly.

## Dependencies

Depends on `core` (the contract) and goes through `validation` + `sandbox` for
everything it produces. It must never be a way to run code that skips the gates.
