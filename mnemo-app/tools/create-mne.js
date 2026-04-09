#!/usr/bin/env node
/**
 * mnemo .mne creation CLI
 * ─────────────────────────────────────────────────
 * Usage:
 *   node create-mne.js <input> [options]
 *
 * Examples:
 *   node create-mne.js chapter1.txt --title "Chapter 1" --subject "Philosophy"
 *   node create-mne.js notes.txt --wpm 400 --out ./output/
 *   node create-mne.js --watch ./inbox/ --out ./output/   (agent mode)
 *
 * Input types supported:
 *   .txt  .md  .html  (plain text extraction)
 *   .pdf              (requires: npm install pdf-parse)
 *   .pptx             (requires: npm install jszip)
 *
 * The script calls the mnemo Vercel API for AI processing.
 * Set MNEMO_API_URL env var to point at your deployment.
 * ─────────────────────────────────────────────────
 */

const fs   = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

// ── Config ──────────────────────────────────────────────────────────────────
const API_URL = process.env.MNEMO_API_URL || "https://mnemo-app.vercel.app/api/prime";
const MODEL_SMART = "claude-sonnet-4-20250514";
const MODEL_FAST  = "claude-haiku-4-5-20251001";

const BASE_DELAY     = 196;
const WEIGHTED_DELAY = 210;
const INTRO_DELAY    = 316;

// ── Parse CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  input:   null,
  title:   null,
  subject: null,
  author:  null,
  out:     "./",
  wpm:     350,
  watch:   false,
  watchDir:null,
  focus:   null,
  verbose: args.includes("--verbose") || args.includes("-v"),
};

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--watch")   { opts.watch = true; opts.watchDir = args[++i]; }
  else if (a === "--out")     opts.out     = args[++i];
  else if (a === "--title")   opts.title   = args[++i];
  else if (a === "--subject") opts.subject = args[++i];
  else if (a === "--author")  opts.author  = args[++i];
  else if (a === "--focus")   opts.focus   = args[++i];
  else if (a === "--wpm")     opts.wpm     = parseInt(args[++i]);
  else if (!a.startsWith("-")) opts.input = a;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const log  = (...m) => console.log("[mnemo]", ...m);
const vlog = (...m) => opts.verbose && console.log("[mnemo:verbose]", ...m);
const err  = (...m) => { console.error("[mnemo:error]", ...m); process.exit(1); };

function tok(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0);
}

function pivot(w) {
  const c = w.replace(/[^a-zA-Z0-9]/g, "");
  const l = c.length;
  if (l <= 1) return 0;
  if (l <= 5) return 1;
  return Math.floor(l * 0.35);
}

// ── Text extraction ──────────────────────────────────────────────────────────
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt" || ext === ".md") {
    return { text: fs.readFileSync(filePath, "utf8"), chapters: [] };
  }

  if (ext === ".html" || ext === ".htm") {
    const html = fs.readFileSync(filePath, "utf8");
    // Strip tags
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { text, chapters: [] };
  }

  if (ext === ".pdf") {
    try {
      const pdfParse = require("pdf-parse");
      const buf = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return { text: data.text, chapters: [] };
    } catch {
      err("PDF parsing requires: npm install pdf-parse\nRun that first, then retry.");
    }
  }

  if (ext === ".pptx") {
    try {
      const JSZip = require("jszip");
      const buf   = fs.readFileSync(filePath);
      const zip   = await JSZip.loadAsync(buf);

      // Get slide order from relationships
      const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string") || "";
      const rIdToSlide = {};
      const relRe = /<Relationship[^>]+Id="([^"]+)"[^>]+Type="[^"]*\/slide"[^>]+Target="([^"]+)"/g;
      let m;
      while ((m = relRe.exec(relsXml))) rIdToSlide[m[1]] = m[2].replace(/^\//, "");

      const presXml = await zip.file("ppt/presentation.xml")?.async("string") || "";
      const ordered = [];
      const sldRe = /<p:sldId[^>]+r:id="([^"]+)"/g;
      while ((m = sldRe.exec(presXml))) {
        const p = rIdToSlide[m[1]];
        if (p) ordered.push(p.startsWith("slides/") ? "ppt/" + p : "ppt/slides/" + p.replace(/.*\//, ""));
      }

      if (!ordered.length) {
        const all = [];
        zip.forEach(p => { if (/ppt\/slides\/slide\d+\.xml$/.test(p)) all.push(p); });
        all.sort((a,b) => parseInt(a.match(/slide(\d+)/)?.[1]||0) - parseInt(b.match(/slide(\d+)/)?.[1]||0));
        ordered.push(...all);
      }

      const chapters = [];
      let fullText = "", wo = 0;

      for (let si = 0; si < ordered.length; si++) {
        const xml = await zip.file(ordered[si])?.async("string") || "";
        if (!xml) continue;
        const { DOMParser } = require("xmldom") || {};
        let title = "Slide " + (si + 1);
        let body  = "";

        // Simple regex extraction (no DOM needed for basic slides)
        const titleRe = /<p:ph[^>]*type="title"[^/]*/;
        const textRe  = /<a:t>([^<]*)<\/a:t>/g;
        let tm;
        while ((tm = textRe.exec(xml))) {
          const t = tm[1].trim();
          if (t) body += t + " ";
        }

        const slideWords = tok((title + " " + body).trim());
        if (slideWords.length > 0) {
          chapters.push({ i: si, t: title, s: wo, e: wo + slideWords.length - 1 });
        }
        fullText += "\n\n" + title + "\n" + body;
        wo += slideWords.length;
      }

      return { text: fullText.trim(), chapters };
    } catch {
      err("PPTX parsing requires: npm install jszip\nRun that first, then retry.");
    }
  }

  err(`Unsupported file type: ${ext}`);
}

// ── AI call ──────────────────────────────────────────────────────────────────
async function callClaude(content, maxTokens, model = MODEL_SMART) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    vlog("API error:", res.status, e.error || e.code || "");
    return "";
  }
  const data = await res.json();
  return data.content?.map(c => c.text || "").join("") || "";
}

// ── Semantic weighting ───────────────────────────────────────────────────────
async function getWordColors(words, contextText, familiarTerms = [], docSummary = "") {
  const wc = words.length;
  const maxH = Math.max(3, Math.round(wc * 0.08));
  const familiarNote = familiarTerms.length
    ? `\n\nFAMILIARITY DECAY — these terms are now established, do NOT re-highlight unless used in a new way: [${familiarTerms.slice(0, 40).join(", ")}]`
    : "";
  const docNote = docSummary
    ? `DOCUMENT CONTEXT (use this to understand what terms matter globally):\n"""${docSummary}"""\n\n`
    : "";

  const prompt =
    `Return ONLY valid JSON. You are an expert semantic weight scorer for a speed-reading app.\n\n` +
    docNote +
    `LOCAL PASSAGE:\n"""${contextText.slice(0, 2500)}"""\n\n` +
    `═══ WEIGHTING RULES ═══\n` +
    `"orange" (code 2) — CORE CONCEPTS: primary categories, things the text is fundamentally about.\n` +
    `  Even common words qualify when used as technical labels ("new" in "new monarchies" = orange).\n` +
    `  LIMIT: 2-4 per 100 words.\n\n` +
    `"green" (code 1) — QUALIFIERS: contrasts, methods, evaluative terms, first-use named examples.\n` +
    `  LIMIT: 4-6 per 100 words.\n\n` +
    `null (code 0) — everything else: function words, generic verbs, repeated proper nouns.\n\n` +
    `WORKED EXAMPLE:\n` +
    `Text: "All states have been either republics or monarchies. Monarchies may be hereditary or new."\n` +
    `Colors: [0,0,0,0,0,2,0,2,2,0,0,2,0,2]\n` +
    `(republics=2, monarchies=2, hereditary=2, new=2)\n` +
    familiarNote + `\n\n` +
    `Return: {"wordColors":[exactly ${wc} values, each 0/1/2/3 or null]}\n\n` +
    `Words (${wc}): ${words.join(" ")}`;

  const raw = await callClaude(prompt, 3000, MODEL_SMART);
  if (!raw) return new Array(wc).fill(0);

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const colors = (parsed.wordColors || []).map(c => c === null ? 0 : Number(c));
    if (colors.length === wc) return colors;
    return [...colors, ...new Array(Math.max(0, wc - colors.length)).fill(0)].slice(0, wc);
  } catch {
    return new Array(wc).fill(0);
  }
}

// ── Main creation function ───────────────────────────────────────────────────
async function createMne(filePath, overrides = {}) {
  const startTime = Date.now();
  const ext  = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, ext);

  log(`Processing: ${path.basename(filePath)}`);

  // 1. Extract text
  const { text, chapters: rawChapters } = await extractText(filePath);
  const words = tok(text);
  if (words.length < 10) err("File too short (< 10 words)");
  log(`  Extracted ${words.length.toLocaleString()} words, ${rawChapters.length} chapters`);

  const title   = overrides.title   || base.replace(/[-_]/g, " ");
  const subject = overrides.subject || "";
  const author  = overrides.author  || "";
  const focus   = overrides.focus   || "";

  // 2. Schema + flashcards (Sonnet)
  // For long texts: sample beginning, middle, and end so Claude sees the whole arc.
  log("  ① Generating schema & flashcards...");
  const SAMPLE_CHARS = 4000;
  const mid  = Math.floor(text.length / 2);
  const textSample = words.length > 2000
    ? text.slice(0, SAMPLE_CHARS) + "\n\n[...middle of document...]\n\n" +
      text.slice(mid - SAMPLE_CHARS / 2, mid + SAMPLE_CHARS / 2) + "\n\n[...end of document...]\n\n" +
      text.slice(-SAMPLE_CHARS)
    : text;

  const schemaPrompt =
    `Return ONLY valid JSON. Analyze this text comprehensively.${focus ? `\nFOCUS: "${focus}"` : ""}\n\n` +
    `Text (${words.length} words total — beginning, middle, and end sampled):\n"""${textSample.slice(0, 12000)}"""\n\n` +
    `{"summary":"2-3 sentences orienting the reader","keywords":["5-8 key terms"],"themes":["2-4 major themes"],"flashcards":[{"q":"...","a":"..."},{"q":"...","a":"..."},{"q":"...","a":"..."}]}`;

  const rawSchema = await callClaude(schemaPrompt, 900, MODEL_SMART);
  let schema = { summary: text.slice(0, 200), keywords: [], themes: [] };
  let cards  = [];
  try {
    if (rawSchema) {
      const p = JSON.parse(rawSchema.replace(/```json|```/g, "").trim());
      schema = { summary: p.summary || schema.summary, keywords: p.keywords || [], themes: p.themes || [] };
      cards  = p.flashcards || [];
    }
  } catch { vlog("Schema parse failed, using fallback"); }

  // Build a doc-level context string to anchor every chunk call globally
  const docContext = [
    schema.summary,
    schema.keywords?.length ? "Key terms: " + schema.keywords.join(", ") : "",
    schema.themes?.length   ? "Themes: "   + schema.themes.join(", ")   : "",
  ].filter(Boolean).join(" | ");

  // 3. Checkpoints (Haiku — structured task)
  // For long texts: sample beginning, 25%, 50%, 75% positions so all checkpoints are meaningful.
  log("  ② Generating comprehension checkpoints...");
  const cp25 = Math.floor(words.length * 0.25);
  const cp50 = Math.floor(words.length * 0.5);
  const cp75 = Math.floor(words.length * 0.75);
  const CPWIN = 600; // words of context around each checkpoint position
  const cpSample = words.length > 2000
    ? `Beginning:\n"""${words.slice(0, CPWIN).join(" ")}"""\n\n` +
      `~25% (word ${cp25}):\n"""${words.slice(Math.max(0, cp25 - CPWIN/2), cp25 + CPWIN/2).join(" ")}"""\n\n` +
      `~50% (word ${cp50}):\n"""${words.slice(Math.max(0, cp50 - CPWIN/2), cp50 + CPWIN/2).join(" ")}"""\n\n` +
      `~75% (word ${cp75}):\n"""${words.slice(Math.max(0, cp75 - CPWIN/2), cp75 + CPWIN/2).join(" ")}"""`
    : `Text: """${text.slice(0, 8000)}"""`;

  const checkPrompt =
    `Return ONLY valid JSON. Generate 3 multiple-choice comprehension checkpoints for a ${words.length}-word text.\n` +
    `Document context: ${docContext}\n\n` +
    `CP1 covers the first quarter (at=0.25), CP2 the first half (at=0.5), CP3 through three-quarters (at=0.75).\n` +
    `Each question must be answerable from the sampled passage near that position.\n\n` +
    `{"checks":[{"q":"...","o":["correct","wrong1","wrong2","wrong3"],"c":0,"at":0.25},{"q":"...","o":["..."],"c":0,"at":0.5},{"q":"...","o":["..."],"c":0,"at":0.75}]}\n\n` +
    cpSample;

  const rawChecks = await callClaude(checkPrompt, 900, MODEL_FAST);
  let checks = [];
  try {
    if (rawChecks) {
      const p = JSON.parse(rawChecks.replace(/```json|```/g, "").trim());
      checks = p.checks || p.checkpoints || [];
    }
  } catch { vlog("Checkpoints parse failed"); }

  // 4. Semantic word coloring — chunked for full text
  // Each chunk receives docContext so the model knows global themes while scoring locally.
  log("  ③ Scoring semantic weights (full text)...");
  const CHUNK = 800;
  const colorCodes = new Array(words.length).fill(0);
  const cumFreq = {};
  const COMMON = new Set(["that","this","with","from","have","been","were","they","their","them","than","when","what","which","would","could","should","about","into","more","some","also","very","just","only","will","each","make","like","then","does","made","said","over","such","take","most","much","well","back","even","good","give","many","here","know","come","both"]);
  const norm = w => w.toLowerCase().replace(/[^a-z]/g, "");

  for (let start = 0; start < words.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, words.length);
    const chunk = words.slice(start, end);
    const ctx = [
      words.slice(Math.max(0, start - 100), start).join(" "),
      chunk.join(" "),
      words.slice(end, Math.min(words.length, end + 100)).join(" "),
    ].filter(Boolean).join(" … ");

    const familiar = Object.entries(cumFreq).filter(([, c]) => c >= 3).map(([w]) => w);
    const chunkColors = await getWordColors(chunk, ctx, familiar, docContext);

    for (let i = 0; i < chunk.length; i++) {
      colorCodes[start + i] = chunkColors[i] || 0;
      const n = norm(chunk[i]);
      if (n.length >= 4 && !COMMON.has(n)) cumFreq[n] = (cumFreq[n] || 0) + 1;
    }

    if (words.length > CHUNK) {
      const pct = Math.round((end / words.length) * 100);
      log(`    ... ${pct}% scored`);
    }
  }

  // 5. Build compact words array
  log("  ④ Building .mne word array...");
  const highlightCount = {};
  const FAM_THRESH = 3;
  const mneWords = [];

  for (let i = 0; i < words.length; i++) {
    const w   = words[i];
    const n   = norm(w);
    let code  = colorCodes[i];
    const isMnemo = /^mnemo/i.test(n);

    if (isMnemo) {
      code = 3;
    } else if (code === 1 || code === 2) {
      const prev = highlightCount[n] || 0;
      if (prev >= FAM_THRESH && code === 1) code = 0;
      else if (prev >= FAM_THRESH + 2 && code === 2) code = 0;
      if (code) highlightCount[n] = (highlightCount[n] || 0) + 1;
    }

    const isSentEnd = /[.!?]["']?$/.test(w);
    const pause = (code > 0 || isSentEnd) ? 1 : 0;

    // Compact encoding: just string if no color + no pause
    if (code === 0 && !pause) {
      mneWords.push(w);
    } else if (code > 0 && !pause) {
      mneWords.push([w, code]);
    } else if (code === 0 && pause) {
      mneWords.push([w, 0, 1]);
    } else {
      mneWords.push([w, code, 1]);
    }
  }

  // 6. Build final .mne object
  const chapters = rawChapters.length > 1 ? rawChapters.map((c, i) => ({
    i, t: c.title || c.t, s: c.startIdx ?? c.s ?? 0, e: c.endIdx ?? c.e ?? words.length - 1,
  })) : [];

  const mne = {
    v:       1,
    id:      randomUUID(),
    created: new Date().toISOString(),
    meta: {
      title,
      subject: subject || undefined,
      author:  author  || undefined,
      source:  path.basename(filePath),
      lang:    "en",
      wc:      words.length,
      mins:    Math.max(1, Math.round(words.length / 350)),
      model:   MODEL_SMART,
    },
    schema,
    chapters: chapters.length ? chapters : undefined,
    words: mneWords,
    cards:  cards.length  ? cards  : undefined,
    checks: checks.length ? checks : undefined,
  };

  // 7. Write output
  const outDir  = overrides.out || opts.out;
  const outFile = path.join(outDir, base + ".mne");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(mne, null, 0), "utf8");

  const sizeKB = Math.round(fs.statSync(outFile).size / 1024);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`  ✓ Saved: ${outFile}`);
  log(`  ✓ Size: ${sizeKB} KB | Words: ${words.length.toLocaleString()} | Time: ${elapsed}s`);

  return outFile;
}

// ── Watch mode (agent) ────────────────────────────────────────────────────────
async function watchMode(dir, outDir) {
  if (!fs.existsSync(dir)) err(`Watch directory not found: ${dir}`);
  log(`👁  Watching: ${dir}`);
  log(`   Output  → ${outDir}`);
  log(`   Formats: .txt .md .html .pdf .pptx`);
  log("   Press Ctrl+C to stop.\n");

  const processing = new Set();
  const processed  = new Set();

  // Process any existing files first
  const existing = fs.readdirSync(dir).filter(f => /\.(txt|md|html|pdf|pptx)$/i.test(f));
  if (existing.length) {
    log(`Found ${existing.length} existing file(s), processing...`);
    for (const f of existing) {
      const full = path.join(dir, f);
      processed.add(full);
      createMne(full, { out: outDir }).catch(e => log(`  ✗ ${f}:`, e.message));
    }
  }

  // Watch for new files
  fs.watch(dir, async (event, filename) => {
    if (!filename || !/\.(txt|md|html|pdf|pptx)$/i.test(filename)) return;
    const full = path.join(dir, filename);
    if (processing.has(full) || processed.has(full)) return;
    if (!fs.existsSync(full)) return;

    processing.add(full);
    log(`\n📄 New file detected: ${filename}`);
    try {
      await createMne(full, { out: outDir });
      processed.add(full);
    } catch (e) {
      log(`  ✗ Failed:`, e.message);
    }
    processing.delete(full);
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  if (opts.watch) {
    if (!opts.watchDir) err("--watch requires a directory path: --watch ./inbox/");
    await watchMode(opts.watchDir, opts.out);
    return;
  }

  if (!opts.input) {
    console.log(`
mnemo .mne creator v1.0

USAGE:
  node create-mne.js <file> [options]
  node create-mne.js --watch <dir> --out <dir>

OPTIONS:
  --title   "My Title"      Override document title
  --subject "Philosophy"    Subject/course label
  --author  "Name"          Content author
  --focus   "Chapter 1"     Process only this section
  --out     ./output/       Output directory (default: ./)
  --wpm     350             Target WPM (used for estimates)
  --watch   <dir>           Watch directory for new files (agent mode)
  --verbose                 Show detailed logging

EXAMPLES:
  node create-mne.js notes.txt --title "Lecture 3" --subject "Econ 101"
  node create-mne.js chapter.pdf --out ~/Desktop/
  node create-mne.js --watch ~/Downloads/ --out ~/mnemo-files/

ENVIRONMENT:
  MNEMO_API_URL   API endpoint (default: https://mnemo-app.vercel.app/api/prime)
`);
    process.exit(0);
  }

  if (!fs.existsSync(opts.input)) err(`File not found: ${opts.input}`);
  await createMne(opts.input, opts);
})();
