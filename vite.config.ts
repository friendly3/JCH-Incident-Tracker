import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// Bind IPv4 so cloudflared (127.0.0.1) can reach the dev server
		host: '127.0.0.1',
		// Allow Cloudflare quick-tunnel hostnames (changes each run)
		allowedHosts: ['.trycloudflare.com']
	}
});