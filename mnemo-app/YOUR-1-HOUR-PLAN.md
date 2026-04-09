# Your 1-Hour Plan — Do These 6 Things

Everything else is already built. You just need to connect the wires.

---

## 1. GET YOUR ANTHROPIC API KEY (5 min)

1. Go to https://console.anthropic.com
2. Sign up or log in
3. Go to API Keys → Create Key
4. Copy the key (starts with `sk-ant-...`)
5. In Terminal:
   ```bash
   cd ~/Documents/Claude/Projects/Mnemo/mnemo-app
   nano .env.local
   ```
6. Replace `YOUR_ANTHROPIC_API_KEY_HERE` with your key
7. Press Control+X → Y → Enter to save

---

## 2. RUN THE DATABASE SETUP (5 min)

1. In Terminal:
   ```bash
   cat supabase-schema-v3.sql | pbcopy
   ```
2. Open: https://supabase.com/dashboard/project/zilqvaczinzwyddrnypa/sql/new
3. Paste → Click **Run**
   (This creates all tables: sessions, bookmarks, feedback, beta invites, velocity stats)

---

## 3. TEST LOCALLY (10 min)

```bash
cd ~/Documents/Claude/Projects/Mnemo/mnemo-app
npm run dev
```

Open http://localhost:3000 and test:
- [ ] App loads (dark screen with mnemo logo)
- [ ] Onboarding overlay appears on first visit
- [ ] Paste text → click "PRIME & START READING"
- [ ] Priming screen shows progress steps
- [ ] Reader displays words one at a time
- [ ] Pause/resume with spacebar
- [ ] Summary screen shows stats after finishing
- [ ] Sign up with email/password works
- [ ] Feedback button (bottom-right) opens and submits
- [ ] Visit http://localhost:3000/landing — marketing page loads

If priming says "offline mode" — that means your API key isn't set. Go back to step 1.

---

## 4. PUSH TO GITHUB (5 min)

```bash
cd ~/Documents/Claude/Projects/Mnemo/mnemo-app
git init
git add .
git commit -m "mnemo v0.1 — beta ready"
```

Go to https://github.com/new → name it `mnemo-app` (private) → Create → then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/mnemo-app.git
git branch -M main
git push -u origin main
```

---

## 5. DEPLOY TO VERCEL (10 min)

1. Go to https://vercel.com → "Add New Project"
2. Import `mnemo-app` from GitHub
3. Add environment variables (click "Environment Variables"):

   | Name | Value |
   |------|-------|
   | ANTHROPIC_API_KEY | sk-ant-... (your key) |
   | NEXT_PUBLIC_SUPABASE_URL | https://zilqvaczinzwyddrnypa.supabase.co |
   | NEXT_PUBLIC_SUPABASE_ANON_KEY | eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppbHF2YWN6aW56d3lkZHJueXBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDg0MTMsImV4cCI6MjA5MDQ4NDQxM30.QUSSQj_9RLEt8SnlOwS8xjc9IgYu5vLvsl8J97ERYF0 |

4. Click **Deploy** → wait 2-3 min
5. You'll get a URL like `mnemo-app-abc.vercel.app`

---

## 6. VERIFY LIVE SITE (10 min)

Visit your Vercel URL and test:
- [ ] yoursite.vercel.app loads
- [ ] yoursite.vercel.app/api/health shows services "configured"
- [ ] yoursite.vercel.app/landing shows marketing page
- [ ] Full flow works: paste text → prime → read → summary
- [ ] Sign up works
- [ ] Feedback widget works

---

## WHAT'S ALREADY BUILT FOR YOU (Days 3-7 code)

### App Features
- ✅ Full RSVP reader with ORP display
- ✅ AI priming (schema, keywords, word coloring)
- ✅ Comprehension checkpoints
- ✅ Spaced retrieval flashcards
- ✅ Session summary with retention curve
- ✅ Bookmarks (save/resume reading position)
- ✅ PDF and EPUB upload support
- ✅ WPM slider (150-600)
- ✅ Keyboard shortcuts (space, arrows, T)
- ✅ Mobile touch support (tap to pause, swipe for context)

### Infrastructure
- ✅ Supabase auth (email/password)
- ✅ Data persistence (sessions, bookmarks, history)
- ✅ API rate limiting (10 req/min protects your bill)
- ✅ Offline mode (works without API key for testing)
- ✅ Error boundary (no white screen crashes)
- ✅ Security headers
- ✅ GitHub CI pipeline
- ✅ Vercel deployment config

### Beta Features
- ✅ Onboarding overlay (3-slide intro for new users)
- ✅ Feedback widget (floating button, submits to DB)
- ✅ Landing page at /landing with email signup
- ✅ Beta invites table in database
- ✅ Health check endpoint for monitoring

### Database Tables
- ✅ reading_sessions (stats per read)
- ✅ bookmarks (saved reading positions)
- ✅ velocity_stats (daily reading metrics)
- ✅ reading_history (detailed per-session)
- ✅ feedback (user feedback from widget)
- ✅ beta_invites (email signups from landing page)

---

## AFTER YOUR 1 HOUR

Optional polish you can do later:
- Buy domain (mnemo.app or trymnemo.com) → add in Vercel settings
- Install pdfjs-dist and jszip for file uploads: `npm install pdfjs-dist jszip`
- Share your Vercel URL with beta testers
- Check feedback in Supabase: Dashboard → Table Editor → feedback
