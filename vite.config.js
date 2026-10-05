import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const VERSION_FILE = new URL('./version.json', import.meta.url)

// Identifies this particular build. Vercel and Railway both expose the commit
// they built from; falling back to the local commit keeps dev builds sensible,
// and to a timestamp if git isn't available at all.
function buildId() {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA
  if (fromCi) return fromCi.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return String(Date.now())
  }
}

// The version people read is bumped by hand in version.json; `build` is
// stamped automatically. "Check for Updates" compares `build`, so a deploy is
// always detected even when the version itself wasn't bumped — the check can
// never claim "up to date" against a build that actually changed.
function readVersion() {
  return { ...JSON.parse(readFileSync(VERSION_FILE, 'utf8')), build: buildId() }
}

function appVersion() {
  return {
    name: 'app-version',
    // Vite doesn't serve repo-root files in dev, so hand it over directly.
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(readVersion()))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(readVersion()) })
    },
  }
}

// Relative base so the same build works from a GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) as well as from a domain root.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    appVersion(),
  ],
})
