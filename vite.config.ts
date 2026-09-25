import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import type { IncomingMessage, ServerResponse } from 'http'

const commitHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

// Dev-only: serve the Vercel functions in api/ from the Vite dev server, so
// `npm run dev` can sign in locally (login, invites and password reset all
// go through /api/auth/*). Handlers are loaded with ssrLoadModule, so edits
// to them apply on the next request. Only the slice of the Vercel req/res
// API that our handlers use is emulated: parsed JSON body, req.query,
// res.status().json(). Server-side secrets come from .env / .env.local
// (see the comment there). Never used in production -- Vercel runs api/ itself.
function vercelApiDev(env: Record<string, string>): Plugin {
  return {
    name: 'vercel-api-dev',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      for (const [k, v] of Object.entries(env)) {
        if (process.env[k] === undefined) process.env[k] = v
      }

      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const file = path.resolve(__dirname, 'api', `.${url.pathname}.ts`)
        if (!file.startsWith(path.resolve(__dirname, 'api')) || !fs.existsSync(file)) return next()

        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const raw = Buffer.concat(chunks).toString('utf8')
        let body: unknown = raw
        if ((req.headers['content-type'] ?? '').includes('application/json')) {
          try { body = raw ? JSON.parse(raw) : {} } catch { body = raw }
        }

        const vreq = Object.assign(req, { body, query: Object.fromEntries(url.searchParams) })
        const vres = Object.assign(res, {
          status(code: number) { res.statusCode = code; return vres },
          json(data: unknown) {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
            return vres
          },
          send(data: unknown) { res.end(typeof data === 'string' ? data : JSON.stringify(data)); return vres },
        })

        try {
          const mod = await server.ssrLoadModule(file)
          await mod.default(vreq, vres)
        } catch (err) {
          console.error(`[api] ${url.pathname} failed:`, err)
          if (!res.headersSent) vres.status(500).json({ error: 'Local API error', detail: String(err) })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), vercelApiDev(loadEnv(mode, process.cwd(), ''))],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 8080 },
}))
