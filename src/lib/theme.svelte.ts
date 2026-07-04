const STORAGE_KEY = 'theme-preference';

export type Theme = 'light' | 'dark';

function getSystemTheme(): Theme {
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme | null {
	if (typeof window === 'undefined') return null;
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark') return stored;
	return null;
}

function resolveTheme(): Theme {
	if (typeof window === 'undefined') return 'light';
	const stored = getStoredTheme();
	if (stored) return stored;
	if (document.documentElement.classList.contains('dark')) return 'dark';
	return getSystemTheme();
}

function applyTheme(theme: Theme) {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('dark', theme === 'dark');
}

// Always start as 'light' so SSR and client hydration markup agree.
let _theme = $state<Theme>('light');
let _initialized = false;
let _mediaQuery: MediaQueryList | null = null;
let _cleanup: (() => void) | null = null;

function handleSystemChange(event: MediaQueryListEvent) {
	if (!getStoredTheme()) {
		_theme = event.matches ? 'dark' : 'light';
		applyTheme(_theme);
	}
}

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
	/** Attach system-theme listener. Layout is the sole owner of this lifecycle. */
	init(): (() => void) | undefined {
		if (typeof window === 'undefined') return undefined;

		if (!_initialized) {
			_initialized = true;
			_theme = resolveTheme();
			applyTheme(_theme);

			_mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			_mediaQuery.addEventListener('change', handleSystemChange);

			_cleanup = () => {
				_mediaQuery?.removeEventListener('change', handleSystemChange);
				_mediaQuery = null;
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
