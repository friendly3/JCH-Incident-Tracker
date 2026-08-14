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

/**
 * Chart.js canvases are 2× device pixels. If the clone keeps that bitmap size as
 * CSS size, html2canvas only paints the left/top half — “dots on the left”.
 * Replace each canvas with a PNG <img> at the on-screen CSS size.
 */
export function replaceCanvasesWithImages(sourceRoot: HTMLElement, cloneRoot: HTMLElement) {
	const srcList = sourceRoot.querySelectorAll('canvas');
	const dstList = cloneRoot.querySelectorAll('canvas');
	srcList.forEach((src, i) => {
		const dst = dstList[i];
		if (!(dst instanceof HTMLCanvasElement)) return;
		if (src.width < 2 || src.height < 2) return;
		const cssW = Math.max(1, src.clientWidth || Math.round(src.width / 2));
		const cssH = Math.max(1, src.clientHeight || Math.round(src.height / 2));
		try {
			const img = dst.ownerDocument.createElement('img');
			img.src = src.toDataURL('image/png');
			img.alt = '';
			img.width = cssW;
			img.height = cssH;
			img.style.cssText = `display:block;width:${cssW}px;height:${cssH}px;max-width:none;`;
			dst.replaceWith(img);
		} catch {
			const ctx = dst.getContext('2d');
			dst.width = src.width;
			dst.height = src.height;
			dst.style.width = `${cssW}px`;
			dst.style.height = `${cssH}px`;
			ctx?.drawImage(src, 0, 0);
		}
	});
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
