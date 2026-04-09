-- Run this in Supabase Dashboard > SQL Editor

-- Reading sessions (history/stats)
create table if not exists reading_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  words int not null,
  wpm int not null,
  time_ms int not null,
  cp_score int,
  created_at timestamptz default now()
);

-- Bookmarks (saved in-progress sessions)
create table if not exists bookmarks (
  id text primary key,
  user_id uuid references auth.users not null,
  title text not null,
  text text not null,
  word_data jsonb,
  position int not null default 0,
  word_count int not null,
  wpm int not null,
  schema_data jsonb,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table reading_sessions enable row level security;
alter table bookmarks enable row level security;

-- RLS Policies: users can only access their own data
create policy "Users can manage own sessions"
  on reading_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own bookmarks"
  on bookmarks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
