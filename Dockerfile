# The tutor proxy and the Explode Anything builder (services/tutor-proxy), for a host such as
# Render (docs/ANYTHING_PLAN.md §4). The app itself is static and is served from GitHub Pages;
# nothing here builds it.
#
# Not yet built or run anywhere: check it before relying on it.
FROM node:24-slim

WORKDIR /app
RUN npm install --global bun@1.4.4

# Workspace packages are consumed as TypeScript source (Node's type stripping), so the whole
# repository is needed, not a build of it. The committed bun.lock fixes every version.
COPY . .
RUN bun install --frozen-lockfile

ENV NODE_ENV=production
# The host sets PORT. Keys and settings come from its secret store, never from the image:
# ANTHROPIC_API_KEY or META_API_KEY, ALLOWED_ORIGINS, TRUST_PROXY=1 behind the host's proxy.
EXPOSE 8787
USER node
CMD ["node", "services/tutor-proxy/src/server.ts"]
