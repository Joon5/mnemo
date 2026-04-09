# mnemo-app — Day 1 Setup

## Step 1: Install dependencies
```bash
cd mnemo-app
npm install
```

## Step 2: Add your Anthropic API key
Edit `.env.local` and replace `YOUR_ANTHROPIC_API_KEY_HERE` with your key from console.anthropic.com:
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```
The Supabase credentials are already filled in.

## Step 3: Set up Supabase database
1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/zilqvaczinzwyddrnypa
2. Click **SQL Editor** in the left sidebar
3. Paste the contents of `supabase-schema.sql` and click **Run**

## Step 4: Run locally
```bash
npm run dev
```
Open http://localhost:3000

## Step 5: Push to GitHub
```bash
git init
git add .
git commit -m "Initial mnemo-app"
git remote add origin https://github.com/YOUR_USERNAME/mnemo-app.git
git push -u origin main
```

## Step 6: Deploy to Vercel
1. Go to vercel.com → New Project → Import your `mnemo-app` repo
2. Add environment variables in Vercel dashboard:
   - `ANTHROPIC_API_KEY` = your key
   - `NEXT_PUBLIC_SUPABASE_URL` = https://zilqvaczinzwyddrnypa.supabase.co
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon key
3. Deploy!

## Optional: PDF support
To enable PDF upload, run:
```bash
npm install pdfjs-dist
```

## Optional: EPUB support
To enable EPUB upload, run:
```bash
npm install jszip
```
