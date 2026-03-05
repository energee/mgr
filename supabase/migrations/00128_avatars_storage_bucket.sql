-- Migration: 00101_avatars_storage_bucket.sql
-- Purpose: Create avatars storage bucket for user profile images
-- Includes RLS policies for per-user folder access

-- =============================================================================
-- 1. Create avatars storage bucket
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. RLS policies for avatar storage
-- =============================================================================

-- Users can upload their own avatar (folder per user: avatars/{user_id}/...)
CREATE POLICY avatars_upload ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Anyone can read avatars (public bucket)
CREATE POLICY avatars_read ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Users can update their own avatar
CREATE POLICY avatars_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can delete their own avatar
CREATE POLICY avatars_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
