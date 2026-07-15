-- Restore the customer portal's many-to-many auth-user junction.
--
-- customer_portal_users was originally introduced by 00095, then dropped
-- out-of-band from the hosted database. Later migrations guarded their policy
-- changes when the table was absent, leaving the portal invite route unable to
-- persist access. This migration is replay-safe: clean databases already have
-- the table, while the hosted database recreates it.

CREATE TABLE IF NOT EXISTS public.customer_portal_users (
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_portal_users_user
  ON public.customer_portal_users(user_id);

ALTER TABLE public.customer_portal_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_users_staff_select ON public.customer_portal_users;
DROP POLICY IF EXISTS portal_users_staff_all ON public.customer_portal_users;
DROP POLICY IF EXISTS portal_users_customer_select ON public.customer_portal_users;
DROP POLICY IF EXISTS customer_portal_users_staff_select ON public.customer_portal_users;
DROP POLICY IF EXISTS customer_portal_users_staff_write ON public.customer_portal_users;
DROP POLICY IF EXISTS customer_portal_users_customer_select ON public.customer_portal_users;
DROP POLICY IF EXISTS "Staff can view all customer portal users" ON public.customer_portal_users;
DROP POLICY IF EXISTS "Staff can manage customer portal users" ON public.customer_portal_users;

CREATE POLICY customer_portal_users_staff_select
  ON public.customer_portal_users
  FOR SELECT TO authenticated
  USING (user_has_permission('customers:read'));

CREATE POLICY customer_portal_users_staff_write
  ON public.customer_portal_users
  FOR ALL TO authenticated
  USING (user_has_permission('customers:write'))
  WITH CHECK (user_has_permission('customers:write'));

CREATE POLICY customer_portal_users_customer_select
  ON public.customer_portal_users
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.customer_portal_users
  TO authenticated;

-- Recover links for portal profiles that still match an active customer's
-- primary email. Additional contacts are linked explicitly by the invite API.
INSERT INTO public.customer_portal_users (customer_id, user_id)
SELECT c.id, up.id
FROM public.customers c
JOIN public.user_profiles up
  ON lower(up.email) = lower(c.email)
WHERE c.email IS NOT NULL
  AND COALESCE(c.is_active, true)
  AND 'customer' = ANY(up.roles)
ON CONFLICT (customer_id, user_id) DO NOTHING;

COMMENT ON TABLE public.customer_portal_users IS
  'Many-to-many portal access links. A customer may have multiple login users, and one login may access multiple customers.';

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
  'customer_portal_users',
  'Many-to-many junction linking customers to portal auth users. Access to customer-scoped orders and change requests is derived from these links.',
  'sales',
  '["belongs_to: customers", "belongs_to: auth.users"]'::jsonb,
  '["customer_id", "user_id"]'::jsonb,
  NULL,
  '["Which portal users can access customer X?", "Which customers can portal user Y access?"]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples;
