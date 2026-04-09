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

-- Reading velocity statistics (Day 2)
create table if not exists velocity_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date date not null,
  words_read int not null default 0,
  sessions_count int not null default 0,
  avg_wpm int,
  best_wpm int,
  total_time_ms int not null default 0,
  created_at timestamptz default now(),
  unique(user_id, date)
);

-- Reading history with detailed tracking (Day 2)
create table if not exists reading_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  word_count int not null,
  wpm int not null,
  time_ms int not null,
  cp_score int,
  retention_estimate int,
  text_preview text,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table reading_sessions enable row level security;
alter table bookmarks enable row level security;
alter table velocity_stats enable row level security;
alter table reading_history enable row level security;

-- RLS Policies: users can only access their own data
create policy "Users can manage own sessions"
  on reading_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own bookmarks"
  on bookmarks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own velocity stats"
  on velocity_stats for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own reading history"
  on reading_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Indexes for performance
create index if not exists idx_reading_sessions_user_id on reading_sessions(user_id);
create index if not exists idx_reading_sessions_created_at on reading_sessions(created_at);
create index if not exists idx_bookmarks_user_id on bookmarks(user_id);
create index if not exists idx_velocity_stats_user_id on velocity_stats(user_id);
create index if not exists idx_velocity_stats_date on velocity_stats(date);
create index if not exists idx_velocity_stats_user_date on velocity_stats(user_id, date);
create index if not exists idx_reading_history_user_id on reading_history(user_id);
create index if not exists idx_reading_history_created_at on reading_history(created_at);
create index if not exists idx_reading_history_user_created on reading_history(user_id, created_at);
