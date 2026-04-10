/**
 * prepare-training-jsonl.ts
 *
 * Exports all approved passages as a JSONL file for Together.ai fine-tuning.
 *
 * Label priority per passage: final_output > human_corrections > sonnet_output > model_output
 *
 * Output format (one JSON object per line):
 * {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}
 *
 * Usage: npx tsx scripts/prepare-training-jsonl.ts
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
// 3. Prompts for the JSONL format
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are a semantic analysis engine for a speed-reading system. You output ONLY valid JSON. " +
  "You determine word importance through hierarchical reasoning about the text's argument structure — " +
  "not by keyword spotting.";

/** Build the user prompt for a passage */
function buildUserPrompt(passageText: string): string {
  const words = passageText.split(/\s+/).filter((w) => w.length > 0);
  const indexed = words.map((w, i) => `${i}:${w}`).join(" ");

  return `Analyze this passage and identify which words are load-bearing for its argument.

PASSAGE:
${passageText}

INDEXED WORDS:
${indexed}

Return {"thesis": "...", "load_bearing": [...], "green": [...indices]}`;
}

// ---------------------------------------------------------------------------
// 4. Types
// ---------------------------------------------------------------------------

interface LabelOutput {
  thesis?: string;
  load_bearing?: string[];
  green?: number[];
  [key: string]: unknown;
}

interface HumanCorrections {
  green?: number[];
  notes?: string;
  was_corrected?: boolean;
  [key: string]: unknown;
}

interface TrainingPassage {
  id: string;
  passage_text: string;
  word_count: number;
  model_output: LabelOutput | null;
  sonnet_output: LabelOutput | null;
  human_corrections: HumanCorrections | null;
  final_output: LabelOutput | null;
}

interface JsonlMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface JsonlLine {
  messages: JsonlMessage[];
}

// ---------------------------------------------------------------------------
// 5. Helpers
// ---------------------------------------------------------------------------

/**
 * Select the best available label for this passage.
 * Priority: final_output > human_corrections > sonnet_output > model_output
 */
function selectLabels(passage: TrainingPassage): LabelOutput | null {
  if (passage.final_output && isValidOutput(passage.final_output)) {
    return passage.final_output;
  }

  if (passage.human_corrections) {
    // human_corrections stores {green, notes, was_corrected} — we need to
    // reconstruct a full output. Fall back to sonnet for thesis/load_bearing.
    const base = passage.sonnet_output || passage.model_output || {};
    return {
      thesis: base.thesis || "",
      load_bearing: base.load_bearing || [],
      green: passage.human_corrections.green || [],
    };
  }

  if (passage.sonnet_output && isValidOutput(passage.sonnet_output)) {
    return passage.sonnet_output;
  }

  if (passage.model_output && isValidOutput(passage.model_output)) {
    return passage.model_output;
  }

  return null;
}

function isValidOutput(output: LabelOutput): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    Array.isArray(output.green) &&
    output.green.length > 0
  );
}

/** Build a clean assistant JSON string from the chosen labels */
function buildAssistantContent(labels: LabelOutput): string {
  const clean = {
    thesis: labels.thesis || "",
    load_bearing: Array.isArray(labels.load_bearing) ? labels.load_bearing : [],
    green: Array.isArray(labels.green) ? labels.green : [],
  };
  return JSON.stringify(clean);
}

// ---------------------------------------------------------------------------
// 6. Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching approved passages from Supabase...");

  const { data: passages, error } = await supabase
    .from("training_passages")
    .select(
      "id, passage_text, word_count, model_output, sonnet_output, human_corrections, final_output"
    )
    .eq("approved", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("ERROR fetching passages:", error.message);
    process.exit(1);
  }

  if (!passages || passages.length === 0) {
    console.log(
      "No approved passages found. Run import-review.ts to approve passages first."
    );
    return;
  }

  console.log(
    `Building JSONL from ${passages.length} approved passages...`
  );

  const lines: string[] = [];
  let skipped = 0;

  for (const passage of passages as TrainingPassage[]) {
    const labels = selectLabels(passage);

    if (!labels) {
      console.warn(`  WARN: No usable labels for passage ${passage.id} — skipping`);
      skipped++;
      continue;
    }

    const userPrompt = buildUserPrompt(passage.passage_text);
    const assistantContent = buildAssistantContent(labels);

    const jsonlLine: JsonlLine = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
        { role: "assistant", content: assistantContent },
      ],
    };

    lines.push(JSON.stringify(jsonlLine));
  }

  if (lines.length === 0) {
    console.error("ERROR: No valid training examples could be built. Check your data.");
    process.exit(1);
  }

  // Ensure the training directory exists
  const trainingDir = path.resolve(process.cwd(), "training");
  fs.mkdirSync(trainingDir, { recursive: true });

  const outputPath = path.join(trainingDir, "data.jsonl");
  fs.writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");

  console.log(`Exported ${lines.length} training examples to training/data.jsonl`);
  if (skipped > 0) {
    console.log(`  (${skipped} passages skipped due to missing labels)`);
  }

  console.log(`
Next steps:
1. Go to https://api.together.ai/fine-tuning
2. Upload training/data.jsonl
3. Select base model: meta-llama/Llama-3.1-8B-Instruct (not 3B — 8B handles reasoning better)
4. Estimated cost: ~$1-4 for 300-500 examples
5. Training time: 30-90 minutes
`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
