ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_letter_reason text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE INDEX IF NOT EXISTS idx_outbox_claim_dispatch
  ON public.notification_outbox (status, lease_expires_at, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_outbox_idempotency
  ON public.notification_outbox (tenant_id, idempotency_key);

CREATE OR REPLACE FUNCTION public.claim_outbox_batch(
  p_worker_id text,
  p_batch_size integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 30,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.notification_outbox
  SET status = 'processing',
      locked_by = p_worker_id,
      locked_at = NOW(),
      lease_expires_at = NOW() + (p_lease_seconds || ' seconds')::interval,
      attempts = attempts + 1
  WHERE id IN (
    SELECT id
    FROM public.notification_outbox
    WHERE (
      (status = 'pending' OR (status = 'failed' AND (next_retry_at IS NULL OR next_retry_at <= NOW())))
      OR (status = 'processing' AND lease_expires_at < NOW())
    )
    AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
