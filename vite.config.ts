import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// Allow Cloudflare quick-tunnel hostnames (changes each run)
		allowedHosts: ['.trycloudflare.com']
	}
});
