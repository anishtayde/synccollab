const MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMS = 768;
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

// scale the vector so its length is 1 (needed when using fewer than 3072 dimensions)
function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

// Turn text into a vector of 768 numbers using the Gemini API
export async function embedText(text: string, taskType: TaskType): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env");

  const res = await fetch(URL, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${MODEL}`,
      content: { parts: [{ text: text.slice(0, 8000) }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMS,
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { embedding: { values: number[] } };
  return normalize(data.embedding.values);
}

// pgvector expects text like "[0.1,0.2,0.3]"
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}