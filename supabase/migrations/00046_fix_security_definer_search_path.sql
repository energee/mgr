-- Migration: Fix SECURITY DEFINER function search_path
-- Recreates user_has_brewery_access with proper SET search_path to prevent
-- search_path manipulation attacks in SECURITY DEFINER functions.

-- Drop and recreate the function with proper security settings
CREATE OR REPLACE FUNCTION user_has_brewery_access(brewery_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_breweries
    WHERE user_id = auth.uid()
    AND user_breweries.brewery_id = $1
  );
END;
$$;

-- Add comment documenting the security fix
COMMENT ON FUNCTION user_has_brewery_access(UUID) IS
  'Checks if the current user has access to a brewery. Uses SECURITY DEFINER with SET search_path = public for security.';
