/**
 * Dashboard is chart/map-heavy (Chart.js, Leaflet). SSR of that graph has been
 * crashing the Cloudflare Worker with a bare 500 while the incidents list works.
 * Server load still runs; the page HTML is assembled in the browser.
 */
export const ssr = false;
