import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type TrainingPassage = {
  id: string;
  created_at: string;
  passage_text: string;
  word_count: number;
  doc_context: string | null;
  model_output: { thesis: string; load_bearing: string[]; green: number[] } | null;
  green_words: string[];
  sonnet_output: { thesis: string; load_bearing: string[]; green: number[] } | null;
  sonnet_green_words: string[];
  human_reviewed: boolean;
  human_corrections: { green: number[]; notes: string; was_corrected: boolean } | null;
  approved: boolean;
  final_output: { thesis: string; load_bearing: string[]; green: number[] } | null;
};

export type Database = {
  public: {
    Tables: {
      training_passages: {
        Row: TrainingPassage;
        Insert: Omit<TrainingPassage, 'id' | 'created_at'>;
      };
      reading_sessions: {
        Row: {
          id: string;
          user_id: string;
          words: number;
          wpm: number;
          time_ms: number;
          cp_score: number | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['reading_sessions']['Row'], 'id' | 'created_at'>;
      };
      bookmarks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          text: string;
          word_data: WordData[] | null;
          position: number;
          word_count: number;
          wpm: number;
          schema_data: Schema | null;
          created_at: string;
        };
        Insert: Database['public']['Tables']['bookmarks']['Row'];
      };
    };
  };
};

export type WordData = {
  text: string;
  color: 'green' | 'orange' | 'mnemo' | null;
  pause: boolean;
  delay: number;
};

export type Schema = {
  summary: string;
  keywords: string[];
};

export type Bookmark = {
  id: string;
  title: string;
  text: string;
  wordData: WordData[];
  pos: number;
  wc: number;
  wpm: number;
  at: number;
  schema: Schema | null;
};

export type Session = {
  words: number;
  wpm: number;
  time: number;
  cpScore: number | null;
  date: number;
};

export type Chapter = {
  title: string;
  startIdx: number;
  endIdx: number;
};

export type Checkpoint = {
  q: string;
  options: string[];
  correct: number;
};

export type Flashcard = {
  q: string;
  a: string;
};
