/**
 * Where the last tap landed: the button (or link) the finger or pointer went down on. A dialog
 * opened right after grows out of it, the way a folder opens on an iPhone (`Modal`,
 * `FolderSheet`). Remembered for a moment only, so a dialog opened by a timer or a deep link just
 * fades in.
 */
let last: { rect: DOMRect; at: number } | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest('button, a, [role="button"], [role="tab"], label') ?? target;
      if (control) last = { rect: control.getBoundingClientRect(), at: Date.now() };
    },
    { capture: true, passive: true },
  );
}

/** The rect of what was just tapped, if it was within the last second and a half. */
export function recentTapOrigin(): DOMRect | null {
  return last && Date.now() - last.at < 1500 ? last.rect : null;
}
