// The OpenAI chat-completions adapter — and, because the dialect is shared, the
// adapter for Poe, OpenRouter, Groq, Azure OpenAI and a local Ollama/vLLM too.
// They differ only by base URL, key and model id, all injected here; the request
// body below is byte-for-byte what the parse route sent Poe before this existed,
// so the default (Poe) path is unchanged.

import {
  ProviderEmptyError,
  ProviderHttpError,
  type ModelProvider,
  type ParseResult,
} from "./provider";

export function openAICompatibleProvider(opts: {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): ModelProvider {
  // Tolerate a trailing slash in a user-supplied AI_BASE_URL so we don't emit
  // "…/v1//chat/completions".
  const base = opts.baseUrl.replace(/\/+$/, "");
  return {
    id: opts.id,
    model: opts.model,
    async parse(req, signal): Promise<ParseResult> {
      const userContent = req.image
        ? [
            {
              type: "image_url",
              image_url: { url: `data:${req.image.mimeType};base64,${req.image.base64}` },
            },
            { type: "text", text: req.instruction },
          ]
        : [{ type: "text", text: `${req.instruction}\n\n---\n${req.text}` }];

      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: userContent },
          ],
          stream: false,
          temperature: 0,
        }),
        signal,
      });

      if (!res.ok) throw new ProviderHttpError(res.status, await res.text());

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new ProviderEmptyError();

      const u = data.usage;
      return {
        content,
        usage: u
          ? { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 }
          : null,
      };
    },
  };
}
