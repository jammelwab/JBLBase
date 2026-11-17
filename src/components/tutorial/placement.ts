export type Box = { left: number; top: number; width: number; height: number };

const GAP = 12;
const MARGIN = 8;

// Where the tutorial's text goes: below the highlighted element if it fits, else above, to the
// right or to the left, always inside the window. Without an element, in the middle.
export function placeCard(
    target: Box | null,
    card: { width: number; height: number },
    viewport: { width: number; height: number },
): { left: number; top: number } {
    const clamp = (value: number, max: number) => Math.max(MARGIN, Math.min(value, max - MARGIN));
    if (!target) {
        return {
            left: Math.max(MARGIN, (viewport.width - card.width) / 2),
            top: Math.max(MARGIN, (viewport.height - card.height) / 2),
        };
    }
    const right = target.left + target.width;
    const bottom = target.top + target.height;
    const centeredLeft = clamp(
        target.left + target.width / 2 - card.width / 2,
        viewport.width - card.width,
    );
    const centeredTop = clamp(
        target.top + target.height / 2 - card.height / 2,
        viewport.height - card.height,
    );
    if (bottom + GAP + card.height + MARGIN <= viewport.height) {
        return { left: centeredLeft, top: bottom + GAP };
    }
    if (target.top - GAP - card.height >= MARGIN) {
        return { left: centeredLeft, top: target.top - GAP - card.height };
    }
    if (right + GAP + card.width + MARGIN <= viewport.width) {
        return { left: right + GAP, top: centeredTop };
    }
    if (target.left - GAP - card.width >= MARGIN) {
        return { left: target.left - GAP - card.width, top: centeredTop };
    }
    // A large element (e.g. the whole tree): over it, at its bottom right
    return {
        left: clamp(right - card.width - GAP, viewport.width - card.width),
        top: clamp(
            Math.min(bottom, viewport.height) - card.height - GAP,
            viewport.height - card.height,
        ),
    };
}

// The highlighted area: the element plus a small border, cut to the window
export function visibleBox(target: Box, viewport: { width: number; height: number }): Box {
    const pad = 6;
    const left = Math.max(0, target.left - pad);
    const top = Math.max(0, target.top - pad);
    const right = Math.min(viewport.width, target.left + target.width + pad);
    const bottom = Math.min(viewport.height, target.top + target.height + pad);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
