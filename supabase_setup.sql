-- ============================================
-- FotoStruksi - Supabase Setup SQL
-- Jalankan SQL ini di Supabase SQL Editor
-- (Dashboard > SQL Editor > New Query)
-- ============================================

-- 1. Buat Storage Bucket untuk foto
-- Bucket public agar foto bisa diakses langsung via URL
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos',
  'photos',
  true,
  5242880, -- 5MB max per file
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Policy: Siapapun bisa MELIHAT/DOWNLOAD foto (public read)
CREATE POLICY "Public read access on photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'photos');

-- 3. Policy: Upload foto via service_role key (dari Netlify function)
CREATE POLICY "Service role upload on photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'photos');

-- 4. Policy: Delete foto via service_role key
CREATE POLICY "Service role delete on photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'photos');

-- 5. Buat tabel photo_sessions untuk menyimpan mapping session -> foto
-- Ini memungkinkan QR code hanya berisi session ID pendek (8 karakter)
-- bukan daftar panjang semua file keys
CREATE TABLE IF NOT EXISTS public.photo_sessions (
  id TEXT PRIMARY KEY,                          -- Session ID pendek (8 karakter, e.g. "a3xK9mZq")
  photo_paths TEXT[] NOT NULL DEFAULT '{}',     -- Array path file di Supabase Storage
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() -- Waktu pembuatan session
);

-- 6. Enable RLS pada tabel photo_sessions
ALTER TABLE public.photo_sessions ENABLE ROW LEVEL SECURITY;

-- 7. Policy: Siapapun bisa membaca session (untuk redirect.html)
CREATE POLICY "Public read access on photo_sessions"
ON public.photo_sessions FOR SELECT
USING (true);

-- 8. Policy: Insert session (dari Netlify function via service_role key)
CREATE POLICY "Service role insert on photo_sessions"
ON public.photo_sessions FOR INSERT
WITH CHECK (true);

-- 9. Policy: Update session (untuk menambah foto ke session yang sudah ada)
CREATE POLICY "Service role update on photo_sessions"
ON public.photo_sessions FOR UPDATE
USING (true)
WITH CHECK (true);

-- 10. (Opsional) Auto-cleanup: hapus session lebih dari 90 hari
-- Uncomment jika mau auto-cleanup via Supabase Cron (pg_cron extension)
-- SELECT cron.schedule(
--   'cleanup-old-sessions',
--   '0 3 * * *',  -- Setiap hari jam 3 pagi
--   $$DELETE FROM public.photo_sessions WHERE created_at < NOW() - INTERVAL '90 days'$$
-- );

-- ============================================
-- SELESAI! Setelah menjalankan SQL ini:
-- 
-- 1. Buka Dashboard > Settings > API
--    - Catat "Project URL" (contoh: https://xxxxx.supabase.co)
--    - Catat "service_role key" (secret, jangan di-share publik)
--
-- 2. Set Environment Variables di Netlify:
--    - SUPABASE_URL = https://xxxxx.supabase.co
--    - SUPABASE_SERVICE_KEY = eyJhbGciOiJIUzI1NiIs... (service_role key)
--
-- 3. Setelah itu baru update kode upload.js
-- ============================================
