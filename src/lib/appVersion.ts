/**
 * App version shown in the nav (and available for support).
 *
 * ## How versioning works
 *
 * 1. **Release version** — `package.json` `"version"` (semver: MAJOR.MINOR.PATCH)
 *    - **PATCH** (x.y.Z): bugfixes, polish, small UX tweaks
 *    - **MINOR** (x.Y.0): new features (filters, pickers, dashboard work, etc.)
 *    - **MAJOR** (X.0.0): breaking changes / major redesigns
 *    Bump this when shipping meaningful product changes (manually or via release process).
 *
 * 2. **Build identity** — short git commit SHA injected at **build time**
 *    - Cloudflare Pages: `CF_PAGES_COMMIT_SHA`
 *    - GitHub Actions: `GITHUB_SHA`
 *    - Local: `git rev-parse --short HEAD`
 *    Every deploy is uniquely identifiable even if package.json is unchanged.
 *
 * Display form: `v{semver}` + `build {sha7}` under Logout in the left nav.
 */

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

export const APP_VERSION: string =
	typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

export const APP_COMMIT: string =
	typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'dev';

/** ISO timestamp when this client bundle was built (UTC). */
export const APP_BUILT_AT: string =
	typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : '';

/** Human label, e.g. `v0.2.0`. */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

/** Full support string, e.g. `v0.2.0 (a1b2c3d)`. */
export const APP_VERSION_FULL = `${APP_VERSION_LABEL} (${APP_COMMIT})`;
