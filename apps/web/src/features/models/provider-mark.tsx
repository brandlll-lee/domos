import "./provider-mark.css";

const logos: Record<string, string> = {
  anthropic: new URL("./logos/anthropic.svg", import.meta.url).href,
  openai: new URL("./logos/openai.svg", import.meta.url).href,
  deepseek: new URL("./logos/deepseek.svg", import.meta.url).href,
  qwen: new URL("./logos/qwen.svg", import.meta.url).href,
  minimax: new URL("./logos/minimax.svg", import.meta.url).href,
  mistral: new URL("./logos/mistral.svg", import.meta.url).href,
  moonshot: new URL("./logos/moonshot.svg", import.meta.url).href,
  kimi: new URL("./logos/kimi.svg", import.meta.url).href,
  xai: new URL("./logos/xai.svg", import.meta.url).href,
  openrouter: new URL("./logos/openrouter.svg", import.meta.url).href,
  opencode: new URL("./logos/opencode.svg", import.meta.url).href,
  cerebras: new URL("./logos/cerebras.svg", import.meta.url).href,
  cloudflare: new URL("./logos/cloudflare.svg", import.meta.url).href,
  groq: new URL("./logos/groq.svg", import.meta.url).href,
  huggingface: new URL("./logos/huggingface.svg", import.meta.url).href,
  google: new URL("./logos/google.svg", import.meta.url).href,
  fireworks: new URL("./logos/fireworks.svg", import.meta.url).href,
  together: new URL("./logos/together.svg", import.meta.url).href,
  vercel: new URL("./logos/vercel.svg", import.meta.url).href,
  meta: new URL("./logos/meta.svg", import.meta.url).href,
  azure: new URL("./logos/azure.svg", import.meta.url).href,
  baseten: new URL("./logos/baseten.svg", import.meta.url).href,
  bedrock: new URL("./logos/bedrock.svg", import.meta.url).href,
  githubcopilot: new URL("./logos/githubcopilot.svg", import.meta.url).href,
  ling: new URL("./logos/ling.svg", import.meta.url).href,
  nvidia: new URL("./logos/nvidia.svg", import.meta.url).href,
  typesafeai: new URL("./logos/typesafeai.svg", import.meta.url).href,
  vertexai: new URL("./logos/vertexai.svg", import.meta.url).href,
  xiaomimimo: new URL("./logos/xiaomimimo.svg", import.meta.url).href,
  zai: new URL("./logos/zai.svg", import.meta.url).href,
};
const brands: Record<string, string> = {
  "amazon-bedrock": "bedrock",
  "ant-ling": "ling",
  anthropic: "anthropic",
  azure: "azure",
  baseten: "baseten",
  cerebras: "cerebras",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  deepseek: "deepseek",
  fireworks: "fireworks",
  "github-copilot": "githubcopilot",
  google: "google",
  "google-vertex": "vertexai",
  groq: "groq",
  huggingface: "huggingface",
  "kimi-coding": "kimi",
  meta: "meta",
  minimax: "minimax",
  "minimax-cn": "minimax",
  mistral: "mistral",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  nvidia: "nvidia",
  openai: "openai",
  "openai-codex": "openai",
  opencode: "opencode",
  "opencode-go": "opencode",
  openrouter: "openrouter",
  "qwen-token-plan": "qwen",
  "qwen-token-plan-cn": "qwen",
  "qwen-token-plan-individual": "qwen",
  together: "together",
  typesafe: "typesafeai",
  vercel: "vercel",
  "vercel-ai-gateway": "vercel",
  xai: "xai",
  xiaomi: "xiaomimimo",
  "xiaomi-token-plan-ams": "xiaomimimo",
  "xiaomi-token-plan-cn": "xiaomimimo",
  "xiaomi-token-plan-sgp": "xiaomimimo",
  zai: "zai",
  "zai-coding-cn": "zai",
};

export function ProviderMark({ provider }: { provider?: string }) {
  const logo = provider ? logos[brands[provider] ?? ""] : undefined;
  return (
    <span
      className="provider-mark"
      data-provider={provider}
      data-fallback={!logo || undefined}
      aria-hidden="true"
      style={logo ? { maskImage: `url("${logo}")` } : undefined}
    >
      {logo ? null : (provider?.slice(0, 1).toUpperCase() ?? "?")}
    </span>
  );
}
