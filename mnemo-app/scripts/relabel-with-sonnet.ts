/**
 * relabel-with-sonnet.ts
 *
 * Reads up to 500 passages from Supabase where sonnet_output IS NULL,
 * calls Claude Sonnet for each to identify load-bearing words,
 * and saves the results back to Supabase.
 *
 * Usage: npx tsx scripts/relabel-with-sonnet.ts
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// 1. Load environment variables from .env.local (no dotenv required)
// ---------------------------------------------------------------------------

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("ERROR: .env.local not found at", envPath);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env[key] = value;
  }
  return env;
}

const env = loadEnv();

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.error("ERROR: Missing ANTHROPIC_API_KEY in .env.local");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Check that @anthropic-ai/sdk is installed
// ---------------------------------------------------------------------------

let Anthropic: typeof import("@anthropic-ai/sdk").default;
try {
  Anthropic = require("@anthropic-ai/sdk");
} catch {
  console.error(`
ERROR: @anthropic-ai/sdk is not installed.

Run one of:
  npm install @anthropic-ai/sdk
  pnpm add @anthropic-ai/sdk
  yarn add @anthropic-ai/sdk

Then re-run this script.
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Supabase client
// ---------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---------------------------------------------------------------------------
// 4. Anthropic client
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-5";

// Pricing (per million tokens, as of 2025)
const INPUT_COST_PER_M = 3.0;
const OUTPUT_COST_PER_M = 15.0;

// ---------------------------------------------------------------------------
// 5. Helpers
// ---------------------------------------------------------------------------

/** Build the numbered word list: "0:The 1:economy 2:is ..." */
function buildIndexedWords(text: string): { indexed: string; words: string[] } {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const indexed = words.map((w, i) => `${i}:${w}`).join(" ");
  return { indexed, words };
}

/** Calculate green budget: at least 3, roughly 10% of word count */
function greenBudget(wordCount: number): number {
  return Math.max(3, Math.round(wordCount * 0.1));
}

/** Build the prompt for Sonnet */
function buildPrompt(passageText: string, budget: number): string {
  const { indexed } = buildIndexedWords(passageText);
  return `You are a semantic analysis engine for a speed-reading system. Identify the load-bearing words in this passage.

Follow this hierarchical reasoning pipeline:

1. THESIS: What is the core claim or argument of this passage? State it in one sentence.

2. LOAD-BEARING CLAIMS: What are the 2-5 key sub-claims or pivotal ideas that support or build the thesis?

3. LOSS FUNCTION: For each word, ask: "If a reader skips this word, do they lose understanding of the thesis or a load-bearing claim?" Only words where the answer is YES are green.

4. INDICES: Select the ${budget} most critical word indices. Prefer content words (nouns, verbs, adjectives) over function words. Prioritize words that are unique to this argument over generic terms.

PASSAGE:
${passageText}

INDEXED WORDS:
${indexed}

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{"thesis": "...", "load_bearing": ["claim 1", "claim 2"], "green": [0, 5, 12]}`;
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 6. Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching passages from Supabase...");

  const { data: passages, error } = await supabase
    .from("training_passages")
    .select("id, passage_text, word_count")
    .is("sonnet_output", null)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("ERROR fetching passages:", error.message);
    process.exit(1);
  }

  if (!passages || passages.length === 0) {
    console.log("No passages need relabeling. All done!");
    return;
  }

  console.log(`Found ${passages.length} passages to relabel.\n`);

  let done = 0;
  let failed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < passages.length; i++) {
    const passage = passages[i];
    const wordCount = passage.word_count || passage.passage_text.split(/\s+/).length;
    const budget = greenBudget(wordCount);
    const prompt = buildPrompt(passage.passage_text, budget);

    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });

      // Accumulate token usage
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Parse JSON from response
      const rawText =
        response.content[0].type === "text" ? response.content[0].text : "";

      let parsed: { thesis: string; load_bearing: string[]; green: number[] };
      try {
        parsed = JSON.parse(rawText.trim());
      } catch {
        // Attempt to extract JSON if Sonnet wrapped it in markdown
        const match = rawText.match(/\{[\s\S]*\}/);
        if (!match) throw new Error(`Could not parse JSON: ${rawText.slice(0, 200)}`);
        parsed = JSON.parse(match[0]);
      }

      // Resolve actual green words from indices
      const { words } = buildIndexedWords(passage.passage_text);
      const greenWords = (parsed.green || [])
        .filter((idx: number) => idx >= 0 && idx < words.length)
        .map((idx: number) => words[idx]);

      // Save back to Supabase
      const { error: updateError } = await supabase
        .from("training_passages")
        .update({
          sonnet_output: parsed,
          sonnet_green_words: greenWords,
        })
        .eq("id", passage.id);

      if (updateError) {
        throw new Error(`Supabase update failed: ${updateError.message}`);
      }

      done++;
    } catch (err) {
      failed++;
      console.error(`  [${i + 1}/${passages.length}] FAILED (id: ${passage.id}):`, err instanceof Error ? err.message : err);
    }

    // Progress report every 10 passages (and on the last one)
    if ((i + 1) % 10 === 0 || i === passages.length - 1) {
      const costSoFar =
        (totalInputTokens / 1_000_000) * INPUT_COST_PER_M +
        (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_M;
      console.log(
        `[${i + 1}/${passages.length}] ✓ ${done} done, ${failed} failed | Cost so far: $${costSoFar.toFixed(3)}`
      );
    }

    // Rate limit: ~1100ms between requests to stay under Anthropic's limits
    if (i < passages.length - 1) {
      await sleep(1100);
    }
  }

  const totalCost =
    (totalInputTokens / 1_000_000) * INPUT_COST_PER_M +
    (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_M;

  console.log(`
Done!
  Passages processed: ${done + failed}
  Succeeded:          ${done}
  Failed:             ${failed}
  Total input tokens: ${totalInputTokens.toLocaleString()}
  Total output tokens:${totalOutputTokens.toLocaleString()}
  Total cost:         $${totalCost.toFixed(4)}
`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
