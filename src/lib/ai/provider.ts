// The seam the parse route pivots on. Everything below the model call —
// amount/timezone normalisation, cancellation sanitation, shape validation — is
// the same whoever answered; only "turn one request into the model's text plus
// its token usage" differs between vendors. Isolating it here makes switching
// subscriptions an env change (AI_PROVIDER=…), not a code change.
//
// Most vendors (OpenAI, Poe, OpenRouter, Groq, Azure, a local Ollama) speak the
// SAME OpenAI chat-completions dialect and differ only by base URL / key / model
// — so one adapter serves them all (openai.ts). Anthropic's native /v1/messages
// API is the one meaningful outlier (different auth header, top-level `system`,
// a different image block), so it gets its own adapter (anthropic.ts).

import { openAICompatibleProvider } from "./openai";
import { anthropicProvider } from "./anthropic";

export type ParseRequest = {
  system: string;
  // The user-turn instruction ("Parse this booking document…", plus any trip
  // context). For the text path it is prepended to the extracted document text;
  // for the image path it rides alongside the image block.
  instruction: string;
  // Exactly one of these is set: extracted PDF text, or a screenshot for vision.
  text?: string;
  image?: { mimeType: string; base64: string };
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

// `usage` is null when the vendor doesn't report it (some OpenAI-compatible
// shims omit it); the cost line is simply skipped rather than guessed.
export type ParseResult = { content: string; usage: TokenUsage | null };

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  parse(req: ParseRequest, signal: AbortSignal): Promise<ParseResult>;
}

// Vendor answered, but with a non-2xx — surfaced distinctly from a network
// timeout so the route can return the right status and log the body.
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`provider HTTP ${status}`);
    this.name = "ProviderHttpError";
  }
}

// A 2xx with no usable text content (empty choices / content array).
export class ProviderEmptyError extends Error {
  constructor() {
    super("provider returned no content");
    this.name = "ProviderEmptyError";
  }
}

// Missing/contradictory env — a deploy-time misconfiguration, distinct from a
// runtime vendor failure. The route maps this to a 500.
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

/**
 * Resolve the configured provider from env. Defaults are chosen so an untouched
 * deployment (no AI_* vars set, only POE_API_KEY) behaves EXACTLY as before:
 * Poe, claude-haiku-4.5, the same OpenAI-compatible request.
 *
 *   AI_PROVIDER  poe | openai | anthropic | openai-compatible   (default: poe)
 *   AI_API_KEY   the key; falls back to the vendor-specific key for back-compat
 *   AI_MODEL     override the model id (each provider has a sensible default)
 *   AI_BASE_URL  override the endpoint (required for openai-compatible)
 */
export function getProvider(): ModelProvider {
  const which = (process.env.AI_PROVIDER ?? "poe").trim().toLowerCase();
  const model = process.env.AI_MODEL?.trim();
  const baseUrl = process.env.AI_BASE_URL?.trim();

  switch (which) {
    case "poe": {
      const apiKey = process.env.AI_API_KEY ?? process.env.POE_API_KEY;
      if (!apiKey) throw new ProviderConfigError("missing POE_API_KEY (or AI_API_KEY)");
      return openAICompatibleProvider({
        id: "poe",
        baseUrl: baseUrl || "https://api.poe.com/v1",
        apiKey,
        model: model || "claude-haiku-4.5",
      });
    }
    case "openai": {
      const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY;
      if (!apiKey) throw new ProviderConfigError("missing OPENAI_API_KEY (or AI_API_KEY)");
      return openAICompatibleProvider({
        id: "openai",
        baseUrl: baseUrl || "https://api.openai.com/v1",
        apiKey,
        // A cheap, vision-capable default so image uploads work out of the box.
        model: model || "gpt-4o-mini",
      });
    }
    // Any other OpenAI-compatible endpoint (OpenRouter, Groq, Together, a local
    // vLLM/Ollama). Nothing is assumed — endpoint and model must be given.
    case "openai-compatible": {
      const apiKey = process.env.AI_API_KEY;
      if (!apiKey) throw new ProviderConfigError("missing AI_API_KEY");
      if (!baseUrl) throw new ProviderConfigError("openai-compatible requires AI_BASE_URL");
      if (!model) throw new ProviderConfigError("openai-compatible requires AI_MODEL");
      return openAICompatibleProvider({ id: "openai-compatible", baseUrl, apiKey, model });
    }
    case "anthropic": {
      const apiKey = process.env.AI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new ProviderConfigError("missing ANTHROPIC_API_KEY (or AI_API_KEY)");
      return anthropicProvider({ apiKey, model: model || "claude-haiku-4-5" });
    }
    default:
      throw new ProviderConfigError(`unknown AI_PROVIDER "${which}"`);
  }
}

// $ per 1M tokens, for the quick per-parse cost line only. Poe bills in compute
// points rather than tokens, so it is intentionally absent — its `usage` (when
// present) still logs, just without a dollar figure. Numbers are list prices and
// will drift; they are a rough gauge for comparing subscriptions, not billing.
const COST_PER_MTOK: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-3-5-haiku-latest": { in: 0.8, out: 4 },
};

export function estimateCostUsd(model: string, usage: TokenUsage | null): number | null {
  const rate = COST_PER_MTOK[model];
  if (!rate || !usage) return null;
  return (usage.inputTokens * rate.in + usage.outputTokens * rate.out) / 1_000_000;
}
