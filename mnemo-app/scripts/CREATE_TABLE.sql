-- Training passages table for mnemo word-weighting fine-tuning pipeline
-- Run this manually in the Supabase SQL editor

CREATE TABLE training_passages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  passage_text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  doc_context TEXT,
  model_output JSONB,
  green_words TEXT[],
  sonnet_output JSONB,
  sonnet_green_words TEXT[],
  human_reviewed BOOLEAN DEFAULT false,
  human_corrections JSONB,
  approved BOOLEAN DEFAULT false,
  final_output JSONB
);

CREATE INDEX idx_tp_approved ON training_passages(approved);
CREATE INDEX idx_tp_created ON training_passages(created_at DESC);
