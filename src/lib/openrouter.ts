import { getEnv } from "./env";

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function callOpenRouter(messages: OpenRouterMessage[]) {
  const { OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_MODEL } = getEnv();

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://lead-score-genius.local",
      "X-Title": "Lead Score Genius"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      response_format: {
        type: "json_object"
      },
      temperature: 0
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Unable to parse OpenRouter JSON response: ${content}`);
  }
}
