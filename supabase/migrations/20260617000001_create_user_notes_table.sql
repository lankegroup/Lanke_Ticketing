-- ============================================================
-- Create user_notes table for global user notes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  note_content TEXT NOT NULL,
  note_author 'user' | 'admin' NOT NULL DEFAULT 'user',
  is_handled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast query by user_id
CREATE INDEX IF NOT EXISTS idx_user_notes_user_id ON public.user_notes(user_id);

-- Index for fast query by is_handled
CREATE INDEX IF NOT EXISTS idx_user_notes_handled ON public.user_notes(is_handled);

-- RLS policies
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

-- Admin can see all notes
CREATE POLICY "Admin can view all user notes" ON public.user_notes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );

-- Admin can create notes for users
CREATE POLICY "Admin can create user notes" ON public.user_notes
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );

-- Admin can update notes
CREATE POLICY "Admin can update user notes" ON public.user_notes
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );

-- Admin can delete notes
CREATE POLICY "Admin can delete user notes" ON public.user_notes
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );

-- Users can view their own notes (but NOT the is_handled field - hidden)
CREATE POLICY "Users can view their own notes" ON public.user_notes
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
  );

-- Users can create their own notes
CREATE POLICY "Users can create their own notes" ON public.user_notes
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND note_author = 'user'
  );

-- Users can update their own notes
CREATE POLICY "Users can update their own notes" ON public.user_notes
  FOR UPDATE TO authenticated USING (
    user_id = auth.uid() AND note_author = 'user'
  );

-- Trigger to update updated_at on update
CREATE OR REPLACE FUNCTION public.set_user_note_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER user_notes_updated_at_trigger
BEFORE UPDATE ON public.user_notes
FOR EACH ROW EXECUTE FUNCTION public.set_user_note_updated_at();

NOTIFY pgrst, 'reload schema';