# Production image for the merchant portal (apps/portal).
#
# Build from the REPO ROOT (the portal needs its workspace packages):
#   docker build -f apps/portal/Dockerfile -t grossline-portal .
#
# Runtime env required: DATABASE_URL (owner role), APP_DATABASE_URL
# (grossline_app role — RLS enforced), SESSION_SECRET. Render/most hosts inject
# PORT; the portal binds it. Chromium (for the report-PDF route) ships in the
# image at PLAYWRIGHT_BROWSERS_PATH.
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Whole monorepo (the .dockerignore trims node_modules/.next/etc.).
COPY . .

# Install deps without pulling browsers here; the explicit step below fetches
# Chromium plus its OS libraries in one go.
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile
RUN pnpm --filter @grossline/portal exec playwright install --with-deps chromium

RUN pnpm --filter @grossline/portal build

ENV NODE_ENV=production
EXPOSE 3002
# Bind the host-provided PORT (Render sets it; default 3002 locally).
CMD ["sh", "-c", "pnpm --filter @grossline/portal exec next start -p ${PORT:-3002} -H 0.0.0.0"]
