import "server-only";
import { decryptAiKey } from "@/lib/ai/keys";
import { isAiProvider, type AiProvider } from "@/lib/ai/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";

const modelVariables: Record<AiProvider, string> = {
  openai: "OPENAI_MODEL_ID",
  groq: "GROQ_MODEL_ID",
  claude: "CLAUDE_MODEL_ID",
  gemini: "GEMINI_MODEL_ID",
};

export class AiConfigurationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function loadUserAiProvider(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data: profile } = await supabase.from("profiles")
    .select("active_ai_provider").eq("id", userId).maybeSingle();
  if (!isAiProvider(profile?.active_ai_provider)) {
    throw new AiConfigurationError(409, "Choose an AI provider and save its API key in Settings.");
  }
  const provider = profile.active_ai_provider;
  const model = process.env[modelVariables[provider]];
  if (!model) throw new AiConfigurationError(503, `${modelVariables[provider]} is not configured on the server.`);
  const admin = createAdminClient();
  const { data: encrypted, error } = await admin.rpc("get_ai_key_admin", {
    p_user_id: userId, p_provider: provider,
  });
  if (error || typeof encrypted !== "string") {
    throw new AiConfigurationError(409, "Your selected provider has no saved API key. Add one in Settings.");
  }
  try {
    return { provider, model, apiKey: decryptAiKey(encrypted), admin };
  } catch {
    throw new AiConfigurationError(503, "The saved AI key could not be read. Replace it in Settings.");
  }
}
