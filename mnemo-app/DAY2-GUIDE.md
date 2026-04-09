# DAY 2 — Test, Deploy, Go Live

## What's already done for you (code already in your project)

These files were pre-built and are ready to go:

- `middleware.ts` — Next.js middleware (sessions, route handling)
- `lib/rate-limit.ts` — API rate limiter (10 req/min per IP, protects your Anthropic bill)
- `app/api/prime/route.ts` — Enhanced API proxy with rate limiting, validation, CORS, error codes
- `app/api/health/route.ts` — Health check endpoint (hit /api/health to verify config)
- `vercel.json` — Vercel deployment config (30s timeout for AI calls)
- `.github/workflows/ci.yml` — CI pipeline (auto-builds on push)
- `supabase-schema-v2.sql` — Enhanced DB schema with velocity tracking + reading history

---

## YOUR Day 2 Tasks (in order)

### PHASE 1: Finish Day 1 if not done (30 min)

1. In Terminal:
   ```bash
   cd ~/Mnemo/mnemo-app
   npm install
   npm run dev
   ```
   Open http://localhost:3000 — you should see the mnemo intake screen.

2. Add your Anthropic API key:
   ```bash
   open .env.local
   ```
   Replace YOUR_ANTHROPIC_API_KEY_HERE with your key from console.anthropic.com

3. Set up Supabase tables:
   ```bash
   cat supabase-schema.sql | pbcopy
   ```
   Paste into https://supabase.com/dashboard/project/zilqvaczinzwyddrnypa/sql/new → Run

4. Test locally: paste some text, click "PRIME & START READING", verify the full flow works.

### PHASE 2: Push to GitHub (5 min)

```bash
cd ~/Mnemo/mnemo-app
git init
git add .
git commit -m "mnemo v0.1 — full speed reading app"
```

Go to https://github.com/new → create repo called `mnemo-app` (private) → then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/mnemo-app.git
git branch -M main
git push -u origin main
```

### PHASE 3: Deploy to Vercel (10 min)

1. Go to https://vercel.com → "Add New Project" → Import `mnemo-app` from GitHub
2. In the "Environment Variables" section, add ALL THREE:

   | Variable | Value |
   |----------|-------|
   | `ANTHROPIC_API_KEY` | sk-ant-... (your key) |
   | `NEXT_PUBLIC_SUPABASE_URL` | https://zilqvaczinzwyddrnypa.supabase.co |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | eyJhbGciOiJIUzI1NiIs... (from .env.local) |

3. Click Deploy — wait 2-3 minutes
4. You'll get a URL like `mnemo-app-xyz.vercel.app`

### PHASE 4: Verify deployment (10 min)

1. Visit your Vercel URL
2. Hit `your-url.vercel.app/api/health` — should show both services as "configured"
3. Test the full flow: paste text → prime → read → summary
4. Test sign up/sign in
5. Test bookmark save/resume

### PHASE 5: Enhanced database (5 min)

Once basic deploy works, upgrade your database:
```bash
cat supabase-schema-v2.sql | pbcopy
```
Paste into Supabase SQL Editor → Run.
This adds velocity tracking and reading history tables for beta analytics.

### PHASE 6: Custom domain (10 min, optional)

If you bought mnemo.app or trymnemo.com:
1. In Vercel → Project Settings → Domains → Add your domain
2. Update DNS at your registrar (Namecheap/Cloudflare):
   - Add CNAME record: `@` → `cname.vercel-dns.com`
3. Vercel auto-provisions SSL

### PHASE 7: Beta testing prep (15 min)

1. Create 3-5 test accounts yourself using different emails
2. Run through the full flow for each:
   - Sign up → paste text → prime → read → checkpoint → summary → bookmark → resume
3. Test edge cases:
   - Very short text (< 20 words)
   - Very long text (paste a full article)
   - PDF upload (if you installed pdfjs-dist)
   - Different WPM speeds
   - Keyboard shortcuts (Space, arrows, T)

---

## What you'll have at the end of Day 2

- Live, deployed app at a public URL
- Working auth (sign up / sign in)
- Full reading flow: intake → AI priming → RSVP reader → summary
- Data persistence (bookmarks, sessions, stats)
- Rate limiting to protect your API costs
- CI pipeline for future code pushes
- Ready for 50-100 beta users
