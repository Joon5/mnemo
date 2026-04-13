"use client";
import React, { useState, useRef, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import FeedbackWidget from "./FeedbackWidget";
import OnboardingOverlay from "./OnboardingOverlay";
import type {
  WordData,
  Schema,
  Bookmark,
  Session,
  Chapter,
  Checkpoint,
  Flashcard,
} from "@/lib/supabase";

// ── Error Boundary ──
class ErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error("App error:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--bg)",
          color: "var(--text)",
          padding: 20,
          textAlign: "center",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠</div>
          <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ color: "var(--gray3)", marginBottom: 24 }}>Please refresh the page to continue.</div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 24px",
              background: "var(--teal)",
              color: "var(--bg)",
              border: "none",
              borderRadius: 4,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Timing constants (matches original spec) ──
const BASE_DELAY = Math.round(((60000 / 350) * 0.8 * 0.7)); // ~196ms
const PUNCT_DELAY = Math.round(BASE_DELAY * 1.1);      // mid-sentence punctuation (, ; : —): 10% longer
const WEIGHTED_DELAY = Math.round(BASE_DELAY * 1.2);   // sentence endings: 20% longer
const HIGHLIGHT_DELAY = Math.round(BASE_DELAY * 1.4);  // key words: 40% longer — reader absorbs the important word
const INTRO_DELAY = Math.round(BASE_DELAY * 1.1) + 100; // ~316ms

type Screen = "intake" | "prime" | "reader" | "text" | "summary";

// ── Util ──
function tok(t: string): string[] {
  return t.trim().split(/\s+/).filter((w) => w.length > 0);
}

// ── .mne word safety: ensure every entry is exactly one token ──
// Splits any multi-word compact entries so the reader never displays more
// than one word at a time, regardless of how the .mne file was produced.
type RawMneWord = string | [string, number?, number?];
function flattenMneWords(raw: RawMneWord[]): RawMneWord[] {
  const out: RawMneWord[] = [];
  for (const w of raw) {
    if (typeof w === "string") {
      tok(w).forEach(t => out.push(t));
    } else if (Array.isArray(w)) {
      const tokens = tok(String(w[0]));
      if (tokens.length === 0) continue;
      tokens.forEach((t, i) => {
        // first token keeps color + pause; extra tokens are plain
        if (i === 0) {
          const entry: RawMneWord = w[2] != null ? [t, w[1] ?? 0, w[2]] : w[1] != null ? [t, w[1]] : t;
          out.push(entry);
        } else {
          out.push(t);
        }
      });
    }
  }
  return out;
}
function pivot(w: string): number {
  const c = w.replace(/[^a-zA-Z0-9]/g, "");
  const l = c.length;
  if (l <= 1) return 0;
  if (l <= 5) return 1;
  return Math.floor(l * 0.35);
}
function fmtTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60), r = s % 60;
  return r ? m + "m " + r + "s" : m + "m";
}
function retCalc(h: number, wpm: number): number {
  return Math.exp(-h / Math.max(1, 28 - (wpm - 150) / 40));
}
function timeAgo(ms: number): string {
  const h = ms / 36e5;
  if (h < 0.1) return "just now";
  if (h < 1) return Math.round(h * 60) + "m ago";
  if (h < 24) return Math.round(h) + "h ago";
  return Math.round(h / 24) + "d ago";
}

// ── Offline fallback functions ──
function generateLocalSchema(text: string): Schema {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const summary = sentences.slice(0, 2).join(". ").slice(0, 200) + (sentences.length > 2 ? "..." : "");

  const words = text.split(/\s+/).filter(w => w.length > 0);
  const keywords = words
    .filter(w => /^[A-Z]/.test(w))
    .slice(0, 5)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ""));

  return {
    summary: summary || "Text analysis complete.",
    keywords: keywords.length > 0 ? keywords : ["concept", "idea", "thought"],
  };
}

function generateLocalFlashcards(text: string): Flashcard[] {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length === 0) return [];

  return [
    {
      q: "What is the main topic?",
      a: sentences[0].slice(0, 80),
    },
    {
      q: "What is a key detail?",
      a: sentences[Math.floor(sentences.length / 2)].slice(0, 80),
    },
    {
      q: "What else is mentioned?",
      a: sentences[Math.max(0, sentences.length - 1)].slice(0, 80),
    },
  ];
}

// Model selection: Haiku for cheap/fast structured tasks, Sonnet for nuanced analysis
const MODEL_FAST = "llama-3.1-8b-instant";        // checkpoints, simple JSON tasks
const MODEL_SMART = "llama-3.3-70b-versatile";    // semantic weighting, schema, summaries

async function callClaude(
  messages: { role: string; content: string }[],
  max_tokens = 1000,
  model = MODEL_SMART,
  retries = 1
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("/api/prime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens, messages }),
      });
      if (!res.ok) {
        await res.json().catch(() => ({}));
        if (res.status === 503) {
          console.warn("Anthropic API key not configured");
          return ""; // No point retrying if key is missing
        }
        if (res.status === 429 && attempt < retries) {
          // Rate limited — wait and retry
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        return "";
      }
      const data = await res.json();
      // Groq returns OpenAI-compatible format: choices[0].message.content
      return data.choices?.[0]?.message?.content || "";
    } catch (e) {
      console.error("callClaude error (attempt " + (attempt + 1) + "):", e);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return "";
    }
  }
  return "";
}

function MnemoAppInner() {
  // ── Auth ──
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authError, setAuthError] = useState("");

  // ── Screen ──
  const [screen, setScreen] = useState<Screen>("intake");

  // ── Intake ──
  const [inputText, setInputText] = useState(
    `The attention economy is the defining constraint of modern education. Students today are not less intelligent than their predecessors, but are operating in an environment that has been deliberately engineered to fragment their focus. Every notification, every feed, every algorithmically optimized piece of content is competing for the same cognitive resource that reading requires: sustained, deep attention.\n\nThe consequences for academic reading are severe. A 2024 survey of 33 professors cited in The Atlantic found that students are intimidated by anything over 10 pages, and walk away from 20-page readings with no real understanding. This is not laziness. It is a rational response to an environment that has trained the brain to expect novelty every three seconds, and punishes any activity that requires holding a complex idea in mind for longer than a sentence.\n\nSpeed-reading was built on a single insight: the problem is not reading speed. The problem is comprehension. Every existing speed-reading tool — Spritz, BeeLine, Velocity — optimizes for words per minute. But peer-reviewed research by Di Nocera et al. (2018) shows that comprehension collapses above 350 WPM when the reading method is uniform. The brain cannot encode information it cannot process. Speed without structure is just noise.\n\nThe solution is adaptive, semantically-aware reading. Before a session begins, AI maps the text: flagging named entities, scoring each token for semantic weight, building a comprehension schema that primes the reader's brain to receive incoming information. During reading, high-weight words like photosynthesis and comprehension display at half speed. Function words like the, a, of, in flash at double speed. The result is a reading experience that mirrors how expert readers already behave when they are reading at their best.`
  );
  const [focusText, setFocusText] = useState("");
  const [uploadLabel, setUploadLabel] = useState("PDF, EPUB, PPTX or .mne");
  const [uploadStatus, setUploadStatus] = useState("");
  const [estWords, setEstWords] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  // ── Priming ──
  const [primeSteps, setPrimeSteps] = useState<("idle" | "active" | "done")[]>(
    ["idle", "idle", "idle", "idle"]
  );
  const [primeStatus, setPrimeStatus] = useState("Analyzing text…");
  const [schema, setSchema] = useState<Schema | null>(null);
  const [primeDone, setPrimeDone] = useState(false);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [checkpointsEnabled, setCheckpointsEnabled] = useState(true);

  // ── Reader display state (triggers re-renders) ──
  const [wordBefore, setWordBefore] = useState("");
  const [wordPivot, setWordPivot] = useState("—");
  const [wordAfter, setWordAfter] = useState("");
  const [wordColor, setWordColor] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentChapter, setCurrentChapter] = useState("");
  const [isPaused, setIsPaused] = useState(true);
  const [wpm, setWpm] = useState(350);
  const [tailVisible, setTailVisible] = useState(false);
  const [tailContent, setTailContent] = useState<
    { text: string; color: string | null; opacity: number }[]
  >([]);
  const [tocVisible, setTocVisible] = useState(false);
  const [cpVisible, setCpVisible] = useState(false);
  const [cpQuestion, setCpQuestion] = useState("");
  const [cpOptions, setCpOptions] = useState<string[]>([]);
  const [cpAnswered, setCpAnswered] = useState<(null | "ok" | "no")[]>([]);
  const [cpFeedback, setCpFeedback] = useState("");
  const [cpShowGo, setCpShowGo] = useState(false);
  const [weightBars, setWeightBars] = useState<{ h: number; c: string }[]>([]);
  const [cursorPct, setCursorPct] = useState(0);
  const [activeBarIdx, setActiveBarIdx] = useState(-1);
  const [chIndLabel, setChIndLabel] = useState("");
  const [currentWordIdx, setCurrentWordIdx] = useState(0);
  const [textBuilt, setTextBuilt] = useState(false);

  // ── Summary ──
  const [sumWords, setSumWords] = useState(0);
  const [sumWpm, setSumWpm] = useState(0);
  const [sumTime, setSumTime] = useState(0);
  const [sumPages, setSumPages] = useState(0);
  const [cpResults, setCpResults] = useState<{ correct: boolean }[]>([]);
  const [sumTakeaways, setSumTakeaways] = useState<string>("");
  const [sumFlashcards, setSumFlashcards] = useState<Flashcard[]>([]);
  const [openFc, setOpenFc] = useState<number | null>(null);
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set());
  const [seenCards, setSeenCards] = useState<Set<number>>(new Set());
  const [retNow, setRetNow] = useState("—");
  const [retNote, setRetNote] = useState("");
  const [cpScorePct, setCpScorePct] = useState<number | null>(null);

  // ── Bookmark modal ──
  const [bmModalVisible, setBmModalVisible] = useState(false);
  const [bmModalTitle, setBmModalTitle] = useState("");
  const [bmModalBody, setBmModalBody] = useState("");
  const [bmModalRet, setBmModalRet] = useState(80);
  const [bmModalRetPct, setBmModalRetPct] = useState("—");
  const [activeBmId, setActiveBmId] = useState<string | null>(null);

  // ── Toast ──
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  // ── Mutable reader refs (no re-render needed) ──
  const readerRef = useRef({
    words: [] as WordData[],
    currentIdx: 0,
    timer: null as ReturnType<typeof setTimeout> | null,
    wpm: 350,
    nextCpAt: -1,
    tailBuffer: [] as WordData[],
    sessionStart: 0,
    cpResultsRef: [] as { correct: boolean }[],
    checkpointsRef: [] as Checkpoint[],
    chaptersRef: [] as Chapter[],
    tailVisible: false,
  });

  const isPausedRef = useRef(true);
  const retCanvasRef = useRef<HTMLCanvasElement>(null);
  const wbarRef = useRef<HTMLDivElement>(null);
  const backClickRef = useRef({ count: 0, timer: null as ReturnType<typeof setTimeout> | null });
  const progIsScrubbing = useRef(false);
  const progWrapRef = useRef<HTMLDivElement>(null);

  // ── Auth init ──
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ id: data.user.id, email: data.user.email });
        loadUserData(data.user.id);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user;
      if (u) {
        setUser({ id: u.id, email: u.email });
        loadUserData(u.id);
      } else {
        setUser(null);
        setBookmarks([]);
        setSessions([]);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadUserData(userId: string) {
    // Load sessions
    const { data: sessData } = await supabase
      .from("reading_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (sessData) {
      setSessions(
        sessData.map((s) => ({
          words: s.words,
          wpm: s.wpm,
          time: s.time_ms,
          cpScore: s.cp_score,
          date: new Date(s.created_at).getTime(),
        }))
      );
    }

    // Load bookmarks
    const { data: bmData } = await supabase
      .from("bookmarks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (bmData) {
      setBookmarks(
        bmData.map((b) => ({
          id: b.id,
          title: b.title,
          text: b.text,
          wordData: (b.word_data as WordData[]) || [],
          pos: b.position,
          wc: b.word_count,
          wpm: b.wpm,
          at: new Date(b.created_at).getTime(),
          schema: (b.schema_data as Schema) || null,
        }))
      );
    }
  }

  // ── Auth actions ──
  async function handleAuth() {
    setAuthError("");
    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword,
      });
      if (error) setAuthError(error.message);
      else toast("Check your email to confirm signup!");
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      if (error) setAuthError(error.message);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  // ── Toast ──
  function toast(msg: string) {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2200);
  }

  // ── Word estimate ──
  const wordCount = inputText.trim() ? tok(inputText).length : 0;
  const estMins = wordCount > 0 ? Math.max(1, Math.round(wordCount / wpm)) : 0;
  const estPages = Math.max(1, Math.round(wordCount / 238));

  // ── File upload ──
  // CDN-based script loader (avoids webpack build-time resolution)
  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  async function handleFile(file: File) {
    setUploadLabel("Loading…");
    setUploadStatus("");
    try {
      if (file.name.toLowerCase().endsWith(".pdf")) {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
        const pdfjsLib = (window as unknown as Record<string, unknown>).pdfjsLib as {
          GlobalWorkerOptions: { workerSrc: string };
          getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<{
            numPages: number;
            getPage: (n: number) => Promise<{
              getTextContent: () => Promise<{ items: { str: string; transform: number[] }[] }>;
            }>;
          }> };
        };
        pdfjsLib.GlobalWorkerOptions.workerSrc = "";
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const pages: { items: { text: string; fs: number }[] }[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const pg = await pdf.getPage(i);
          const ct = await pg.getTextContent();
          pages.push({
            items: ct.items.map((it) => ({
              text: it.str,
              fs: Math.round(Math.abs(it.transform[3] || 12) * 10) / 10,
            })),
          });
        }
        let ft = "";
        for (const p of pages) {
          for (const it of p.items) ft += it.text + " ";
          ft += "\n\n";
        }
        ft = ft.trim();
        setInputText(ft);

        // ── Enhanced chapter detection ──
        // 1. Determine body font size (most common by character count)
        const fsc: Record<number, number> = {};
        for (const p of pages) for (const it of p.items) {
          if (it.text.trim().length < 1) continue;
          fsc[it.fs] = (fsc[it.fs] || 0) + it.text.length;
        }
        let bodyFs = 12, mx = 0;
        for (const [fs, n] of Object.entries(fsc)) if (n > mx) { mx = n; bodyFs = parseFloat(fs); }
        const headingThresh = bodyFs * 1.2;

        // 2. Build per-page text + word offsets
        const pageTexts: string[] = [];
        const pageWordOffsets: number[] = [];
        let globalWordCount = 0;
        const pageBodyWordCounts: number[] = []; // body-font-size words per page
        for (let pi = 0; pi < pages.length; pi++) {
          const p = pages[pi];
          let pageText = "";
          let bodyWords = 0;
          pageWordOffsets.push(globalWordCount);
          for (const it of p.items) {
            pageText += it.text + " ";
            if (Math.abs(it.fs - bodyFs) < 1 && it.text.trim().length > 0) {
              bodyWords += tok(it.text).length;
            }
          }
          pageText = pageText.trim();
          pageTexts.push(pageText);
          pageBodyWordCounts.push(bodyWords);
          globalWordCount += tok(pageText).length;
        }

        // 3. Front-matter detection: pages before actual content begins
        // Front matter = title pages, copyright, dedication, ToC, etc.
        // Heuristic: front matter pages have very few body-text words (< 50)
        // and usually appear before the first page with substantial body text
        const frontMatterPatterns = [
          /^(title\s+page|copyright|©|all\s+rights\s+reserved)/i,
          /^(table\s+of\s+contents|contents)/i,
          /^(dedication|acknowledgment|acknowledgement|preface|foreword|prologue|introduction|epigraph)/i,
          /^(also\s+by|other\s+books\s+by|published\s+by)/i,
          /^(isbn|library\s+of\s+congress)/i,
          /^(first\s+edition|printed\s+in)/i,
        ];
        const isFrontMatterPage = (pageIdx: number): boolean => {
          const text = pageTexts[pageIdx];
          // Very little body text on this page
          if (pageBodyWordCounts[pageIdx] < 50) return true;
          // Matches known front-matter patterns
          const lines = text.split(/\s{2,}/).map(l => l.trim()).filter(Boolean);
          for (const line of lines.slice(0, 5)) {
            if (frontMatterPatterns.some(p => p.test(line))) return true;
          }
          return false;
        };

        // Find where front matter ends: first page with substantial body text
        // that also has a chapter-like heading or is followed by more content pages
        let frontMatterEndPage = 0;
        for (let pi = 0; pi < pages.length; pi++) {
          if (pageBodyWordCounts[pi] >= 80) {
            // Found substantial content — check if this looks like real content
            frontMatterEndPage = pi;
            break;
          }
        }

        // 4. Chapter numbering regex patterns (OCR-style)
        const chapterPatterns = [
          /^chapter\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/i,
          /^ch\.?\s*(\d+)/i,
          /^part\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)/i,
          /^section\s+(\d+)/i,
          /^(\d+)\.\s+[A-Z]/,
          /^(I{1,3}|IV|VI{0,3}|IX|X{0,3})\.\s+[A-Z]/,
        ];
        const matchesChapterPattern = (text: string): boolean => {
          const trimmed = text.trim();
          return chapterPatterns.some(p => p.test(trimmed));
        };

        // 5. Scan each page for chapter start signals (skip front matter)
        type ChapterCandidate = {
          title: string;
          pageIdx: number;
          wordIdx: number;
          confidence: number;
          fs: number;
          isFrontMatter: boolean;
        };
        const candidates: ChapterCandidate[] = [];

        for (let pi = 0; pi < pages.length; pi++) {
          const page = pages[pi];
          const pageWordBase = pageWordOffsets[pi];
          let localWordCount = 0;
          const isInFrontMatter = pi < frontMatterEndPage;

          const pageHeadings: { text: string; fs: number; localWordIdx: number }[] = [];

          for (const it of page.items) {
            const t = it.text.trim();
            if (!t) continue;
            const wordsInItem = tok(t).length;
            if (it.fs >= headingThresh && t.length > 1 && t.length < 120) {
              pageHeadings.push({ text: t, fs: it.fs, localWordIdx: localWordCount });
            }
            localWordCount += wordsInItem;
          }

          for (const h of pageHeadings) {
            let confidence = 0;

            // Signal 1: Font size
            if (h.fs >= bodyFs * 1.5) confidence += 40;
            else if (h.fs >= bodyFs * 1.3) confidence += 25;
            else if (h.fs >= headingThresh) confidence += 10;

            // Signal 2: Chapter numbering pattern (strongest signal)
            if (matchesChapterPattern(h.text)) confidence += 50;

            // Signal 3: Near start of page (page break = new chapter)
            if (h.localWordIdx < 15) confidence += 20;

            // Signal 4: Short title text
            if (h.text.length < 50) confidence += 5;
            if (h.text.length < 30) confidence += 5;

            // Signal 5: Page starts clean
            if (h.localWordIdx < 5) confidence += 10;

            // Signal 6: Page has body text after heading (real chapter, not just a title page)
            if (pageBodyWordCounts[pi] >= 60) confidence += 15;

            // Penalty: Front matter pages get confidence reduced
            if (isInFrontMatter && !matchesChapterPattern(h.text)) {
              confidence -= 30;
            }

            if (confidence >= 30) {
              candidates.push({
                title: h.text.slice(0, 80),
                pageIdx: pi,
                wordIdx: pageWordBase + h.localWordIdx,
                confidence,
                fs: h.fs,
                isFrontMatter: isInFrontMatter,
              });
            }
          }

          // Also check plain text at page start for chapter pattern
          const firstLine = pageTexts[pi].split(/\s{2,}/)[0]?.trim() || "";
          if (matchesChapterPattern(firstLine) && !pageHeadings.some(h => h.text === firstLine)) {
            candidates.push({
              title: firstLine.slice(0, 80),
              pageIdx: pi,
              wordIdx: pageWordBase,
              confidence: isInFrontMatter ? 25 : 45,
              fs: bodyFs,
              isFrontMatter: isInFrontMatter,
            });
          }
        }

        // 6. Deduplicate nearby candidates
        candidates.sort((a, b) => a.wordIdx - b.wordIdx);
        const deduped: ChapterCandidate[] = [];
        for (const c of candidates) {
          const last = deduped[deduped.length - 1];
          if (last && Math.abs(c.wordIdx - last.wordIdx) < 30) {
            if (c.confidence > last.confidence) {
              last.title = c.title;
              last.wordIdx = c.wordIdx;
              last.confidence = c.confidence;
              last.fs = c.fs;
              last.isFrontMatter = c.isFrontMatter;
            }
          } else {
            deduped.push({ ...c });
          }
        }

        // 7. Filter out front-matter entries unless they match a chapter pattern
        // This ensures "Chapter 1" in front matter still counts, but random title-page headings don't
        const contentChapters = deduped.filter(c =>
          !c.isFrontMatter || matchesChapterPattern(c.title)
        );

        // 8. Build final chapter list with start/end indices
        const tw = tok(ft).length;
        if (contentChapters.length > 1) {
          setChapters(contentChapters.map((c, i, a) => ({
            title: c.title,
            startIdx: c.wordIdx,
            endIdx: i < a.length - 1 ? a[i + 1].wordIdx - 1 : tw - 1,
          })));
          setUploadStatus("✓ " + contentChapters.length + " chapters");
        } else if (contentChapters.length === 1) {
          // Single chapter detected — still useful for focus instructions
          setChapters(contentChapters.map(c => ({
            title: c.title,
            startIdx: c.wordIdx,
            endIdx: tw - 1,
          })));
          setUploadStatus("✓ 1 chapter");
        } else {
          setChapters([]);
          setUploadStatus("✓ Loaded");
        }
        setUploadLabel("✓ " + file.name);
        toast(chapters.length ? chapters.length + " chapters" : "PDF loaded");

      } else if (file.name.toLowerCase().endsWith(".epub")) {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
        const JSZipLib = (window as unknown as Record<string, unknown>).JSZip as {
          loadAsync: (data: ArrayBuffer) => Promise<{
            forEach: (cb: (path: string, entry: { async: (t: string) => Promise<string> }) => void) => void;
          }>;
        };
        const zip = await JSZipLib.loadAsync(await file.arrayBuffer());
        const cf: { path: string; entry: { async: (t: string) => Promise<string> } }[] = [];
        zip.forEach((p, e) => {
          if (/\.(xhtml|html|htm)$/i.test(p) && !p.includes("toc") && !p.includes("nav"))
            cf.push({ path: p, entry: e });
        });
        cf.sort((a, b) => a.path.localeCompare(b.path));
        let ft = "";
        const ec: Chapter[] = [];
        let wo = 0;
        for (const { entry } of cf) {
          const h = await entry.async("string");
          const d = document.createElement("div");
          d.innerHTML = h;
          d.querySelectorAll("script,style,nav").forEach((el) => el.remove());
          const hd = d.querySelector("h1,h2,h3");
          const title = hd ? hd.textContent?.trim() || "" : "";
          const txt = (d.textContent || "").replace(/\s+/g, " ").trim();
          if (txt.length > 100) {
            const ws = tok(txt);
            if (title) ec.push({ title, startIdx: wo, endIdx: wo + ws.length - 1 });
            wo += ws.length;
            ft += txt + "\n\n";
          }
        }
        ft = ft.trim();
        setInputText(ft);
        setChapters(ec);
        setUploadStatus(ec.length ? "✓ " + ec.length + " chapters" : "✓ Loaded");
        setUploadLabel("✓ " + file.name);
        toast(ec.length ? ec.length + " chapters" : "EPUB loaded");

      } else if (file.name.toLowerCase().endsWith(".pptx")) {
        // ── PPTX parsing — PPTX is a ZIP of XML files ──
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
        const JSZipLib = (window as unknown as Record<string, unknown>).JSZip as {
          loadAsync: (data: ArrayBuffer) => Promise<{
            file: (path: string) => { async: (t: string) => Promise<string> } | null;
            forEach: (cb: (path: string) => void) => void;
          }>;
        };
        const zip = await JSZipLib.loadAsync(await file.arrayBuffer());

        // 1. Read relationship file to map rId → slide path
        const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string") || "";
        const rIdToSlide: Record<string, string> = {};
        const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Type="[^"]*slide[^"]*"[^>]+Target="([^"]+)"/g;
        let relMatch;
        while ((relMatch = relRegex.exec(relsXml)) !== null) {
          rIdToSlide[relMatch[1]] = relMatch[2].replace(/^\//, "");
        }

        // 2. Read presentation.xml to get ordered slide list
        const presXml = await zip.file("ppt/presentation.xml")?.async("string") || "";
        const orderedPaths: string[] = [];
        const sldIdRegex = /<p:sldId[^>]+r:id="([^"]+)"/g;
        let sldMatch;
        while ((sldMatch = sldIdRegex.exec(presXml)) !== null) {
          const rId = sldMatch[1];
          if (rIdToSlide[rId]) {
            // Target might be "slides/slide1.xml" or "../slides/slide1.xml"
            const path = rIdToSlide[rId].startsWith("slides/")
              ? "ppt/" + rIdToSlide[rId]
              : "ppt/slides/" + rIdToSlide[rId].replace(/.*\//, "");
            orderedPaths.push(path);
          }
        }

        // If we couldn't determine order from rels, fall back to alphabetical slide order
        if (orderedPaths.length === 0) {
          const allPaths: string[] = [];
          zip.forEach((p) => { if (/ppt\/slides\/slide\d+\.xml$/.test(p)) allPaths.push(p); });
          allPaths.sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
            const numB = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
            return numA - numB;
          });
          orderedPaths.push(...allPaths);
        }

        // 3. For each slide, extract text in reading order
        const pptxChapters: Chapter[] = [];
        let fullText = "";
        let wordOffset = 0;

        const extractTextFromXml = (xml: string): { title: string; body: string } => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, "text/xml");

          // Find title shape (ph type="title" or idx="0")
          let titleText = "";
          const shapes = doc.querySelectorAll("sp");
          for (const sp of Array.from(shapes)) {
            const ph = sp.querySelector("ph");
            const isTitle = ph && (ph.getAttribute("type") === "title" || ph.getAttribute("idx") === "0");
            if (isTitle) {
              titleText = Array.from(sp.querySelectorAll("t")).map(t => t.textContent || "").join(" ").trim();
              break;
            }
          }

          // Extract all text, maintaining shape reading order (top-to-bottom by y position)
          const shapeData: { y: number; text: string; isTitle: boolean }[] = [];
          for (const sp of Array.from(shapes)) {
            const ph = sp.querySelector("ph");
            const isTitle = !!(ph && (ph.getAttribute("type") === "title" || ph.getAttribute("idx") === "0"));
            const off = sp.querySelector("off");
            const y = off ? parseInt(off.getAttribute("y") || "0") : 0;
            const text = Array.from(sp.querySelectorAll("t")).map(t => t.textContent || "").join(" ").trim();
            if (text) shapeData.push({ y, text, isTitle });
          }
          shapeData.sort((a, b) => a.y - b.y);

          const bodyLines = shapeData.filter(s => !s.isTitle).map(s => s.text);
          return { title: titleText, body: bodyLines.join("\n") };
        };

        for (let si = 0; si < orderedPaths.length; si++) {
          const slidePath = orderedPaths[si];
          const slideXml = await zip.file(slidePath)?.async("string") || "";
          if (!slideXml) continue;

          const { title, body } = extractTextFromXml(slideXml);
          const slideLabel = title || ("Slide " + (si + 1));
          const slideText = (title ? title + "\n" : "") + body;
          if (!slideText.trim()) continue;

          const slideWords = tok(slideText);
          if (title && slideWords.length > 0) {
            pptxChapters.push({
              title: slideLabel,
              startIdx: wordOffset,
              endIdx: wordOffset + slideWords.length - 1,
            });
          }

          fullText += "\n\n" + slideText;
          wordOffset += slideWords.length;
        }

        const pptxText = fullText.trim();
        setInputText(pptxText);
        setChapters(pptxChapters);
        const slideCount = orderedPaths.length;
        setUploadStatus("✓ " + slideCount + " slides" + (pptxChapters.length ? ", " + pptxChapters.length + " chapters" : ""));
        setUploadLabel("✓ " + file.name);
        toast(slideCount + " slides loaded");

      } else if (
        file.name.toLowerCase().endsWith(".mne") ||
        file.name.toLowerCase().endsWith(".mnemo")
      ) {
        // ── .mne / .mnemo format — pre-processed, instant reading ──
        const text = await file.text();
        const data = JSON.parse(text);

        // Support both .mne v1 (data.v) and legacy .mnemo (data.mnemo)
        const isMne   = data.v && data.v >= 1;
        const isMnemo = data.mnemo && data.mnemo >= 1;
        if (!isMne && !isMnemo) throw new Error("Invalid .mne file — missing version field");

        // ── Decode .mne compact word encoding ──
        // .mne: each element is either a string (plain) or [text, colorCode, pause?]
        // colorCode: 0=null, 1=green, 2=orange, 3=teal
        // legacy .mnemo: { t, c, p, d } objects
        const COLOR_MAP: Record<number, WordData["color"]> = {
          0: null,
          1: "green",
          2: "orange",
          3: "mnemo",
        };

        // Decode legacy .mnemo object format { t, c, p, d } first, then flatten
        type LegacyWord = { t: string; c: string | null; p: boolean; d: number };
        const normalizedRaw: RawMneWord[] = (data.words || []).map(
          (w: RawMneWord | LegacyWord): RawMneWord => {
            if (typeof w === "string" || Array.isArray(w)) return w;
            // legacy object → compact array
            const legW = w as LegacyWord;
            const legCode = legW.c === "green" ? 1 : legW.c === "orange" ? 2 : legW.c === "mnemo" ? 3 : 0;
            if (legCode === 0 && !legW.p) return legW.t;
            return legW.p ? [legW.t, legCode, 1] : [legW.t, legCode];
          }
        );

        // Ensure every entry is exactly one token — display must be one word at a time
        const safeWords = flattenMneWords(normalizedRaw);

        const restoredWords: WordData[] = safeWords.map(
          (w: string | [string, number?, number?]) => {
            if (typeof w === "string") {
              return { text: w, color: null, pause: false, delay: BASE_DELAY };
            }
            // compact array: [text, colorCode?, pause?]
            const color = COLOR_MAP[w[1] as number] ?? null;
            const pause = w[2] === 1;
            return {
              text:  w[0] as string,
              color,
              pause,
              delay: color ? HIGHLIGHT_DELAY : pause ? WEIGHTED_DELAY : BASE_DELAY,
            };
          }
        );

        // ── Restore chapter structure ──
        // .mne chapters use compact keys {i, t, s, e}; legacy uses {title, startIdx, endIdx}
        type RawChapter = { i?: number; t?: string; s?: number; e?: number; title?: string; startIdx?: number; endIdx?: number };
        const restoredChapters: Chapter[] = (data.chapters || []).map((ch: RawChapter) => ({
          title:    ch.t ?? ch.title ?? "",
          startIdx: ch.s ?? ch.startIdx ?? 0,
          endIdx:   ch.e ?? ch.endIdx ?? restoredWords.length - 1,
        }));

        // ── Restore checks ──
        // .mne checks: {q, o, c, at} — same as internal Checkpoint type
        const restoredChecks = data.checks || data.checkpoints || [];

        setInputText(restoredWords.map(w => w.text).join(" "));
        setChapters(restoredChapters);
        if (data.schema) setSchema(data.schema);
        if (data.cards)  setFlashcards(data.cards);        // .mne uses "cards"
        if (data.flashcards) setFlashcards(data.flashcards); // legacy
        if (restoredChecks.length) setCheckpoints(restoredChecks);
        readerRef.current.words = restoredWords;
        readerRef.current.checkpointsRef = restoredChecks;
        readerRef.current.chaptersRef = restoredChapters;

        const meta = data.meta || {};
        const wc   = meta.wc || meta.wordCount || restoredWords.length;
        setUploadLabel("✓ " + (meta.title || file.name));
        setUploadStatus("✓ Pre-processed · " + wc.toLocaleString() + " words");
        toast("✓ .mne loaded — ready to read instantly");

      } else {
        toast("Supported: PDF, EPUB, PPTX, or .mne files");
      }
    } catch (e) {
      console.error(e);
      setUploadLabel("Error");
      toast("Could not read file");
    }
  }

  // ── Bookmarks ──
  function timeAgoLocal(at: number) {
    return timeAgo(Date.now() - at);
  }

  async function deleteBookmark(id: string) {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
    if (user) {
      await supabase.from("bookmarks").delete().eq("id", id).eq("user_id", user.id);
    }
    toast("Deleted");
  }

  function openBookmark(id: string) {
    const bm = bookmarks.find((b) => b.id === id);
    if (!bm) return;
    setActiveBmId(id);
    readerRef.current.words = bm.wordData;
    readerRef.current.wpm = bm.wpm;
    setWpm(bm.wpm);
    const h = (Date.now() - bm.at) / 36e5;
    const ret = Math.round(retCalc(h, bm.wpm) * 100);
    const p = Math.round((bm.pos / bm.wc) * 100);
    setBmModalTitle('"' + bm.title + '"');
    setBmModalBody("You were " + p + "% through.");
    setBmModalRet(ret);
    setBmModalRetPct("~" + ret + "%");
    setBmModalVisible(true);
    readerRef.current.currentIdx = bm.pos;
  }

  function resumeBookmark() {
    setBmModalVisible(false);
    const bm = bookmarks.find((b) => b.id === activeBmId);
    if (!bm) return;
    readerRef.current.tailBuffer = [];
    readerRef.current.sessionStart = Date.now();
    readerRef.current.cpResultsRef = [];
    readerRef.current.checkpointsRef = checkpoints;
    readerRef.current.chaptersRef = chapters;
    readerRef.current.tailVisible = false;
    setTailVisible(false);
    isPausedRef.current = false;
    setIsPaused(false);
    readerRef.current.wpm = bm.wpm;
    setWpm(bm.wpm);
    setSchema(bm.schema);
    buildWeightBars(bm.wordData);
    setScreen("reader");
    setTimeout(() => {
      readerRef.current.nextCpAt = -1;
      runReader();
    }, 50);
  }

  async function saveBookmark() {
    const r = readerRef.current;
    const id = "bm_" + Date.now();
    const words4 = r.words.slice(0, 4).map((w) => w.text).join(" ");
    const curCh = getCurChapter();
    const title = curCh || words4;
    const bm: Bookmark = {
      id,
      title,
      text: inputText,
      wordData: r.words,
      pos: Math.max(0, r.currentIdx - 1),
      wc: r.words.length,
      wpm: r.wpm,
      at: Date.now(),
      schema: schema,
    };
    setBookmarks((prev) => {
      const filtered = prev.filter((b) => b.title !== bm.title);
      return [bm, ...filtered].slice(0, 8);
    });
    if (user) {
      await supabase.from("bookmarks").upsert({
        id: bm.id,
        user_id: user.id,
        title: bm.title,
        text: bm.text,
        word_data: bm.wordData,
        position: bm.pos,
        word_count: bm.wc,
        wpm: bm.wpm,
        schema_data: bm.schema,
        created_at: new Date().toISOString(),
      });
    }
    toast("Bookmark saved ✓");
  }

  // ── .mne export (v1 compact format) ──
  function exportMnemo() {
    const r = readerRef.current;
    const words = r.words;
    if (!words.length) { toast("Nothing to export — start reading first"); return; }

    const title = (() => {
      const ch = chapters[0]?.title;
      const first4 = words.slice(0, 4).map(w => w.text).join(" ");
      return ch || first4 || "mnemo export";
    })();

    // ── Compact word encoding (per MNE-FORMAT-SPEC v1) ──
    // Plain word → string. Weighted/paused word → [text, colorCode, pause?]
    // colorCode: 0=null, 1=green, 2=orange, 3=teal
    const COLOR_CODE: Record<string, number> = { green: 1, orange: 2, mnemo: 3 };

    const compactWords = words.map((w): string | [string, number] | [string, number, 1] => {
      if (!w.color && !w.pause) return w.text;
      const code = w.color ? (COLOR_CODE[w.color] ?? 0) : 0;
      if (w.pause) return [w.text, code, 1];
      return [w.text, code];
    });

    // ── Chapter encoding: compact keys {i, t, s, e} ──
    const compactChapters = chapters.map((ch, i) => ({
      i,
      t: ch.title,
      s: ch.startIdx,
      e: ch.endIdx,
    }));

    // ── Checkpoint encoding: {q, o, c, at} ──
    // (already matches .mne spec — just rename "checkpoints" → "checks")
    const payload: Record<string, unknown> = {
      v: 1,
      id: crypto.randomUUID(),
      created: new Date().toISOString(),
      meta: {
        title,
        source: uploadLabel.replace("✓ ", ""),
        lang: "en",
        wc: words.length,
        mins: Math.round(words.length / 250),
        model: "claude-sonnet-4-20250514",
      },
      words: compactWords,
    };

    if (schema) payload.schema = schema;
    if (flashcards.length) payload.cards = flashcards.map(f => ({ q: f.q || (f as { question?: string }).question || "", a: f.a || (f as { answer?: string }).answer || "" }));
    if (checkpoints.length) payload.checks = checkpoints;
    if (compactChapters.length) payload.chapters = compactChapters;

    const blob = new Blob([JSON.stringify(payload)], { type: "application/x-mne" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = title.slice(0, 40).replace(/[^a-z0-9]/gi, "_") + ".mne";
    a.click();
    URL.revokeObjectURL(url);
    toast("✓ Saved as .mne — share for instant reading");
  }

  // ── Focus instruction parsing ──
  function parseFocusChapter(focus: string): { chapterQuery: string; chapterNum: number | null } | null {
    if (!focus) return null;
    // Match patterns like "Only Chapter 1", "chapter 3", "Ch. 5", "only ch 2"
    const m = focus.match(/(?:only\s+)?(?:chapter|ch\.?)\s*(\d+)/i);
    if (m) return { chapterQuery: m[0], chapterNum: parseInt(m[1], 10) };
    // Match "Part 2", "Section 3"
    const m2 = focus.match(/(?:only\s+)?(?:part|section)\s*(\d+)/i);
    if (m2) return { chapterQuery: m2[0], chapterNum: parseInt(m2[1], 10) };
    return null;
  }

  function findChapterByQuery(chapterNum: number, chapterList: Chapter[]): Chapter | null {
    if (!chapterList.length) return null;
    // Try to match by chapter number in the title
    for (const ch of chapterList) {
      const numMatch = ch.title.match(/(\d+)/);
      if (numMatch && parseInt(numMatch[1], 10) === chapterNum) return ch;
    }
    // Try word-number matching (e.g., "Chapter One")
    const wordNums: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
      eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
      fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
      nineteen: 19, twenty: 20,
    };
    for (const ch of chapterList) {
      const words = ch.title.toLowerCase().split(/\s+/);
      for (const w of words) {
        if (wordNums[w] === chapterNum) return ch;
      }
    }
    // Try roman numerals
    const romanMap: Record<string, number> = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
      xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
    };
    for (const ch of chapterList) {
      const words = ch.title.toLowerCase().split(/\s+/);
      for (const w of words) {
        if (romanMap[w.replace(/[^a-z]/g, "")] === chapterNum) return ch;
      }
    }
    // Fall back to index (1-based)
    if (chapterNum >= 1 && chapterNum <= chapterList.length) {
      return chapterList[chapterNum - 1];
    }
    return null;
  }

  // ── Chunked AI word weighting with familiarity decay ──
  // Tracks word frequency across chunks so repeated terms get de-weighted over time
  async function getWordColorsChunked(words: string[], docContext = ""): Promise<(string | null)[]> {
    const CHUNK_SIZE = 250; // Smaller chunks = shorter JSON arrays = more reliable Llama output
    const totalWords = words.length;

    // Build a running word frequency map — only track "significant" words (4+ chars, not common)
    const commonWords = new Set([
      "that", "this", "with", "from", "have", "been", "were", "they", "their", "them",
      "than", "when", "what", "which", "would", "could", "should", "about", "into",
      "more", "some", "also", "very", "just", "only", "will", "each", "make", "like",
      "then", "does", "made", "said", "over", "such", "take", "most", "much", "well",
      "back", "even", "good", "give", "many", "here", "know", "come", "both",
    ]);
    const normalize = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "");

    if (totalWords <= CHUNK_SIZE) {
      return await getWordColorsForChunk(words, 0, words.join(" "), {}, docContext, totalWords);
    }

    const allColors: (string | null)[] = new Array(totalWords).fill(null);
    const chunks: { start: number; end: number }[] = [];
    for (let i = 0; i < totalWords; i += CHUNK_SIZE) {
      chunks.push({ start: i, end: Math.min(i + CHUNK_SIZE, totalWords) });
    }

    // Track cumulative word frequency across all processed chunks
    const cumulativeFreq: Record<string, number> = {};

    // Process chunks in parallel batches of 2, but each batch has the frequency context
    // from all previously processed chunks
    const BATCH_SIZE = 2;
    for (let b = 0; b < chunks.length; b += BATCH_SIZE) {
      const batch = chunks.slice(b, b + BATCH_SIZE);
      // Snapshot frequency before this batch (both chunks in a batch see the same history)
      const freqSnapshot = { ...cumulativeFreq };

      const results = await Promise.all(
        batch.map(({ start, end }) => {
          const chunkWords = words.slice(start, end);
          const contextBefore = words.slice(Math.max(0, start - 100), start).join(" ");
          const contextAfter = words.slice(end, Math.min(totalWords, end + 100)).join(" ");
          const fullContext = [contextBefore, chunkWords.join(" "), contextAfter].filter(Boolean).join(" ... ");
          return getWordColorsForChunk(chunkWords, start, fullContext, freqSnapshot, docContext, totalWords);
        })
      );

      // Apply results and update cumulative frequency
      results.forEach((colors, idx) => {
        const { start, end } = batch[idx];
        colors.forEach((c, i) => {
          allColors[start + i] = c;
        });
        // Update frequency counts from this chunk
        for (let wi = start; wi < end; wi++) {
          const norm = normalize(words[wi]);
          if (norm.length >= 4 && !commonWords.has(norm)) {
            cumulativeFreq[norm] = (cumulativeFreq[norm] || 0) + 1;
          }
        }
      });
    }
    return allColors;
  }

  async function getWordColorsForChunk(
    chunkWords: string[],
    startIdx: number,
    contextText: string,
    wordFreqBefore: Record<string, number>, // how many times each word appeared before this chunk
    docContext = "",
    totalDocWords = 0  // total word count of the full text, used for length-aware green budget
  ): Promise<(string | null)[]> {
    const wc = chunkWords.length;
    const maxHighlighted = Math.max(3, Math.round(wc * 0.08));
    const wl = chunkWords.join(" ");

    // Build a "already seen" list so the AI knows which terms are now familiar
    const frequentTerms: string[] = [];
    for (const [word, count] of Object.entries(wordFreqBefore)) {
      if (count >= 3) frequentTerms.push(word);
    }
    const familiarNote = frequentTerms.length > 0
      ? '\n\nFAMILIARITY DECAY — these terms have already appeared 3+ times earlier in the text and are now FAMILIAR to the reader. Do NOT highlight them unless they are being used in a genuinely new or surprising way: [' + frequentTerms.slice(0, 40).join(", ") + ']'
      : '';

    const docNote = docContext
      ? 'DOCUMENT CONTEXT (global themes and key terms — use this to understand what matters across the whole text):\n"""' + docContext + '"""\n\n'
      : '';

    // Length-aware green budget: shorter texts need higher density (paragraph = detail retention),
    // longer texts need lower density (book = only the truly load-bearing words).
    const docLen = totalDocWords || wc;
    const greenPct =
      docLen < 150   ? 0.18 :  // single paragraph — weight heavily
      docLen < 500   ? 0.13 :  // article section
      docLen < 2000  ? 0.10 :  // short article
      docLen < 10000 ? 0.07 :  // long article / chapter
                       0.04;   // book-length — sparse, only thesis-critical words
    const greenBudget = Math.max(3, Math.round(wc * greenPct));
    const numberedWords = chunkWords.map((w, i) => i + ':' + w).join(' ');
    const prompt =
      'You are a semantic analysis engine for a speed-reading system. Return ONLY valid JSON.\n\n' +
      'CRITICAL PRINCIPLE: You are NOT building a keyword list. You are reasoning about what\n' +
      'this specific passage is arguing, then identifying which words are load-bearing for that argument.\n' +
      'The same word may be essential in one text and irrelevant in another. Importance is relational.\n\n' +
      'REASONING PIPELINE — execute in this order before selecting any indices:\n\n' +
      'Step 1 — THESIS: What is the governing argument or core purpose of this passage?\n' +
      '  Write one sentence that captures what the author is fundamentally claiming or doing.\n\n' +
      'Step 2 — LOAD-BEARING CLAIMS: What key points are necessary to build, defend, or clarify that thesis?\n' +
      '  List 2–4 short phrases that name the indispensable supporting structure.\n\n' +
      'Step 3 — LOSS FUNCTION: For each candidate word, ask:\n' +
      '  "If a speed reader misses this word, how much of the argument is lost?"\n' +
      '  Select words that fail this test — words whose omission breaks meaning, distorts the claim,\n' +
      '  removes a crucial name/term, or drops a pivotal contrast or qualification.\n\n' +
      'Step 4 — OUTPUT: Return the indices of those words. Aim for ' + greenBudget + ' indices (~10% of ' + wc + ' words).\n\n' +
      'WHAT TO MARK (only after completing Steps 1–3):\n' +
      '  - Words that express the thesis or a central claim directly\n' +
      '  - Hinge words that reverse, qualify, or pivot the argument (e.g. "however", "despite", "unless")\n' +
      '  - Key names (people, tools, publications) that the argument depends on\n' +
      '  - Definitions or technical terms that carry meaning unique to this passage\n' +
      '  - Decisive evidence terms (not all statistics — only those central to the claim)\n\n' +
      'WHAT NOT TO MARK:\n' +
      '  - Function words: the, a, an, of, in, at, to, for, on, by, as, with, from, into\n' +
      '  - Linking verbs: is, are, was, were, be, been, have, has, had, do, does\n' +
      '  - Generic pronouns: it, its, they, their, this, that, these, those, which\n' +
      '  - Attribution verbs: found, shows, suggests, argues, states, cited, reports, says\n' +
      '  - Decorative or peripheral detail that does not affect the argument if omitted\n' +
      (familiarNote ? '\nSKIP (reader already knows these): ' + familiarNote + '\n' : '') +
      '\n' + (docNote ? 'DOCUMENT CONTEXT: ' + docNote + '\n\n' : '') +
      'PASSAGE:\n' + contextText.slice(0, 4000) + '\n\n' +
      'INDEXED WORDS:\n' + numberedWords + '\n\n' +
      'OUTPUT FORMAT — return exactly this structure:\n' +
      '{\n' +
      '  "thesis": "one sentence: the governing argument of this passage",\n' +
      '  "load_bearing": ["key claim 1", "key claim 2"],\n' +
      '  "green": [3, 7, 12, 19, ...]\n' +
      '}\n' +
      'Only integer indices in "green". No strings. No markdown. Raw JSON only.';

    // Written-out numbers that carry quantitative meaning
    const WRITTEN_NUMBERS = new Set([
      "zero","one","two","three","four","five","six","seven","eight","nine","ten",
      "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen",
      "twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety",
      "hundred","thousand","million","billion","trillion","half","quarter","third","double","triple",
    ]);

    // ── Pass 1: Regex pre-pass — statistics always orange, years never orange ──
    const regexColors: (string | null)[] = chunkWords.map(w => {
      const clean = w.replace(/^["""'''([\-–—]+|["""''').!?,;:\]]+$/g, "");
      const num = Number(clean.replace(/,/g, ""));

      // Exclude years — study dates are noise, not data
      if (/^\d{4}$/.test(clean) && num >= 1800 && num <= 2100) return null;

      // Percentages and ratios always orange (e.g. 0.1%, 2.5x, 80%)
      if (/^\d+(\.\d+)?[%xX]$/.test(clean)) return "orange";
      // Numbers with commas (e.g. 2,400) or decimals (e.g. 45.0)
      if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) return "orange";
      if (/^\d+\.\d+$/.test(clean)) return "orange";
      // Plain integers that are meaningful quantities (not years)
      if (/^\d+$/.test(clean) && num > 0) return "orange";
      // Shorthand: 2k, 5M, 3B
      if (/^\d+(\.\d+)?[kKmMbBtT]$/.test(clean)) return "orange";

      // Written-out numbers in lowercase (e.g. "three seconds", "thirty percent")
      if (WRITTEN_NUMBERS.has(w.toLowerCase())) return "orange";

      return null;
    });

    // ── Pass 2: AI weighting — finds green claim words, may also add orange ──
    const raw = await callClaude([{ role: "user", content: prompt }], 1500, MODEL_SMART);

    // Words that are NEVER green regardless of what the model returns
    const NEVER_GREEN = new Set([
      "the","a","an","of","in","at","to","for","on","by","as","with","from","into","onto","upon",
      "is","are","was","were","be","been","being","have","has","had","do","does","did",
      "will","would","could","should","may","might","must","shall","ought",
      "it","its","they","their","them","he","she","we","our","you","your","i","my","me",
      "this","that","these","those","which","what","who","whom","whose",
      "and","or","nor","but","so","yet","both","either","neither",
      "every","each","all","any","some","such","no","not",
      "than","then","when","where","while","if","though","although","because","since","until","unless",
      "found","shows","show","suggests","suggest","argues","argue","states","state","cited","reports","says","said",
      "just","very","quite","rather","already","still","also","too","even","only","here","there",
    ]);

    const aiColors: (string | null)[] = new Array(wc).fill(null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        // Format: {"green": [3, 7, 12, ...]} — just the indices
        const indices: unknown[] = parsed.green || parsed.indices || parsed.green_indices || [];
        for (const idx of indices) {
          const i = Number(idx);
          if (Number.isInteger(i) && i >= 0 && i < wc) {
            const bare = chunkWords[i].toLowerCase().replace(/[^a-z]/g, "");
            if (!NEVER_GREEN.has(bare)) {
              aiColors[i] = "green";
            }
          }
        }

        // ── Collect training data (fire-and-forget, never blocks reading) ──
        const rawGreen: number[] = (parsed.green || []).filter(
          (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x < wc
        );
        if (rawGreen.length > 0) {
          fetch("/api/training", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              passage_text: chunkWords.join(" "),
              word_count: wc,
              doc_context: docContext ? docContext.slice(0, 500) : "",
              model_output: {
                thesis: parsed.thesis || "",
                load_bearing: parsed.load_bearing || [],
                green: rawGreen,
              },
              green_words: rawGreen.map((i: number) => chunkWords[i]),
            }),
          }).catch(() => {}); // silent fail — never surface to user
        }
      } catch { /* aiColors stays all-null */ }
    }

    // ── Merge: regex owns orange (numbers), AI owns green (claim words) ──
    return chunkWords.map((_, i) => {
      if (regexColors[i] === "orange") return "orange";  // numbers always orange
      if (aiColors[i] === "green") return "green";       // AI claim words
      return null;
    });
  }

  // ── Priming ──
  async function startPriming() {
    const text = inputText.trim();
    if (!text || tok(text).length < 10) {
      toast("Paste or upload text (10+ words)");
      return;
    }

    // ── Focus instruction: filter to specific chapter if requested ──
    let activeText = text;
    let activeChapters = chapters;
    const focusParsed = parseFocusChapter(focusText);

    if (focusParsed) {
      const found = findChapterByQuery(focusParsed.chapterNum!, chapters);
      if (found) {
        // Extract only the chapter's words from the full text
        const allWords = tok(text);
        const chapterWords = allWords.slice(found.startIdx, found.endIdx + 1);
        if (chapterWords.length >= 10) {
          activeText = chapterWords.join(" ");
          activeChapters = [{
            title: found.title,
            startIdx: 0,
            endIdx: chapterWords.length - 1,
          }];
          toast("Reading: " + found.title);
        } else {
          toast("Chapter " + focusParsed.chapterNum + " has too few words — using full text");
        }
      } else {
        // Chapter not found
        toast("Chapter " + focusParsed.chapterNum + " Unable to Be Identified — using full text");
      }
    }

    readerRef.current.currentIdx = 0;
    readerRef.current.tailBuffer = [];
    readerRef.current.cpResultsRef = [];
    setCpResults([]);
    setSchema(null);
    setPrimeDone(false);
    setPrimeSteps(["active", "idle", "idle", "idle"]);
    setPrimeStatus("Analyzing text…");
    setScreen("prime");

    const rawWords = tok(activeText);
    const wc = rawWords.length;
    const fc = (focusText && !focusParsed) ? '\nFOCUS: "' + focusText + '".' : "";

    // Initialize words with basic timing
    const initWords: WordData[] = rawWords.map((w, i) => {
      const isSentEnd = /[.!?]["']?$/.test(w);
      const isPunct   = !isSentEnd && /[,;:\u2014\u2013]$/.test(w); // , ; : — –
      const isMnemo = /^mnemo/i.test(w.replace(/[^a-zA-Z]/g, ""));
      return {
        text: w,
        color: isMnemo ? "mnemo" : null,
        pause: isSentEnd,
        delay: i === 0 ? INTRO_DELAY : isSentEnd ? WEIGHTED_DELAY : isPunct ? PUNCT_DELAY : BASE_DELAY,
      };
    });
    readerRef.current.words = initWords;

    // ── Build full-text samples for schema + checkpoints ──
    // For long texts: sample beginning, middle, and end so Claude sees the whole arc.
    const SAMPLE_CHARS = 4000;
    const midChar = Math.floor(activeText.length / 2);
    const textSample = wc > 2000
      ? activeText.slice(0, SAMPLE_CHARS) +
        '\n\n[...middle of document...]\n\n' +
        activeText.slice(Math.max(0, midChar - SAMPLE_CHARS / 2), midChar + SAMPLE_CHARS / 2) +
        '\n\n[...end of document...]\n\n' +
        activeText.slice(-SAMPLE_CHARS)
      : activeText;

    // ── Prompt A: Schema + flashcards (beginning + middle + end sample) ──
    const promptA =
      'Return ONLY valid JSON.' +
      fc +
      '\n\nAnalyze this text comprehensively. The sample includes the beginning, middle, and end so you can understand the full arc.\n\n' +
      'Text (' + wc + ' words total — beginning, middle, and end sampled):\n"""' +
      textSample.slice(0, 12000) +
      '"""\n\n{"summary":"2-3 sentences orienting the reader to the FULL text","keywords":["5-8 key terms spanning the whole text"],"themes":["2-4 major themes"],"flashcards":[{"q":"question","a":"answer"},{"q":"q2","a":"a2"},{"q":"q3","a":"a3"}]}';

    // ── Animate steps while waiting ──
    let cs = 0;
    const stepMsgs = [
      "Mapping structure…",
      "Scoring lexical weights…",
      "Building schema…",
      "Generating checkpoints…",
    ];
    const si = setInterval(() => {
      if (cs < 3) {
        cs++;
        const newSteps: ("idle" | "active" | "done")[] = ["idle", "idle", "idle", "idle"];
        for (let i = 0; i < cs; i++) newSteps[i] = "done";
        newSteps[cs] = "active";
        setPrimeSteps(newSteps);
        setPrimeStatus(stepMsgs[cs]);
      }
    }, 1200);

    // ── PHASE 1: Schema first so we can build docContext ──
    const rawA = await callClaude([{ role: "user", content: promptA }], 900, MODEL_SMART);

    // Build docContext from schema result for injection into every chunk + checkpoint call
    let docContext = "";
    try {
      if (rawA) {
        const p = JSON.parse(rawA.replace(/```json|```/g, "").trim());
        const parts = [
          p.summary || "",
          p.keywords?.length ? "Key terms: " + p.keywords.join(", ") : "",
          p.themes?.length   ? "Themes: "   + p.themes.join(", ")   : "",
        ].filter(Boolean);
        docContext = parts.join(" | ");
      }
    } catch { /* docContext stays "" */ }

    // ── Prompt B: Checkpoints — sample text around each position ──
    const cp25 = Math.floor(wc * 0.25), cp50 = Math.floor(wc * 0.5), cp75 = Math.floor(wc * 0.75);
    const CPWIN = 600;
    const cpSample = wc > 2000
      ? 'Beginning:\n"""' + rawWords.slice(0, CPWIN).join(" ") + '"""\n\n' +
        '~25% (word ' + cp25 + '):\n"""' + rawWords.slice(Math.max(0, cp25 - CPWIN / 2), cp25 + CPWIN / 2).join(" ") + '"""\n\n' +
        '~50% (word ' + cp50 + '):\n"""' + rawWords.slice(Math.max(0, cp50 - CPWIN / 2), cp50 + CPWIN / 2).join(" ") + '"""\n\n' +
        '~75% (word ' + cp75 + '):\n"""' + rawWords.slice(Math.max(0, cp75 - CPWIN / 2), cp75 + CPWIN / 2).join(" ") + '"""'
      : 'Text:\n"""' + activeText.slice(0, 8000) + '"""';

    const promptCheckpoints =
      'Return ONLY valid JSON. Generate 3 multiple-choice comprehension checkpoints for a ' + wc + '-word text.\n' +
      (docContext ? 'Document context: ' + docContext + '\n\n' : '') +
      'CP1 covers the first quarter (at=0.25), CP2 the first half (at=0.5), CP3 through three-quarters (at=0.75).\n' +
      'Each question must be answerable from the sampled passage near that position.\n\n' +
      '{"checkpoints":[{"q":"question","options":["correct","wrong1","wrong2","wrong3"],"correct":0},{"q":"q2","options":["a","b","c","d"],"correct":1},{"q":"q3","options":["a","b","c","d"],"correct":2}]}\n\n' +
      cpSample;

    // ── PHASE 2: Checkpoints + word colors in parallel, both fed docContext ──
    const [rawCheckpoints, allWordColors] = await Promise.all([
      callClaude([{ role: "user", content: promptCheckpoints }], 900, MODEL_FAST),
      getWordColorsChunked(rawWords, docContext),
    ]);
    clearInterval(si);

    // Check if API failed
    const apiFailed = !rawA && allWordColors.every(c => c === null);
    if (apiFailed) {
      toast("⚠ API key not configured — using offline mode");
    }

    let parsedA: { summary: string; keywords: string[]; flashcards: Flashcard[] };
    try {
      if (rawA) {
        parsedA = JSON.parse(rawA.replace(/```json|```/g, "").trim());
      } else {
        parsedA = {
          summary: generateLocalSchema(activeText).summary,
          keywords: generateLocalSchema(activeText).keywords,
          flashcards: generateLocalFlashcards(activeText),
        };
      }
    } catch {
      parsedA = {
        summary: generateLocalSchema(activeText).summary,
        keywords: generateLocalSchema(activeText).keywords,
        flashcards: generateLocalFlashcards(activeText),
      };
    }

    let parsedCheckpoints: Checkpoint[] = [];
    try {
      if (rawCheckpoints) {
        const cp = JSON.parse(rawCheckpoints.replace(/```json|```/g, "").trim());
        parsedCheckpoints = cp.checkpoints || [];
      }
    } catch {
      parsedCheckpoints = [];
    }

    // ── Apply word colors with client-side familiarity decay enforcement ──
    // Even after AI scoring, we enforce: once a word has been highlighted 3+ times,
    // subsequent highlights are suppressed unless it's a different color (escalation)
    const colors = allWordColors;
    let colorCount = 0;
    const hardCap = Math.round(rawWords.length * 0.1);
    const highlightCount: Record<string, number> = {}; // track how many times each term is highlighted
    const FAMILIARITY_THRESHOLD = 3; // after 3 highlights, stop unless escalating

    const finalWords: WordData[] = rawWords.map((w, i) => {
      let color: WordData["color"] = i < colors.length ? (colors[i] as WordData["color"]) : null;
      const isMnemo = /^mnemo/i.test(w.replace(/[^a-zA-Z]/g, ""));
      const normalized = w.toLowerCase().replace(/[^a-z]/g, "");

      if (isMnemo) {
        color = "mnemo";
      } else if (color === "green" || color === "orange") {
        // Familiarity decay: suppress highlight if this word has been highlighted too many times
        const prevCount = highlightCount[normalized] || 0;
        if (prevCount >= FAMILIARITY_THRESHOLD && color === "green") {
          // Demote green (important) to null after repeated highlights
          color = null;
        } else if (prevCount >= FAMILIARITY_THRESHOLD + 2 && color === "orange") {
          // Demote orange (critical) only after even more repetition — concepts stay longer
          color = null;
        }

        if (color === "green" || color === "orange") {
          colorCount++;
          highlightCount[normalized] = prevCount + 1;
          if (colorCount > hardCap) color = null;
        }
      }
      const isHighlighted = color === "green" || color === "orange";
      const isSentEnd = /[.!?]["']?$/.test(w);
      const isPunct   = !isSentEnd && /[,;:\u2014\u2013]$/.test(w); // , ; : — –
      return {
        text: w,
        color,
        pause: isHighlighted || isSentEnd,
        delay:
          i === 0
            ? INTRO_DELAY
            : isHighlighted
            ? HIGHLIGHT_DELAY   // key words: 40% longer
            : isSentEnd
            ? WEIGHTED_DELAY    // sentence endings: 20% longer
            : isPunct
            ? PUNCT_DELAY       // mid-sentence punctuation: 10% longer
            : BASE_DELAY,
      };
    });

    readerRef.current.words = finalWords;

    // Update chapters for filtered text
    readerRef.current.chaptersRef = activeChapters;

    const schemaData: Schema = {
      summary: parsedA.summary,
      keywords: parsedA.keywords || [],
    };
    setSchema(schemaData);
    setFlashcards(parsedA.flashcards || []);
    setCheckpoints(parsedCheckpoints);
    readerRef.current.checkpointsRef = parsedCheckpoints;

    setPrimeSteps(["done", "done", "done", "done"]);
    setPrimeStatus("Ready.");
    setPrimeDone(true);
  }

  // ── Reader ──
  function getCurChapter(): string {
    const r = readerRef.current;
    if (!r.chaptersRef.length) return "";
    for (const ch of r.chaptersRef) {
      if (r.currentIdx >= ch.startIdx && r.currentIdx <= ch.endIdx) return ch.title;
    }
    return "";
  }

  function buildWeightBars(words?: WordData[]) {
    const w = words || readerRef.current.words;
    const total = w.length;
    const step = Math.max(1, Math.floor(total / 200));
    const bars: { h: number; c: string }[] = [];
    for (let i = 0; i < total; i += step) {
      const word = w[i];
      let h = 4, c = "var(--border)";
      if (word.color === "green") { h = 36; c = "var(--teal)"; }
      else if (word.color === "orange") { h = 44; c = "var(--orange)"; }
      else if (word.pause) { h = 24; c = "var(--gray3)"; }
      else { h = 4 + Math.random() * 8; c = "var(--border)"; }
      bars.push({ h, c });
    }
    setWeightBars(bars);
  }

  function getDelay(i: number): number {
    const r = readerRef.current;
    const w = r.words[i];
    if (!w) return BASE_DELAY;
    const scale = 350 / r.wpm;
    return Math.round((w.delay || BASE_DELAY) * scale);
  }

  function displayWord(i: number) {
    const r = readerRef.current;
    if (i >= r.words.length) return;
    const w = r.words[i];
    const p = pivot(w.text);
    setWordBefore(w.text.slice(0, p));
    setWordPivot(w.text[p] || "");
    setWordAfter(w.text.slice(p + 1));
    setWordColor(w.color || null);

    r.tailBuffer.push(w);
    if (r.tailBuffer.length > 12) r.tailBuffer.shift();
    if (r.tailVisible) {
      setTailContent(
        r.tailBuffer.map((t, j) => ({
          text: t.text,
          color: t.color || null,
          opacity: 0.15 + (j / r.tailBuffer.length) * 0.85,
        }))
      );
    }

    const pct = Math.round((i / r.words.length) * 100);
    setProgress(pct);
    setCurrentWordIdx(i);

    // Update cursor position on EVERY word for real-time animation
    const frac = i / r.words.length;
    setCursorPct(frac * 100);

    // Update active bar in weight visualization
    const barCount = weightBars.length || 200;
    const step = Math.max(1, Math.floor(r.words.length / barCount));
    setActiveBarIdx(Math.floor(i / step));

    if (i % 40 === 0) {
      const ch = getCurChapter();
      setCurrentChapter(ch);
      setChIndLabel(ch);
    }
  }

  const finishReading = useCallback(async () => {
    const r = readerRef.current;
    clearTimeout(r.timer!);
    r.timer = null;
    const el = Date.now() - r.sessionStart;
    const wc = r.words.length;
    const aw = Math.round((wc / el) * 6e4);
    const cpOk = r.cpResultsRef.filter((x) => x.correct).length;
    const cpTot = r.cpResultsRef.length;

    setSumWords(wc);
    setSumWpm(aw);
    setSumTime(el);
    setSumPages(Math.round(wc / 238));
    setCpResults([...r.cpResultsRef]);
    setSumFlashcards(flashcards);

    const cpScore = cpTot ? Math.round((cpOk / cpTot) * 100) : null;
    setCpScorePct(cpScore);

    const retH = 0.01;
    const retV = Math.round(retCalc(retH, aw) * 100);
    setRetNow(retV + "%");
    setRetNote(
      "At " + aw + " WPM with dynamic pacing, review flashcards within 24h to push retention above 80%."
    );
    setSumTakeaways("loading");
    setOpenFc(null);
    setFlippedCards(new Set());
    setSeenCards(new Set());
    setScreen("summary");

    // Save session
    if (user) {
      await supabase.from("reading_sessions").insert({
        user_id: user.id,
        words: wc,
        wpm: aw,
        time_ms: el,
        cp_score: cpScore,
      });
      setSessions((prev) => [{ words: wc, wpm: aw, time: el, cpScore, date: Date.now() }, ...prev]);
    }

    // Draw retention curve
    setTimeout(() => {
      if (retCanvasRef.current) drawRet(retCanvasRef.current, aw);
    }, 100);

    // Generate summary — small delay to avoid rate-limit collision with priming calls
    const text = inputText.trim();
    if (text.length > 50) {
      await new Promise(r => setTimeout(r, 1500));
      const fn = focusText ? ' Focus: "' + focusText + '".' : "";
      const r2 = await callClaude(
        [{ role: "user", content: 'Summarize in 4-6 bullets (•). Be specific, cite details. Cover the ENTIRE text across all sections.' + fn + ' Text: """' + text.slice(0, 8000) + '"""' }],
        700,
        MODEL_SMART,
        2 // extra retries for the summary
      );
      if (r2) {
        setSumTakeaways(r2);
      } else {
        // Local fallback: extract key sentences
        const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 40);
        const picks = [
          sentences[0],
          sentences[Math.floor(sentences.length * 0.25)],
          sentences[Math.floor(sentences.length * 0.5)],
          sentences[Math.floor(sentences.length * 0.75)],
          sentences[sentences.length - 1],
        ].filter(Boolean).slice(0, 5);
        setSumTakeaways(picks.map(s => "• " + s.trim()).join("\n") || "• " + text.slice(0, 300) + "…");
      }
    } else {
      setSumTakeaways("Too short.");
    }
  }, [user, inputText, focusText, flashcards]);

  const runReader = useCallback(() => {
    const r = readerRef.current;
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }

    function tick() {
      const r2 = readerRef.current;
      if (r2.currentIdx >= r2.words.length) {
        finishReading();
        return;
      }
      if (checkpointsEnabled && r2.nextCpAt > 0 && r2.currentIdx >= r2.nextCpAt) {
        r2.nextCpAt = -1;
        showCheckpoint();
        return;
      }
      displayWord(r2.currentIdx);
      r2.timer = setTimeout(tick, getDelay(r2.currentIdx));
      r2.currentIdx++;
    }
    tick();
  }, [finishReading]);

  function showCheckpoint() {
    const r = readerRef.current;
    const idx = r.cpResultsRef.length;
    const cps = r.checkpointsRef;
    if (idx >= cps.length) {
      runReader();
      return;
    }
    const cp = cps[idx];
    if (!cp || !cp.options) { runReader(); return; }

    // Shuffle options
    const order = cp.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const correctShuf = order.indexOf(cp.correct);
    const shuffledOptions = order.map((orig) => cp.options[orig]);
    setCpQuestion(cp.q);
    setCpOptions(shuffledOptions);
    setCpAnswered(new Array(shuffledOptions.length).fill(null));
    setCpFeedback("");
    setCpShowGo(false);
    setCpVisible(true);

    // Store correct position for answer checking
    readerRef.current.nextCpAt = -1;
    (readerRef.current as { _cpCorrectIdx?: number })._cpCorrectIdx = correctShuf;
  }

  function answerCheckpoint(idx: number) {
    const r = readerRef.current as { _cpCorrectIdx?: number } & typeof readerRef.current;
    const correctIdx = r._cpCorrectIdx ?? 0;
    const isRight = idx === correctIdx;
    setCpAnswered((prev) => {
      const next = [...prev];
      next[idx] = isRight ? "ok" : "no";
      if (!isRight) next[correctIdx] = "ok";
      return next;
    });
    const result = { correct: isRight };
    readerRef.current.cpResultsRef.push(result);
    setCpFeedback(isRight ? "Correct — strong recall." : "Not quite. Review the flashcards after.");
    setCpShowGo(true);

    // Set next checkpoint
    const doneCount = readerRef.current.cpResultsRef.length;
    const fracs = [0.25, 0.5, 0.75];
    if (doneCount < fracs.length) {
      readerRef.current.nextCpAt = Math.floor(readerRef.current.words.length * fracs[doneCount]);
    } else {
      readerRef.current.nextCpAt = -1;
    }
  }

  function closeCheckpoint() {
    setCpVisible(false);
    isPausedRef.current = false;
    setIsPaused(false);
    runReader();
  }

  function startReading() {
    const r = readerRef.current;
    r.sessionStart = Date.now();
    r.cpResultsRef = [];
    r.tailBuffer = [];
    r.tailVisible = false;
    r.chaptersRef = chapters;
    r.checkpointsRef = checkpoints;
    r.nextCpAt = checkpoints.length ? Math.floor(r.words.length * 0.25) : -1;
    setTailVisible(false);
    isPausedRef.current = false;
    setIsPaused(false);
    setProgress(0);
    buildWeightBars();
    setScreen("reader");
    setTimeout(runReader, 50);
  }

  function togglePause() {
    const r = readerRef.current;
    const newPausedState = !isPausedRef.current;
    isPausedRef.current = newPausedState;

    if (newPausedState) {
      // Pause
      if (r.timer) { clearTimeout(r.timer); r.timer = null; }
      setIsPaused(true);
    } else {
      // Resume
      setIsPaused(false);
      runReader();
    }
  }

  function goBack() {
    const r = readerRef.current;
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    let i = Math.max(0, r.currentIdx - 2);
    while (i > 0 && !/[.!?]["']?$/.test(r.words[i - 1]?.text)) i--;
    r.currentIdx = i;
    r.tailBuffer = [];
    setTailContent([]);
    if (!isPausedRef.current) runReader();
    else displayWord(r.currentIdx);
  }

  function skipSentence() {
    const r = readerRef.current;
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    let i = r.currentIdx;
    while (i < r.words.length && !/[.!?]$/.test(r.words[i]?.text)) i++;
    r.currentIdx = Math.min(i + 1, r.words.length - 1);
    r.tailBuffer = [];
    setTailContent([]);
    if (!isPausedRef.current) runReader();
    else displayWord(r.currentIdx);
  }

  function seekTo(idx: number) {
    const r = readerRef.current;
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    r.currentIdx = Math.max(0, Math.min(idx, r.words.length - 1));
    r.tailBuffer = [];
    setTailContent([]);
    if (!isPausedRef.current) runReader();
    else displayWord(r.currentIdx);
  }

  function handleBack() {
    const bref = backClickRef.current;
    bref.count++;
    if (bref.count >= 2) {
      if (bref.timer) clearTimeout(bref.timer);
      bref.count = 0;
      seekTo(0);
    } else {
      bref.timer = setTimeout(() => {
        bref.count = 0;
        goBack();
      }, 400);
    }
  }

  function scrubFromX(clientX: number) {
    const wrap = progWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTo(Math.floor(pct * readerRef.current.words.length));
  }

  function handleProgMouseDown(e: React.MouseEvent) {
    progIsScrubbing.current = true;
    scrubFromX(e.clientX);
  }

  function handleProgTouchStart(e: React.TouchEvent) {
    e.preventDefault();
    scrubFromX(e.touches[0].clientX);
  }

  function updateWpm(v: number) {
    readerRef.current.wpm = v;
    setWpm(v);
  }

  function setTailVisibility(v: boolean) {
    readerRef.current.tailVisible = v;
    setTailVisible(v);
    if (!v) setTailContent([]);
  }

  function openToc() {
    if (!isPaused) togglePause();
    setTocVisible(true);
  }

  function jumpToChapter(ch: Chapter) {
    readerRef.current.currentIdx = ch.startIdx;
    readerRef.current.tailBuffer = [];
    setTailContent([]);
    setTocVisible(false);
    if (!isPaused) runReader();
    else displayWord(ch.startIdx);
  }

  // ── Retention curve ──
  function drawRet(cv: HTMLCanvasElement, wpm: number) {
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = (cv.width = cv.offsetWidth * 2);
    const H = (cv.height = cv.offsetHeight * 2);
    ctx.clearRect(0, 0, W, H);
    const stab = Math.max(1, 28 - (wpm - 150) / 40);
    ctx.beginPath();
    ctx.strokeStyle = "#00c896";
    ctx.lineWidth = 3;
    for (let x = 0; x <= W; x++) {
      const h = (x / W) * 168;
      const ret = Math.exp(-h / stab);
      const y = H - ret * H * 0.9 - H * 0.05;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "#3a5068";
    ctx.font = H * 0.08 + 'px "Courier New"';
    ctx.textAlign = "center";
    ["now", "1h", "6h", "1d", "3d", "1wk"].forEach((l, i) => {
      const f = [0, 1 / 168, 6 / 168, 24 / 168, 72 / 168, 1];
      ctx.fillText(l, f[i] * W + 2, H - 2);
    });
  }

  function replay() {
    const r = readerRef.current;
    r.currentIdx = 0;
    r.tailBuffer = [];
    r.cpResultsRef = [];
    r.sessionStart = Date.now();
    r.nextCpAt = r.checkpointsRef.length ? Math.floor(r.words.length * 0.25) : -1;
    r.tailVisible = false;
    setTailVisible(false);
    isPausedRef.current = false;
    setIsPaused(false);
    setProgress(0);
    setScreen("reader");
    setTimeout(runReader, 50);
  }

  function goToIntake() {
    setScreen("intake");
  }

  // ── Keyboard shortcuts (using refs to avoid stale closures) ──
  useEffect(() => {
    if (screen !== "reader" && screen !== "text") return;
    function onKey(e: KeyboardEvent) {
      if (tocVisible || cpVisible) return;
      if (screen === "reader") {
        if (e.key === "ArrowUp") setTailVisibility(true);
        if (e.key === "ArrowDown") setTailVisibility(false);
        if (e.key === "ArrowLeft") goBack();
        if (e.key === "ArrowRight") skipSentence();
        if (e.key === "t" || e.key === "T") openToc();
        if (e.key === "Escape") setTocVisible(false);
      }
      if (e.key === " ") { e.preventDefault(); togglePause(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, tocVisible, cpVisible]);

  // ── Progress bar scrub mouse events ──
  useEffect(() => {
    if (screen !== "reader" && screen !== "text") return;
    function onMove(e: MouseEvent) { if (progIsScrubbing.current) scrubFromX(e.clientX); }
    function onUp() { progIsScrubbing.current = false; }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [screen]);

  // ── Auto-scroll text view to current word ──
  useEffect(() => {
    if (screen !== "text") return;
    const el = document.getElementById(`tw-${currentWordIdx}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentWordIdx, screen]);

  // Touch swipe
  useEffect(() => {
    if (screen !== "reader") return;
    let ty = 0;
    const ts = (e: TouchEvent) => { ty = e.touches[0].clientY; };
    const te = (e: TouchEvent) => {
      const d = ty - e.changedTouches[0].clientY;
      if (d > 40) setTailVisibility(true);
      if (d < -40) setTailVisibility(false);
    };
    window.addEventListener("touchstart", ts, { passive: true });
    window.addEventListener("touchend", te, { passive: true });
    return () => {
      window.removeEventListener("touchstart", ts);
      window.removeEventListener("touchend", te);
    };
  }, [screen]);

  // ── Derived stats ──
  const totalWordsRead = sessions.reduce((a, s) => a + s.words, 0);
  const avgWpm = sessions.length
    ? Math.round(sessions.reduce((a, s) => a + s.wpm, 0) / sessions.length)
    : 0;

  // ── Render ──
  return (
    <>
      {/* ===== INTAKE ===== */}
      {screen === "intake" && (
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <div className="hdr">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div className="logo">
                <span className="lm">m</span><span className="lr">nemo</span>
              </div>
              <div className="badge">BETA</div>
            </div>
            <div className="hdr-r">read it. keep it.</div>
          </div>

          <div className="intake">
            {/* Hero */}
            <div className="hero">
              <div className="hero-title">
                <span className="hm">m</span><span className="hr">nemo</span>
              </div>
              <div className="hero-tag">read faster. retain more. forget nothing.</div>
            </div>

            {/* Reading estimate pills — shown at top when text is loaded */}
            <div className={`est-row${wordCount > 20 ? " vis" : ""}`}>
              <div className="est-pill"><span className="en">{wordCount.toLocaleString()}</span> words</div>
              <div className="est-pill">~<span className="en">{estMins}</span> min at {wpm} WPM</div>
              <div className="est-pill">~<span className="en">{estPages}</span> pages</div>
            </div>

            {/* WPM selector */}
            <div className="wpm-intake-row">
              <label className="wpm-intake-lbl">Reading speed</label>
              <input
                type="range"
                min={100}
                max={800}
                step={25}
                value={wpm}
                onChange={(e) => updateWpm(Number(e.target.value))}
                style={{ flex: 1, accentColor: "var(--teal)" }}
              />
              <span className="wpm-intake-val">{wpm} wpm</span>
            </div>

            {/* Auth */}
            <div className="auth-panel">
              {user ? (
                <div className="auth-user">
                  <span>✓ {user.email}</span>
                  <button className="auth-signout" onClick={handleSignOut}>sign out</button>
                </div>
              ) : (
                <>
                  <div className="auth-title">
                    {authMode === "signin" ? "SIGN IN" : "SIGN UP"} — save sessions & bookmarks across devices
                  </div>
                  <div className="auth-row">
                    <input
                      className="auth-in"
                      type="email"
                      placeholder="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                    />
                    <input
                      className="auth-in"
                      type="password"
                      placeholder="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                    />
                    <button className="auth-btn pri" onClick={handleAuth}>
                      {authMode === "signin" ? "SIGN IN" : "SIGN UP"}
                    </button>
                    <button
                      className="auth-btn sec"
                      onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthError(""); }}
                    >
                      {authMode === "signin" ? "Need account?" : "Have account?"}
                    </button>
                  </div>
                  {authError && (
                    <div style={{ fontSize: 11, color: "var(--red)", marginTop: 6 }}>{authError}</div>
                  )}
                </>
              )}
            </div>

            {/* Bookmarks */}
            {bookmarks.length > 0 && (
              <div className="bm-sec">
                <div className="bm-hdr">SAVED SESSIONS</div>
                <div className="bm-list">
                  {bookmarks.map((bm) => {
                    const p = Math.round((bm.pos / bm.wc) * 100);
                    return (
                      <div key={bm.id} className="bm-item">
                        <div className="bm-l">
                          <div className="bm-name">{bm.title}</div>
                          <div className="bm-meta">{p}% · {bm.wpm} WPM · {timeAgoLocal(bm.at)}</div>
                        </div>
                        <div className="bm-bar">
                          <div className="bm-bar-f" style={{ width: p + "%" }} />
                        </div>
                        <button className="bm-res" onClick={() => openBookmark(bm.id)}>RESUME</button>
                        <button className="bm-del" onClick={() => deleteBookmark(bm.id)}>✕</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Textarea */}
            <div style={{ width: "100%", marginBottom: 16 }}>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste your reading here — article, textbook, case study, anything..."
              />
            </div>

            {/* Upload */}
            <div className="divider">
              <div className="divider-line" />
              <div className="divider-lbl">OR UPLOAD</div>
              <div className="divider-line" />
            </div>
            <label className="upload">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className="upload-txt">{uploadLabel}</span>
              <input
                type="file"
                accept=".pdf,.epub,.pptx,.mne,.mnemo"
                style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
              />
            </label>
            <div className="ch-status">{uploadStatus}</div>

            {/* Detected chapters — clickable to auto-fill focus */}
            {chapters.length > 0 && (
              <div style={{
                width: "100%",
                margin: "8px 0",
                padding: "10px 12px",
                background: "var(--bg2)",
                borderRadius: 6,
                border: "1px solid var(--border)",
                maxHeight: 160,
                overflowY: "auto",
              }}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, color: "var(--gray3)", marginBottom: 6, fontWeight: 600 }}>
                  TABLE OF CONTENTS ({chapters.length} chapters)
                </div>
                {chapters.map((ch, i) => (
                  <div
                    key={i}
                    onClick={() => setFocusText("Only Chapter " + (i + 1))}
                    style={{
                      fontSize: 12,
                      color: "var(--text)",
                      padding: "4px 6px",
                      cursor: "pointer",
                      borderRadius: 4,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "var(--border)")}
                    onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span>{ch.title}</span>
                    <span style={{ fontSize: 10, color: "var(--gray3)" }}>
                      {ch.endIdx - ch.startIdx + 1} words
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Focus */}
            <div className="focus-row">
              <div className="focus-lbl">FOCUS INSTRUCTIONS <span style={{ color: "var(--gray3)" }}>(OPTIONAL)</span></div>
              <input
                type="text"
                className="focus-in"
                placeholder='e.g. "Only Chapter 1" or "Focus on key arguments"'
                value={focusText}
                onChange={(e) => setFocusText(e.target.value)}
              />
            </div>

            <button className="go-btn" onClick={startPriming} disabled={wordCount < 10}>
              PRIME &amp; START READING →
            </button>

            {/* Footer */}
            <div style={{
              marginTop: 40,
              paddingTop: 20,
              borderTop: "1px solid var(--border)",
              width: "100%",
              display: "flex",
              justifyContent: "center",
              gap: 20,
              fontSize: 11,
              color: "var(--gray3)",
              fontFamily: "var(--display)",
            }}>
              <a href="/privacy" style={{ color: "var(--gray3)", textDecoration: "none" }}
                onMouseOver={(e) => (e.currentTarget.style.color = "var(--teal)")}
                onMouseOut={(e) => (e.currentTarget.style.color = "var(--gray3)")}>
                Privacy Policy
              </a>
              <span>·</span>
              <span>mnemo BETA — feedback helps us improve</span>
            </div>
          </div>
        </div>
      )}

      {/* ===== PRIMING ===== */}
      {screen === "prime" && (
        <div className="prime-screen">
          <div className="p-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--teal)", width: 20, height: 20 }}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <div className="p-title">Building your <span className="pm">m</span><span className="pr">nemo</span></div>
          <div className="p-status">{primeStatus}</div>
          <div className="p-steps">
            {["Mapping structure & key terms", "Scoring lexical weights per token", "Building comprehension schema", "Generating checkpoints & flashcards"].map((label, i) => (
              <div key={i} className={`p-step${primeSteps[i] === "done" ? " done" : primeSteps[i] === "active" ? " active" : ""}`}>
                <div className="s-dot" />
                {label}
              </div>
            ))}
          </div>
          {primeDone && (
            <button className="start-btn" onClick={startReading}>
              START READING →
            </button>
          )}
        </div>
      )}

      {/* ===== RSVP READER ===== */}
      {screen === "reader" && (
        <div className="reader-screen">
          {/* Thick scrubable progress bar */}
          <div
            ref={progWrapRef}
            className="prog-wrap"
            onMouseDown={handleProgMouseDown}
            onTouchStart={handleProgTouchStart}
          >
            <div className="prog-bar" style={{ width: progress + "%" }} />
            <div className="prog-thumb" style={{ left: progress + "%" }} />
          </div>
          {/* Top row */}
          <div className="reader-top">
            <div className="reader-top-left">
              <span className="reader-pos">{currentWordIdx} / {readerRef.current.words.length || 0}</span>
              <button className="mini-btn" onClick={openToc}>☰ TOC</button>
            </div>
            <div className="reader-top-right">
              <button
                className="mini-btn"
                onClick={() => setCheckpointsEnabled(e => !e)}
                style={{ opacity: checkpointsEnabled ? 1 : 0.4 }}
                title={checkpointsEnabled ? "Checkpoints on — click to disable" : "Checkpoints off — click to enable"}
              >
                {checkpointsEnabled ? "✓ Checks" : "✗ Checks"}
              </button>
              <button className="mini-btn" onClick={saveBookmark}>Save</button>
              <button className="mini-btn" onClick={() => { setTextBuilt(false); setScreen("text"); if (!isPausedRef.current) togglePause(); }}>Text view</button>
            </div>
          </div>

          {/* Stage */}
          <div className="reader-stage">
            {/* Semantic tail */}
            <div className={`sem-tail${tailVisible ? " vis" : ""}`}>
              {tailContent.map((t, i) => (
                <span
                  key={i}
                  style={{
                    opacity: t.opacity,
                    color: t.color === "orange" ? "var(--orange)" : t.color === "green" ? "var(--teal)" : "var(--gray3)",
                    fontWeight: t.color ? 600 : 400,
                  }}
                >
                  {t.text}{" "}
                </span>
              ))}
            </div>

            {chIndLabel && (
              <div className="ch-lbl" onClick={openToc}>☰ {chIndLabel}</div>
            )}

            {/* ORP word (tap to pause/resume on mobile) */}
            <div
              className="orp-wrap"
              onClick={togglePause}
              style={{ cursor: "pointer", userSelect: "none" }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") togglePause(); }}
            >
              <div className="orp-tick orp-tick-t" />
              <div className={`orp-word${wordColor ? " c-" + wordColor : ""}`}>
                <span className="ob">{wordBefore}</span>
                <span className="op">{wordPivot}</span>
                <span className="oa">{wordAfter}</span>
              </div>
              <div className="orp-tick orp-tick-b" />
            </div>

            {/* Weight bars */}
            <div className="wbar-wrap" ref={wbarRef}>
              <div className="wbar-label">SEMANTIC WEIGHT</div>
              <div className="wbar-inner">
                <div
                  className="wbar-cursor"
                  style={{ left: cursorPct + "%" }}
                />
                {weightBars.map((bar, i) => {
                  const isRead = i < activeBarIdx;
                  return (
                    <div
                      key={i}
                      className="wb"
                      style={{
                        height: bar.h,
                        background: bar.c,
                        opacity: isRead ? 0.35 : 1,
                        width: Math.max(2, Math.floor(600 / Math.min(weightBars.length, 200))),
                        transition: "opacity 0.15s ease",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* WPM slider */}
          <div className="reader-wpm-row">
            <input
              type="range"
              min={150}
              max={600}
              step={25}
              value={wpm}
              onChange={(e) => updateWpm(Number(e.target.value))}
            />
            <span className="reader-wpm-val">{wpm} wpm</span>
          </div>

          {/* Icon controls */}
          <div className="reader-controls">
            <button className="btn-icon" title="Prev sentence (double = restart)" onClick={handleBack}>◀</button>
            <button className="btn-icon btn-pp" onClick={togglePause}>{isPaused ? "▶" : "⏸"}</button>
            <button className="btn-icon" title="Next sentence" onClick={skipSentence}>▶</button>
          </div>

          {/* TOC overlay — chapters + saved positions */}
          <div className={`toc-ov${tocVisible ? " vis" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) setTocVisible(false); }}>
            <div className="toc-pan">
              <div className="toc-h">
                <div className="toc-t">TABLE OF CONTENTS</div>
                <button className="toc-x" onClick={() => setTocVisible(false)}>✕</button>
              </div>
              <div className="toc-items">
                {chapters.length === 0 ? (
                  <div className="toc-empty">No chapters detected.</div>
                ) : (
                  chapters.map((ch, i) => (
                    <div
                      key={i}
                      className={`toc-it${readerRef.current.currentIdx >= ch.startIdx && readerRef.current.currentIdx <= ch.endIdx ? " cur" : ""}`}
                      onClick={() => jumpToChapter(ch)}
                    >
                      <div className="toc-it-n">{i + 1}</div>
                      <div>{ch.title}</div>
                    </div>
                  ))
                )}
              </div>
              {bookmarks.length > 0 && (
                <>
                  <div className="toc-divider" />
                  <div className="toc-bm-hdr">SAVED POSITIONS</div>
                  <div className="toc-items">
                    {bookmarks.map((bm) => {
                      const p = Math.round((bm.pos / bm.wc) * 100);
                      return (
                        <div key={bm.id} className="toc-bm-item" onClick={() => { openBookmark(bm.id); setTocVisible(false); }}>
                          <div className="toc-bm-title">{bm.title}</div>
                          <div className="toc-bm-meta">{p}% · {bm.wpm} WPM</div>
                          <div className="bm-bar" style={{ marginTop: 4 }}>
                            <div className="bm-bar-f" style={{ width: p + "%" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Checkpoint overlay */}
          <div className={`cp-ov${cpVisible ? " vis" : ""}`}>
            <div className="cp-card">
              <div className="cp-lbl">COMPREHENSION CHECKPOINT</div>
              <div className="cp-q">{cpQuestion}</div>
              <div className="cp-opts">
                {cpOptions.map((opt, i) => (
                  <div
                    key={i}
                    className={`cp-opt${cpAnswered[i] === "ok" ? " ok" : cpAnswered[i] === "no" ? " no" : ""}`}
                    onClick={() => {
                      if (cpAnswered.some((a) => a !== null)) return;
                      answerCheckpoint(i);
                    }}
                  >
                    {opt}
                  </div>
                ))}
              </div>
              <div className="cp-fb">{cpFeedback}</div>
              <button className={`cp-go${cpShowGo ? " vis" : ""}`} onClick={closeCheckpoint}>
                CONTINUE READING →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TEXT VIEW ===== */}
      {screen === "text" && (
        <div className="text-screen">
          {/* Scrubable progress bar */}
          <div
            ref={progWrapRef}
            className="prog-wrap"
            onMouseDown={handleProgMouseDown}
            onTouchStart={handleProgTouchStart}
          >
            <div className="prog-bar" style={{ width: progress + "%" }} />
            <div className="prog-thumb" style={{ left: progress + "%" }} />
          </div>
          <div className="text-nav">
            <div className="text-nav-left">
              <button className="btn-icon" style={{ width: 34, height: 34, fontSize: 13 }} onClick={togglePause}>
                {isPaused ? "▶" : "⏸"}
              </button>
              <span className="text-nav-pos">{currentWordIdx} / {readerRef.current.words.length || 0}</span>
            </div>
            <div className="text-nav-right">
              <button className="mini-btn" onClick={saveBookmark}>Save</button>
              <button className="mini-btn" onClick={() => setScreen("reader")}>mnemo</button>
            </div>
          </div>
          <div className="text-body">
            {readerRef.current.words.map((w, i) => {
              const colorCls = w.color === "green" ? " tc-green" : w.color === "orange" ? " tc-orange" : w.color === "mnemo" ? " tc-mnemo" : "";
              const isCur = i === currentWordIdx;
              return (
                <span
                  key={i}
                  id={`tw-${i}`}
                  className={`tw${colorCls}${isCur ? " cur" : ""}`}
                  onClick={() => seekTo(i)}
                >
                  {w.text}{" "}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== SUMMARY ===== */}
      {screen === "summary" && (
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <div className="hdr">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div className="logo"><span className="lm">m</span><span className="lr">nemo</span></div>
              <div className="badge">BETA</div>
            </div>
            <div className="hdr-r">session complete</div>
          </div>
          <div className="sum-in">
            <div className="sum-done">SESSION COMPLETE</div>
            <div className="sum-hl">
              <span className="sh-w">Read faster. Retained more. </span>
              <span className="sh-t">Forgot nothing.</span>
            </div>

            {/* Stats */}
            <div className="sum-stats">
              {[
                { n: sumWords.toLocaleString(), l: "words" },
                { n: sumWpm, l: "effective WPM" },
                { n: fmtTime(sumTime), l: "time" },
                { n: sumPages, l: "pages" },
              ].map((s, i) => (
                <div key={i} className="sc">
                  <div className="sc-n">{s.n}</div>
                  <div className="sc-l">{s.l}</div>
                </div>
              ))}
            </div>

            {/* Retention curve */}
            <div className="ret-sec">
              <div className="ret-lbl">ESTIMATED RETENTION CURVE</div>
              <div className="ret-card">
                <div className="ret-curve">
                  <canvas ref={retCanvasRef} style={{ width: "100%", height: "100%" }} />
                </div>
                <div className="ret-now">{retNow}</div>
                <div className="ret-now-l">est. now</div>
                <div className="ret-note">{retNote}</div>
              </div>
            </div>

            {/* Checkpoint score */}
            {cpScorePct !== null && (
              <div className="cp-score-sec">
                <div className="ret-lbl">COMPREHENSION SCORE</div>
                <div className="cp-sc-card">
                  <div className="cp-ring">
                    <svg viewBox="0 0 56 56">
                      <circle cx="28" cy="28" r="24" fill="none" stroke="var(--border)" strokeWidth="4" />
                      <circle
                        cx="28" cy="28" r="24" fill="none"
                        stroke={cpScorePct >= 67 ? "var(--teal)" : cpScorePct >= 33 ? "var(--orange)" : "var(--red)"}
                        strokeWidth="4"
                        strokeDasharray="150.8"
                        strokeDashoffset={150.8 - (cpScorePct / 100) * 150.8}
                        strokeLinecap="round"
                        style={{ transform: "rotate(-90deg)", transformOrigin: "28px 28px" }}
                      />
                    </svg>
                    <div className="cp-ring-v">{cpScorePct}%</div>
                  </div>
                  <div className="cp-sc-d">
                    <div className="cp-sc-t">CHECKPOINT ACCURACY</div>
                    <div className="cp-sc-txt">
                      {cpResults.filter((r) => r.correct).length}/{cpResults.length} correct.{" "}
                      {cpScorePct >= 67 ? "Strong comprehension." : cpScorePct >= 33 ? "Decent — review flashcards." : "Consider slower WPM."}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Key takeaways */}
            <div className="sum-sec">
              <div className="ss-t">KEY TAKEAWAYS</div>
              <div className="sum-txt">
                {sumTakeaways === "loading" ? (
                  <div className="spinner" />
                ) : (
                  sumTakeaways.split("\n").filter((l) => l.trim()).map((l, i) => (
                    <div key={i} style={{ marginBottom: 5 }}>{l}</div>
                  ))
                )}
              </div>
            </div>

            {/* Flashcards — flip-card design */}
            <div className="sum-sec">
              <div className="ss-t">
                SPACED RETRIEVAL FLASHCARDS
                {sumFlashcards.length > 0 && (
                  <span style={{ fontSize: 10, color: "var(--gray3)", marginLeft: 8, fontWeight: 400, fontFamily: "var(--ui)" }}>
                    tap to reveal · {seenCards.size}/{sumFlashcards.length} reviewed
                  </span>
                )}
              </div>
              <div className="fc-list">
                {sumFlashcards.length === 0 ? (
                  <div style={{ color: "var(--gray3)", fontSize: 11 }}>No flashcards generated.</div>
                ) : (
                  <>
                    {sumFlashcards.map((fc, i) => {
                      const isFlipped = flippedCards.has(i);
                      return (
                        <div
                          key={i}
                          className={`fc-card${isFlipped ? " flipped" : ""}`}
                          onClick={() => {
                            setFlippedCards(prev => {
                              const next = new Set(prev);
                              if (next.has(i)) next.delete(i); else next.add(i);
                              return next;
                            });
                            setSeenCards(prev => new Set(prev).add(i));
                          }}
                        >
                          <div className="fc-card-inner">
                            <div className="fc-front">
                              <div className="fc-label">QUESTION {i + 1} / {sumFlashcards.length}</div>
                              <div className="fc-text">{fc.q}</div>
                              <div className="fc-hint">tap to reveal answer →</div>
                            </div>
                            <div className="fc-back">
                              <div className="fc-label">ANSWER</div>
                              <div className="fc-text">{fc.a}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {/* Progress dots */}
                    <div className="fc-progress">
                      {sumFlashcards.map((_, i) => (
                        <div key={i} className={`fc-dot${seenCards.has(i) ? " seen" : ""}`} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="sum-acts">
              <button className="s-btn pri" onClick={goToIntake}>READ ANOTHER</button>
              <button className="s-btn sec" onClick={replay}>REPLAY</button>
              <button
                className="s-btn sec"
                onClick={exportMnemo}
                title="Save as .mne for instant loading next time"
                style={{ borderColor: "var(--teal)", color: "var(--teal)" }}
              >
                ↓ SAVE .mne
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== BOOKMARK MODAL ===== */}
      <div className={`modal${bmModalVisible ? " vis" : ""}`}>
        <div className="m-card">
          <div className="m-lbl">RETURNING TO SAVED SESSION</div>
          <div className="m-ttl">{bmModalTitle}</div>
          <div className="m-body">{bmModalBody}</div>
          <div className="fgt-w">
            <div className="fgt-lbl">
              <span>Estimated retention</span>
              <span>{bmModalRetPct}</span>
            </div>
            <div className="fgt-tr">
              <div className="fgt-f" style={{ width: bmModalRet + "%" }} />
            </div>
          </div>
          <div className="m-btns">
            <button className="mb pri" onClick={resumeBookmark}>RESUME</button>
            <button className="mb sec" onClick={() => setBmModalVisible(false)}>START OVER</button>
          </div>
        </div>
      </div>

      {/* ===== TOAST ===== */}
      <div className={`toast${toastVisible ? " show" : ""}`}>{toastMsg}</div>

      {/* ===== ONBOARDING (first visit only) ===== */}
      <OnboardingOverlay />

      {/* ===== FEEDBACK WIDGET ===== */}
      <FeedbackWidget />
    </>
  );
}

export default function MnemoApp() {
  return (
    <ErrorBoundary>
      <MnemoAppInner />
    </ErrorBoundary>
  );
}
