export const AI_PROVIDERS = ["openai", "groq", "claude", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI", groq: "Groq", claude: "Claude", gemini: "Gemini",
};

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && AI_PROVIDERS.includes(value as AiProvider);
}
