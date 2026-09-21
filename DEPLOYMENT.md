# Deploying Suno Zara Universe separately

The existing Suno Zara Studio deployment should remain connected to its current repository/project.

Deploy this folder as a new application:

- Project name: `suno-zara-universe`
- Framework: Next.js
- Root: repository root
- Build command: `npm run build`

Copy the required environment variables from the existing Studio only when the equivalent integration is intentionally being shared. For OAuth providers, create/update redirect URLs for the new Universe domain before enabling publishing in production.

Publishing callbacks in this code return users to `/music`.

Recommended production layout:

- Existing Studio: unchanged and live
- Suno Zara Universe: new Vercel project / new deployment URL

Do not replace the existing Studio Vercel project with Universe.
