-- Production app role. Run ONCE against a fresh production database as the
-- owner/superuser role, BEFORE `pnpm db:migrate`.
--
-- Why: the application connects as `grossline_app`, which has NO BYPASSRLS, so
-- row-level security is enforced for it (the second net behind the tenant-scoped
-- query helpers). Migration 0001 creates this role too, but only with the
-- throwaway local password — in production the role must exist first with a real
-- secret, and the migration's `IF NOT EXISTS` guard then leaves it untouched
-- while still applying the GRANTs and RLS policies to it.
--
-- Usage (psql), supplying a strong password as a variable:
--   psql "$DATABASE_URL" -v app_password="'<a-strong-secret>'" -f prod-app-role.sql
--
-- Then set APP_DATABASE_URL to the grossline_app connection string (same host
-- and database, user grossline_app, that same password) and run the migrations.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grossline_app') THEN
    EXECUTE format(
      'CREATE ROLE grossline_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
      :app_password
    );
  END IF;
END
$$;
