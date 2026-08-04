// Anthropic's native Messages API (/v1/messages) — the one vendor that doesn't
// speak the OpenAI dialect. It differs in four ways, all handled here: the key
// rides an `x-api-key` header behind a pinned `anthropic-version`, the system
// prompt is a top-level field rather than a message, images are a base64
// `source` block instead of a data-URL `image_url`, and the reply text lives at
// `content[0].text`. Everything the route does around this is identical to the
// OpenAI path.

import {
  ProviderEmptyError,
  ProviderHttpError,
  type ModelProvider,
  type ParseResult,
} from "./provider";

export function anthropicProvider(opts: { apiKey: string; model: string }): ModelProvider {
  return {
    id: "anthropic",
    model: opts.model,
    async parse(req, signal): Promise<ParseResult> {
      const userContent = req.image
        ? [
            {
              type: "image",
              source: { type: "base64", media_type: req.image.mimeType, data: req.image.base64 },
            },
            { type: "text", text: req.instruction },
          ]
        : [{ type: "text", text: `${req.instruction}\n\n---\n${req.text}` }];

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          // Required by the API. Booking JSON — even a multi-leg itinerary — sits
          // well inside this, and the reply is parsed, not shown as prose.
          max_tokens: 4096,
          temperature: 0,
          system: req.system,
          messages: [{ role: "user", content: userContent }],
        }),
        signal,
      });

      if (!res.ok) throw new ProviderHttpError(res.status, await res.text());

      const data = await res.json();
      // content is a blocks array; the first text block is the whole reply here.
      const content = data.content?.find((b: { type?: string }) => b?.type === "text")?.text;
      if (!content) throw new ProviderEmptyError();

      const u = data.usage;
      return {
        content,
        usage: u ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } : null,
      };
    },
  };
}
