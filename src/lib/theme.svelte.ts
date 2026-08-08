const STORAGE_KEY = 'theme-preference';

export type Theme = 'light' | 'dark';

function getStoredTheme(): Theme | null {
	if (typeof window === 'undefined') return null;
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark') return stored;
	return null;
}

/**
 * Resolve active theme.
 * - Explicit localStorage choice wins
 * - Otherwise always light (do not follow OS prefers-color-scheme)
 */
function resolveTheme(): Theme {
	if (typeof window === 'undefined') return 'light';
	return getStoredTheme() ?? 'light';
}

function applyTheme(theme: Theme) {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('dark', theme === 'dark');
}

// Always start as 'light' so SSR and client hydration markup agree.
let _theme = $state<Theme>('light');
let _initialized = false;
let _cleanup: (() => void) | null = null;

export function isAuthPath(pathname: string): boolean {
	return pathname === '/auth' || pathname.startsWith('/auth/');
}

export const theme = {
	get current() {
		return _theme;
	},
	get isDark() {
		return _theme === 'dark';
	},
	/** Apply theme without persisting (e.g. auth pages always start in light mode). */
	applyTransient(value: Theme) {
		_theme = value;
		applyTheme(value);
	},
	/** Resolve and apply theme state without attaching listeners. Safe for ThemeToggle onMount. */
	sync() {
		if (typeof window === 'undefined') return;
		_theme = resolveTheme();
		applyTheme(_theme);
	},
	/**
	 * Apply resolved theme (layout owns this). System preference is not followed —
	 * light is the app default until the user toggles.
	 */
	init(): (() => void) | undefined {
		if (typeof window === 'undefined') return undefined;

		if (!_initialized) {
			_initialized = true;
			_theme = resolveTheme();
			applyTheme(_theme);

			_cleanup = () => {
				_initialized = false;
				_cleanup = null;
			};
		}

		return _cleanup ?? undefined;
	},
	set(value: Theme) {
		_theme = value;
		if (typeof window !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, value);
		}
		applyTheme(value);
	},
	toggle() {
		theme.set(_theme === 'dark' ? 'light' : 'dark');
	}
};
