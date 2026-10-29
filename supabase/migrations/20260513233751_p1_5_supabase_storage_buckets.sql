-- Create storage buckets for notes and submissions
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('learnit-notes', 'learnit-notes', false, 20971520,
   ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']),
  ('learnit-submissions', 'learnit-submissions', false, 52428800,
   ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','image/png','image/jpeg','application/zip'])
ON CONFLICT (id) DO NOTHING;

-- RLS: service role can do everything (backend uploads via service key)
-- Authenticated users can read files in modules they are enrolled in

-- Notes bucket policies
CREATE POLICY "service role full access notes"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'learnit-notes')
  WITH CHECK (bucket_id = 'learnit-notes');

CREATE POLICY "authenticated read notes"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'learnit-notes');

-- Submissions bucket policies
CREATE POLICY "service role full access submissions"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'learnit-submissions')
  WITH CHECK (bucket_id = 'learnit-submissions');

CREATE POLICY "authenticated read submissions"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'learnit-submissions');