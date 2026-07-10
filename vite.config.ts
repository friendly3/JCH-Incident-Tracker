import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

function readPackageVersion(): string {
	try {
		const pkgPath = fileURLToPath(new URL('./package.json', import.meta.url));
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
		return pkg.version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

/** Prefer CI env (Cloudflare / GitHub), else local git, else "dev". */
function readCommitSha(): string {
	const fromEnv =
		process.env.CF_PAGES_COMMIT_SHA ||
		process.env.GITHUB_SHA ||
		process.env.COMMIT_REF ||
		process.env.VERCEL_GIT_COMMIT_SHA;
	if (fromEnv && fromEnv.trim()) return fromEnv.trim().slice(0, 7);
	try {
		return execSync('git rev-parse --short HEAD', {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
	} catch {
		return 'dev';
	}
}

const appVersion = readPackageVersion();
const appCommit = readCommitSha();
const appBuiltAt = new Date().toISOString();

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		// Build-time stamps so the nav version reflects this deploy
		__APP_VERSION__: JSON.stringify(appVersion),
		__APP_COMMIT__: JSON.stringify(appCommit),
		__APP_BUILT_AT__: JSON.stringify(appBuiltAt)
	},
	server: {
		// Bind IPv4 so cloudflared (127.0.0.1) can reach the dev server
		host: '127.0.0.1',
		// Allow Cloudflare quick-tunnel hostnames (changes each run)
		allowedHosts: ['.trycloudflare.com']
	}
});
