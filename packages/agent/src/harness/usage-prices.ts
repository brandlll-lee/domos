type Price = {
  provider: string;
  model: string;
  from: string;
  verified: string;
  source: string;
  rates: [number, number, number, number];
  threshold?: number;
  long?: [number, number, number, number];
  writes?: Record<number, number>;
};

const verified = "2026-11-20";
const openai = "https://developers.openai.com/api/docs/pricing.md";
const anthropic = "https://platform.claude.com/docs/en/about-claude/pricing";
const xai = "https://docs.x.ai/developers/pricing";
const google = "https://ai.google.dev/gemini-api/docs/pricing";

export const usagePrices: Price[] = [
  ...(
    [
      ["gpt-6.2-astra", 8, 0.4, 10, 40],
      ["gpt-6.2-sol", 2, 0.1, 2.5, 10],
      ["gpt-6-astra", 10, 1, 12.5, 50],
      ["gpt-6.1-sol", 2, 0.1, 2.5, 10],
      ["gpt-6.1-terra", 1, 0.05, 1.25, 5],
      ["gpt-6-luna", 0.1, 0.01, 0.125, 0.5],
    ] as const
  ).map(
    ([model, input, cached, write, output]): Price => ({
      provider: "openai",
      model,
      from: "2026-11-20T00:00:00+08:00",
      verified,
      source: openai,
      rates: [input, cached, write, output],
      threshold: 272_001,
      long: [input * 2, cached * 2, write * 2, output * 1.5],
      writes: { 30: write, 720: write * 2 },
    }),
  ),
  ...(
    [
      ["claude-fable-5-2", 8, 0.2, 40],
      ["claude-fable-5-1", 10, 0.25, 50],
      ["claude-fable-5", 10, 1, 50],
      ["claude-opus-5-5", 4, 0.2, 20],
      ["claude-opus-5", 5, 0.5, 25],
      ["claude-opus-4-8", 5, 0.5, 25],
      ["claude-opus-4-7", 5, 0.5, 25],
      ["claude-opus-4-6", 5, 0.5, 25],
      ["claude-sonnet-5-5", 2, 0.1, 10],
      ["claude-sonnet-5", 2, 0.2, 10],
      ["claude-sonnet-4-6", 3, 0.3, 15],
      ["claude-haiku-4-5", 1, 0.1, 5],
      ["claude-haiku-5-5", 0.1, 0.01, 0.5],
    ] as const
  ).map(
    ([model, input, cached, output]): Price => ({
      provider: "anthropic",
      model,
      from: "2026-11-20T00:00:00+08:00",
      verified,
      source: anthropic,
      rates: [input, cached, input, output],
      writes: { 5: input * 1.25, 60: input * 2 },
      ...(model === "claude-haiku-5-5"
        ? { threshold: 100_001, long: [0.5, 0.05, 0.5, 2.5] as Price["rates"] }
        : {}),
    }),
  ),
  ...(["grok-4.7", "grok-4.6"] as const).map(
    (model): Price => ({
      provider: "xai",
      model,
      from: "2026-11-20T00:00:00+08:00",
      verified,
      source: xai,
      rates: [2, 0.5, 0, 6],
      threshold: 200_000,
      long: [4, 1, 0, 12],
    }),
  ),
  ...(["gemini-4-carbon", "gemini-4-argon"] as const).flatMap(
    (model): Price[] => [
      {
        provider: "google",
        model,
        from: "2026-11-20T00:00:00+08:00",
        verified,
        source: google,
        rates: [2, 0.1, 0, 10],
      },
      {
        provider: "google",
        model,
        from: "2026-12-01",
        verified,
        source: google,
        rates: [4, 0.2, 0, 20],
      },
    ],
  ),
];
