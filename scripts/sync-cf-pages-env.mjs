#!/usr/bin/env node
/**
 * Push VITE_SUPABASE_* from local .env.local into Cloudflare Pages
 * (Production + Preview, plain_text so they apply to Build and Runtime).
 *
 * Usage:
 *   npx wrangler login
 *   # optional: export CLOUDFLARE_ACCOUNT_ID=...
 *   node scripts/sync-cf-pages-env.mjs
 *
 * Requires: wrangler logged in, or CLOUDFLARE_API_TOKEN env.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const PROJECT = process.env.CF_PAGES_PROJECT || 'jch-incident-tracker-v1'

function loadEnvFile(path) {
	if (!existsSync(path)) return {}
	const out = {}
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const t = line.trim()
		if (!t || t.startsWith('#') || !t.includes('=')) continue
		const i = t.indexOf('=')
		const k = t.slice(0, i).trim()
		let v = t.slice(i + 1).trim()
		if (
			(v.startsWith('"') && v.endsWith('"')) ||
			(v.startsWith("'") && v.endsWith("'"))
		) {
			v = v.slice(1, -1)
		}
		out[k] = v
	}
	return out
}

const env = {
	...loadEnvFile(resolve(root, '.env')),
	...loadEnvFile(resolve(root, '.env.local'))
}

const url = env.VITE_SUPABASE_URL?.trim()
const anon = env.VITE_SUPABASE_ANON_KEY?.trim()
if (!url || !anon) {
	console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env / .env.local')
	process.exit(1)
}

function getAccountId() {
	if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID
	try {
		const raw = execSync('npx wrangler whoami --json', {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		})
		const j = JSON.parse(raw)
		const accounts = j?.accounts || j?.result?.accounts || []
		if (accounts[0]?.id) return accounts[0].id
	} catch {
		/* fall through */
	}
	// Parse text whoami
	try {
		const text = execSync('npx wrangler whoami', { encoding: 'utf8' })
		const m = text.match(/Account ID\s*[|│]\s*([a-f0-9]{32})/i) || text.match(/\b([a-f0-9]{32})\b/)
		if (m) return m[1]
	} catch {
		/* fall through */
	}
	return null
}

const accountId = getAccountId()
if (!accountId) {
	console.error(
		'Could not determine Cloudflare account id. Run: npx wrangler login\n' +
			'Or set CLOUDFLARE_ACCOUNT_ID=...'
	)
	process.exit(1)
}

const token = process.env.CLOUDFLARE_API_TOKEN
async function cf(method, path, body) {
	const headers = { 'Content-Type': 'application/json' }
	if (token) {
		headers.Authorization = `Bearer ${token}`
	} else {
		// Use wrangler oauth token from config if present
		try {
			const cfgPath = resolve(
				process.env.HOME || '',
				'.wrangler/config/default.toml'
			)
			// Prefer wrangler API via curl with oauth from `wrangler pages project list`
			// Fallback: use fetch with token from wrangler
		} catch {
			/* ignore */
		}
	}

	// Prefer Wrangler’s authenticated fetch by shelling out to curl via wrangler if no token
	if (!token) {
		// Write body to temp and use wrangler pages deployment… not ideal.
		// Use Cloudflare API with token extracted via wrangler:
		let oauth = ''
		try {
			const conf = readFileSync(
				resolve(process.env.HOME || '', '.config/.wrangler/config/default.toml'),
				'utf8'
			)
			const m = conf.match(/oauth_token\s*=\s*"([^"]+)"/)
			if (m) oauth = m[1]
		} catch {
			try {
				const conf = readFileSync(
					resolve(process.env.HOME || '', '.wrangler/config/default.toml'),
					'utf8'
				)
				const m = conf.match(/oauth_token\s*=\s*"([^"]+)"/)
				if (m) oauth = m[1]
			} catch {
				/* ignore */
			}
		}
		if (!oauth) {
			console.error(
				'Not authenticated. Run:\n  npx wrangler login\n' +
					'Or set CLOUDFLARE_API_TOKEN with Pages:Edit permission.'
			)
			process.exit(1)
		}
		headers.Authorization = `Bearer ${oauth}`
	}

	const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined
	})
	const json = await res.json()
	if (!json.success) {
		console.error(JSON.stringify(json.errors || json, null, 2))
		process.exit(1)
	}
	return json.result
}

const envVars = {
	VITE_SUPABASE_URL: { type: 'plain_text', value: url },
	VITE_SUPABASE_ANON_KEY: { type: 'plain_text', value: anon }
}

console.log(`Account: ${accountId}`)
console.log(`Project: ${PROJECT}`)
console.log('Setting VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY on Production and Preview…')

// Fetch current project so we merge rather than wipe other settings
const project = await cf(
	'GET',
	`/accounts/${accountId}/pages/projects/${PROJECT}`
)

const production = {
	...(project.deployment_configs?.production || {}),
	env_vars: {
		...(project.deployment_configs?.production?.env_vars || {}),
		...envVars
	}
}
const preview = {
	...(project.deployment_configs?.preview || {}),
	env_vars: {
		...(project.deployment_configs?.preview?.env_vars || {}),
		...envVars
	}
}

await cf('PATCH', `/accounts/${accountId}/pages/projects/${PROJECT}`, {
	deployment_configs: {
		production,
		preview
	}
})

console.log('✓ Environment variables updated (Production + Preview).')
console.log('Triggering a new deployment so the build can inline VITE_* …')

// Empty commit is invasive; ask CF to retry latest production deployment if possible
try {
	const deploys = await cf(
		'GET',
		`/accounts/${accountId}/pages/projects/${PROJECT}/deployments?per_page=1`
	)
	const latest = Array.isArray(deploys) ? deploys[0] : deploys?.[0]
	if (latest?.id) {
		await cf(
			'POST',
			`/accounts/${accountId}/pages/projects/${PROJECT}/deployments/${latest.id}/retry`
		)
		console.log(`✓ Retried deployment ${latest.id}`)
	} else {
		console.log('No deployment to retry — push an empty commit or Redeploy in the dashboard.')
	}
} catch (e) {
	console.log(
		'Could not auto-retry deployment. In the dashboard: Deployments → ⋯ → Retry deployment'
	)
	console.log(String(e?.message || e))
}

console.log('Done.')
