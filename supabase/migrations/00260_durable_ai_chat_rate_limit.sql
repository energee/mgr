-- Staff authorization and a cross-instance rate limit for brewery-funded chat (#448).
--
-- The API previously admitted every active account, including portal customers,
-- before reading the service-role Anthropic key. Its process-local IP limiter
-- also multiplied the allowance across serverless instances. The ai:use
-- capability now identifies staff callers, while this service-role-only bucket
-- makes request consumption atomic and durable across instances.

CREATE OR REPLACE FUNCTION public.get_roles_for_permission(p_permission TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE p_permission
    WHEN 'recipes:read'        THEN ARRAY['admin','production_manager','brewer','sales','viewer']
    WHEN 'recipes:write'       THEN ARRAY['admin','brewer']
    WHEN 'batches:read'        THEN ARRAY['admin','production_manager','brewer','sales','viewer']
    WHEN 'batches:write'       THEN ARRAY['admin','production_manager','brewer']
    WHEN 'orders:read'         THEN ARRAY['admin','production_manager','sales','viewer']
    WHEN 'orders:write'        THEN ARRAY['admin','sales']
    WHEN 'customers:read'      THEN ARRAY['admin','production_manager','sales','viewer']
    WHEN 'customers:write'     THEN ARRAY['admin','sales']
    WHEN 'inventory:read'      THEN ARRAY['admin','production_manager','brewer','sales','viewer']
    WHEN 'inventory:write'     THEN ARRAY['admin','production_manager']
    WHEN 'purchasing:read'     THEN ARRAY['admin','production_manager','viewer']
    WHEN 'purchasing:write'    THEN ARRAY['admin','production_manager']
    WHEN 'vessels:read'        THEN ARRAY['admin','production_manager','brewer','sales','viewer']
    WHEN 'vessels:write'       THEN ARRAY['admin','production_manager','brewer']
    WHEN 'ai:use'              THEN ARRAY['admin','production_manager','brewer','sales','viewer']
    WHEN 'integrations:manage' THEN ARRAY['admin']
    WHEN 'settings:manage'     THEN ARRAY['admin']
    WHEN 'users:manage'        THEN ARRAY['admin']
    ELSE ARRAY[]::TEXT[]
  END;
$$;

CREATE TABLE public.ai_rate_limit_buckets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.ai_rate_limit_buckets IS
  'Durable per-user request buckets for paid AI chat. Direct API roles have no access; service_role consumes buckets through consume_ai_rate_limit.';

ALTER TABLE public.ai_rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- Internal table: authenticated has neither table privileges nor a permissive
-- policy. This restrictive policy preserves the global enabled-account
-- invariant if direct access is ever introduced accidentally.
CREATE POLICY current_user_enabled
  ON public.ai_rate_limit_buckets
  AS RESTRICTIVE
  TO authenticated
  USING (public.current_user_is_enabled())
  WITH CHECK (public.current_user_is_enabled());

REVOKE ALL ON TABLE public.ai_rate_limit_buckets
  FROM PUBLIC, anon, authenticated, service_role;

-- security-definer: justified the service-role-only RPC is the sole bucket boundary and must bypass table RLS consistently in Supabase and plain-Postgres CI; validated scalar inputs and a fixed table prevent caller-selected SQL or data access
CREATE OR REPLACE FUNCTION public.consume_ai_rate_limit(
  p_user_id UUID,
  p_window_seconds INTEGER DEFAULT 60,
  p_max_requests INTEGER DEFAULT 10
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_started_at TIMESTAMPTZ;
  v_request_count INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'p_user_id is required';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'p_window_seconds must be positive';
  END IF;
  IF p_max_requests IS NULL OR p_max_requests <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'p_max_requests must be positive';
  END IF;

  INSERT INTO public.ai_rate_limit_buckets AS bucket (
    user_id,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (p_user_id, v_now, 1, v_now)
  ON CONFLICT (user_id) DO UPDATE
  SET
    window_started_at = CASE
      WHEN bucket.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        THEN v_now
      ELSE bucket.window_started_at
    END,
    request_count = CASE
      WHEN bucket.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        THEN 1
      ELSE LEAST(bucket.request_count + 1, p_max_requests + 1)
    END,
    updated_at = v_now
  RETURNING bucket.window_started_at, bucket.request_count
    INTO v_window_started_at, v_request_count;

  RETURN QUERY SELECT
    v_request_count <= p_max_requests,
    GREATEST(p_max_requests - v_request_count, 0),
    v_window_started_at + make_interval(secs => p_window_seconds);
END;
$function$;

COMMENT ON FUNCTION public.consume_ai_rate_limit(UUID, INTEGER, INTEGER) IS
  'Atomically consumes one durable per-user AI request. SECURITY DEFINER bypasses the direct-access-denied bucket table; executable only by service_role.';

REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_rate_limit(UUID, INTEGER, INTEGER)
  TO service_role;

INSERT INTO public._schema_registry (
  table_name,
  description,
  domain,
  relationships,
  key_fields,
  state_machine,
  query_examples
)
VALUES (
  'ai_rate_limit_buckets',
  'Service-role-only durable per-user buckets that cap paid AI chat requests across application instances.',
  'system',
  '["belongs_to: auth.users"]'::jsonb,
  '["user_id", "window_started_at", "request_count"]'::jsonb,
  NULL,
  '["Has user X exhausted the current AI chat window?", "When does user X chat allowance reset?"]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples;
