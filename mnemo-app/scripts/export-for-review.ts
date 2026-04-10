/**
 * export-for-review.ts
 *
 * Exports 50 relabeled passages (sonnet_output IS NOT NULL AND human_reviewed = false)
 * to review/passages-for-review.json for manual annotation.
 *
 * Usage: npx tsx scripts/export-for-review.ts
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// 1. Load environment variables from .env.local
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

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Supabase client
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---------------------------------------------------------------------------
// 3. Types
// ---------------------------------------------------------------------------

interface SonnetOutput {
  thesis: string;
  load_bearing: string[];
  green: number[];
}

interface ReviewPassage {
  review_number: number;
  id: string;
  word_count: number;
  thesis: string;
  load_bearing: string[];
  passage_text: string;
  annotated_passage: string;
  current_green_words: string[];
  current_green_indices: number[];
  /** Fill these in if the highlights are wrong */
  corrected_green_indices: number[];
  /** Optional notes about why you made corrections */
  notes: string;
  /** Set to true if the highlights look accurate */
  approved: boolean;
}

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

/** Split passage text into words the same way as relabel-with-sonnet.ts */
function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Build annotated passage: wrap each green word occurrence with [GREEN:word].
 * Uses index-based replacement so it handles repeated words correctly.
 */
function buildAnnotatedPassage(text: string, greenIndices: number[]): string {
  const words = splitWords(text);
  const greenSet = new Set(greenIndices);

  return words
    .map((word, idx) => (greenSet.has(idx) ? `[GREEN:${word}]` : word))
    .join(" ");
}

// ---------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching relabeled passages from Supabase...");

  const { data: passages, error } = await supabase
    .from("training_passages")
    .select("id, passage_text, word_count, sonnet_output, sonnet_green_words")
    .not("sonnet_output", "is", null)
    .eq("human_reviewed", false)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("ERROR fetching passages:", error.message);
    process.exit(1);
  }

  if (!passages || passages.length === 0) {
    console.log(
      "No passages available for review. Either all are reviewed or none have been relabeled yet."
    );
    console.log("Run: npx tsx scripts/relabel-with-sonnet.ts first.");
    return;
  }

  console.log(`Building review file for ${passages.length} passages...`);

  const reviewData: ReviewPassage[] = passages.map((p, idx) => {
    const sonnet = (p.sonnet_output || {}) as SonnetOutput;
    const greenIndices: number[] = Array.isArray(sonnet.green) ? sonnet.green : [];
    const words = splitWords(p.passage_text);

    // Resolve green words from indices (re-derive rather than trust stored value
    // in case the stored value is stale)
    const currentGreenWords = greenIndices
      .filter((i) => i >= 0 && i < words.length)
      .map((i) => words[i]);

    const annotated = buildAnnotatedPassage(p.passage_text, greenIndices);

    return {
      review_number: idx + 1,
      id: p.id,
      word_count: p.word_count || words.length,
      thesis: sonnet.thesis || "",
      load_bearing: Array.isArray(sonnet.load_bearing) ? sonnet.load_bearing : [],
      passage_text: p.passage_text,
      annotated_passage: annotated,
      current_green_words: currentGreenWords,
      current_green_indices: greenIndices,
      corrected_green_indices: [],
      notes: "",
      approved: false,
    };
  });

  // Ensure the review directory exists
  const reviewDir = path.resolve(process.cwd(), "review");
  fs.mkdirSync(reviewDir, { recursive: true });

  const outputPath = path.join(reviewDir, "passages-for-review.json");
  fs.writeFileSync(outputPath, JSON.stringify(reviewData, null, 2), "utf8");

  console.log(`
Exported ${reviewData.length} passages to review/passages-for-review.json

Instructions:
1. Open review/passages-for-review.json
2. For each passage, scan the annotated_passage for [GREEN:word] markers
3. If the highlights look accurate: set "approved": true
4. If wrong: fill in corrected_green_indices with correct indices + add notes
5. Run: npx tsx scripts/import-review.ts when done
`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
