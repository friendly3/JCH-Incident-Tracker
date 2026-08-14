/**
 * Tailwind v4 emits oklch() / lab() / color(). html2canvas 1.4 cannot parse those
 * and throws "Attempting to parse an unsupported color function".
 * Convert them to rgb() using the browser's own color engine.
 */

const MODERN_COLOR =
	/(?:oklch|oklab|lab|lch|color|hwb)\([^)]*\)/gi;

function browserResolveColor(cssColor: string): string {
	if (typeof document === 'undefined') return cssColor;
	const probe = document.createElement('span');
	probe.style.color = cssColor;
	probe.style.position = 'absolute';
	probe.style.left = '-9999px';
	document.body.appendChild(probe);
	const resolved = getComputedStyle(probe).color;
	probe.remove();
	return resolved && resolved !== 'rgba(0, 0, 0, 0)' ? resolved : cssColor;
}

function replaceModernColors(value: string): string {
	if (!MODERN_COLOR.test(value)) return value;
	MODERN_COLOR.lastIndex = 0;
	return value.replace(MODERN_COLOR, (match) => {
		try {
			return browserResolveColor(match);
		} catch {
			return '#000000';
		}
	});
}

function rewriteStyleDeclaration(style: CSSStyleDeclaration) {
	for (let i = style.length - 1; i >= 0; i--) {
		const prop = style.item(i);
		const val = style.getPropertyValue(prop);
		if (!val || !MODERN_COLOR.test(val)) continue;
		MODERN_COLOR.lastIndex = 0;
		style.setProperty(prop, replaceModernColors(val), style.getPropertyPriority(prop));
	}
}

function rewriteStyleSheet(sheet: CSSStyleSheet) {
	let rules: CSSRuleList;
	try {
		rules = sheet.cssRules;
	} catch {
		return;
	}
	for (const rule of Array.from(rules)) {
		if (rule instanceof CSSStyleRule) {
			rewriteStyleDeclaration(rule.style);
		} else if (rule instanceof CSSGroupingRule) {
			for (const inner of Array.from(rule.cssRules)) {
				if (inner instanceof CSSStyleRule) rewriteStyleDeclaration(inner.style);
			}
		}
	}
}

/** Run inside html2canvas `onclone` so the cloned document has only rgb/hex colors. */
export function sanitizeCloneColors(clonedDoc: Document) {
	clonedDoc.querySelectorAll('style').forEach((el) => {
		if (!el.textContent || !MODERN_COLOR.test(el.textContent)) return;
		MODERN_COLOR.lastIndex = 0;
		el.textContent = replaceModernColors(el.textContent);
	});

	for (const sheet of Array.from(clonedDoc.styleSheets)) {
		rewriteStyleSheet(sheet);
	}

	clonedDoc.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
		rewriteStyleDeclaration(el.style);
	});
}
