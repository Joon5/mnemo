# .mne File Format Specification — v1

> **mnemo session format** — a portable, pre-processed speed-reading session.
> The format exists independently of any reader. Any app can implement a reader.

---

## Overview

`.mne` files package everything needed to start reading instantly — word-by-word timing,
semantic weights, comprehension checkpoints, flashcards, and chapter structure — all
computed once by AI, then distributed freely.

**Core idea:** AI processing is expensive and slow. Do it once. Share the result everywhere.

| Property | Value |
|---|---|
| Extension | `.mne` |
| MIME type | `application/x-mne` |
| Encoding | UTF-8 JSON |
| Version | 1 |

---

## File Structure

```json
{
  "v": 1,
  "id": "uuid-v4",
  "created": "2024-01-15T10:30:00Z",

  "meta": {
    "title":   "The Prince — Chapter 1",
    "subject": "Political Philosophy",
    "author":  "Niccolò Machiavelli",
    "source":  "the_prince.pdf",
    "lang":    "en",
    "wc":      1247,
    "mins":    4,
    "model":   "claude-sonnet-4-20250514"
  },

  "schema": {
    "summary":  "2-3 sentence orientation for the reader...",
    "keywords": ["monarchy", "republic", "hereditary", "conquest"],
    "themes":   ["power", "governance", "legitimacy"]
  },

  "chapters": [
    { "i": 0, "t": "Chapter I — All States and Governments", "s": 0,  "e": 312 },
    { "i": 1, "t": "Chapter II — Hereditary Monarchies",     "s": 313, "e": 689 }
  ],

  "words": [
    "All",
    ["states", 0, 1],
    "and",
    ["governments", 2],
    "that",
    ["ever", 1],
    ["ruled", 1, 1],
    "over",
    "men"
  ],

  "cards": [
    { "q": "What two categories does Machiavelli use to classify all governments?", "a": "Republics and Monarchies." },
    { "q": "What are the two types of monarchy?",                                  "a": "Hereditary and new." }
  ],

  "checks": [
    {
      "q": "According to Machiavelli, what are the two fundamental forms of government?",
      "o": ["Republics and Monarchies", "Democracies and Oligarchies", "Kingdoms and Empires", "Federations and States"],
      "c": 0,
      "at": 0.25
    }
  ]
}
```

---

## Words Array — Compact Encoding

Each element is either a **string** or a **3-element array**:

### String (most common — ~85% of words)
```
"the"  →  { text: "the", color: null, pause: false }
```
No color, no extra pause. Just text at base delay (196ms).

### Array: `[text, color, pause?]`
```
["Monarchies", 2]     →  { text: "Monarchies", color: "orange", pause: true }
["hereditary",  1]    →  { text: "hereditary",  color: "green",  pause: false }
["freedom",     1, 1] →  { text: "freedom",     color: "green",  pause: true }
["—",           0, 1] →  { text: "—",           color: null,     pause: true }
```

### Color codes
| Code | Meaning | Internal name | Visual |
|------|---------|---------------|--------|
| `0` / omit | No highlight | `null` | white |
| `1` | Important qualifier / distinction | `"green"` | **green** `#00c896` |
| `2` | Core concept / category label | `"orange"` | **orange** `#f5a623` |
| `3` | mnemo brand / proper noun term | `"mnemo"` | **teal** `#00c896` bold |

### Pause
`1` = display at `WEIGHTED_DELAY` (210ms × WPM scale). Omit = base delay.

---

## Timing Reference

| Constant | Value | Used for |
|---|---|---|
| `BASE_DELAY` | 196 ms | Normal words |
| `WEIGHTED_DELAY` | 210 ms | Colored or sentence-ending words |
| `INTRO_DELAY` | 316 ms | First word of session |

All delays are scaled by `350 / userWPM` at runtime.

---

## Chapter Index Fields

| Field | Type | Meaning |
|---|---|---|
| `i` | int | Chapter index (0-based) |
| `t` | string | Title (display name) |
| `s` | int | Start word index (inclusive) |
| `e` | int | End word index (inclusive) |

---

## Checkpoint Fields

| Field | Type | Meaning |
|---|---|---|
| `q` | string | Question text |
| `o` | string[4] | Options (first is always correct before shuffle) |
| `c` | int | Index of correct answer (before shuffle) |
| `at` | float | Fraction through text where checkpoint fires (0.25, 0.5, 0.75) |

---

## Design Principles

1. **AI-free at read time.** All processing is done during creation. The reader is dumb.
2. **Compact.** A 50,000-word book is ~2–3 MB as `.mne`. A chapter is ~80 KB.
3. **Human-readable.** Plain JSON. Open in any text editor to inspect.
4. **Versionable.** `"v": 1` allows future format changes without breaking old readers.
5. **Distributable.** Share like a PDF. Email it. Host it. No DRM.

---

## File Size Estimates

| Content | Word Count | Approx `.mne` Size |
|---|---|---|
| Magazine article | 1,000 | ~55 KB |
| Textbook chapter | 5,000 | ~275 KB |
| Short book | 30,000 | ~1.6 MB |
| Full novel | 80,000 | ~4.3 MB |

---

## Reference Implementations

| Platform | Location | Status |
|---|---|---|
| Web app (Next.js) | `/reader` route | ✓ Production |
| Standalone HTML | `public/mnemo-reader.html` | ✓ Distribution |
| CLI creator | `tools/create-mne.js` | ✓ Node.js v18+ |
| Automated agent | `tools/mne-agent.js` | ✓ Scheduled |
