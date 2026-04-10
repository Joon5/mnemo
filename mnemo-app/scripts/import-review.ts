/**
 * import-review.ts
 *
 * Reads review/passages-for-review.json after Jonathan has annotated it,
 * and saves the corrections/approvals back to Supabase.
 *
 * Logic per passage:
 *   - approved: false AND corrected_green_indices is empty → skip (not reviewed)
 *   - corrected_green_indices has values → save corrections, mark human_reviewed + approved
 *   - approved: true with no corrections → accept sonnet output as final, mark human_reviewed + approved
 *
 * Usage: npx tsx scripts/import-review.ts
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
  corrected_green_indices: number[];
  notes: string;
  approved: boolean;
}

interface HumanCorrections {
  green: number[];
  notes: string;
  was_corrected: boolean;
}

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/** Resolve word strings from indices */
function wordsAtIndices(text: string, indices: number[]): string[] {
  const words = splitWords(text);
  return indices
    .filter((i) => i >= 0 && i < words.length)
    .map((i) => words[i]);
}

// ---------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------

async function main() {
  const reviewPath = path.resolve(process.cwd(), "review", "passages-for-review.json");

  if (!fs.existsSync(reviewPath)) {
    console.error("ERROR: review/passages-for-review.json not found.");
    console.error("Run: npx tsx scripts/export-for-review.ts first.");
    process.exit(1);
  }

  let reviewData: ReviewPassage[];
  try {
    const raw = fs.readFileSync(reviewPath, "utf8");
    reviewData = JSON.parse(raw);
  } catch (err) {
    console.error("ERROR: Could not parse review/passages-for-review.json:", err);
    process.exit(1);
  }

  if (!Array.isArray(reviewData) || reviewData.length === 0) {
    console.log("Review file is empty. Nothing to import.");
    return;
  }

  console.log(`Processing ${reviewData.length} passages from review file...\n`);

  let countCorrected = 0;
  let countApprovedAsIs = 0;
  let countSkipped = 0;
  let countFailed = 0;

  for (const passage of reviewData) {
    const hasCorrectedIndices =
      Array.isArray(passage.corrected_green_indices) &&
      passage.corrected_green_indices.length > 0;

    // Determine review status
    const wasReviewed = passage.approved || hasCorrectedIndices;

    if (!wasReviewed) {
      // Not reviewed yet — skip
      countSkipped++;
      continue;
    }

    try {
      if (hasCorrectedIndices) {
        // --- Corrected path ---
        // User provided explicit corrections; use those instead of Sonnet's indices
        const correctedGreenWords = wordsAtIndices(
          passage.passage_text,
          passage.corrected_green_indices
        );

        const humanCorrections: HumanCorrections = {
          green: passage.corrected_green_indices,
          notes: passage.notes || "",
          was_corrected: true,
        };

        // Build the final_output from the corrected indices + existing thesis/load_bearing
        const finalOutput = {
          thesis: passage.thesis,
          load_bearing: passage.load_bearing,
          green: passage.corrected_green_indices,
        };

        const { error } = await supabase
          .from("training_passages")
          .update({
            human_reviewed: true,
            approved: true,
            human_corrections: humanCorrections,
            final_output: finalOutput,
            // Update sonnet_green_words to reflect corrections
            sonnet_green_words: correctedGreenWords,
          })
          .eq("id", passage.id);

        if (error) throw new Error(error.message);

        countCorrected++;
        console.log(
          `  [${passage.review_number}] ✓ Corrected — ${passage.corrected_green_indices.length} green indices saved`
        );
      } else {
        // --- Approved as-is path ---
        // User accepted Sonnet's output; promote it to final
        const humanCorrections: HumanCorrections = {
          green: passage.current_green_indices,
          notes: passage.notes || "",
          was_corrected: false,
        };

        const finalOutput = {
          thesis: passage.thesis,
          load_bearing: passage.load_bearing,
          green: passage.current_green_indices,
        };

        const { error } = await supabase
          .from("training_passages")
          .update({
            human_reviewed: true,
            approved: true,
            human_corrections: humanCorrections,
            final_output: finalOutput,
          })
          .eq("id", passage.id);

        if (error) throw new Error(error.message);

        countApprovedAsIs++;
        console.log(`  [${passage.review_number}] ✓ Approved as-is`);
      }
    } catch (err) {
      countFailed++;
      console.error(
        `  [${passage.review_number}] FAILED (id: ${passage.id}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const totalUpdated = countCorrected + countApprovedAsIs;
  console.log(`
Updated ${totalUpdated} passages (${countCorrected} corrected, ${countApprovedAsIs} approved as-is, ${countSkipped} skipped)${countFailed > 0 ? `, ${countFailed} failed` : ""}

Next step: npx tsx scripts/prepare-training-jsonl.ts
`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
