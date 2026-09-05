-- Health must never be more optimistic than the evidence: any connection that
-- has never succeeded and never errored was showing the old 'healthy' default
-- without ever having synced. Reset those to 'unknown'.
UPDATE "connections"
SET "health" = 'unknown'
WHERE "health" = 'healthy'
  AND "last_success_at" IS NULL
  AND "last_error" IS NULL;
