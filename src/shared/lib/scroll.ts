/**
 * Scrolls one element into view by scrolling ONLY its nearest scrollable
 * ancestor — never any outer one.
 *
 * Why not Element.scrollIntoView: it scrolls EVERY scrollable ancestor,
 * including `overflow: hidden` boxes that are programmatically
 * scrollable but have no scrollbar. The app shell's sidebar wrapper is
 * such a box (its content slightly exceeds its height), so a
 * scrollIntoView deep inside a page shoved the whole shell — app bar
 * included — out of view with no way to scroll back (verified via
 * tauri-mcp on /search with a ?p= deep link). Manual math against the
 * owning scroller keeps every other ancestor's scrollTop untouched.
 *
 * Sticky-stack aware: the combined height of every `top`-anchored
 * sticky element pinned inside the scroller above the target (e.g. the
 * /search Step 1 area and the Step 2 title row) is subtracted so the
 * target lands below the stack, not behind it.
 *
 * @param el Element to reveal.
 * @param topOffset Extra breathing room in px between the scroller top
 *   (below any sticky header) and the target's top edge.
 * @param behavior Scroll behavior, defaults to smooth.
 */
export function scrollElementWithinScroller(
  el: HTMLElement,
  topOffset = 0,
  behavior: ScrollBehavior = 'smooth',
): void {
  const scroller = el.closest<HTMLElement>('.overflow-y-auto')
  if (!scroller) return
  // Only sticky elements anchored from the TOP can cover the target;
  // bottom-anchored ones (the parts-list footer) carry Tailwind's
  // bottom-0 class and are excluded by class because happy-dom reports
  // non-auto computed `top` for every element, defeating a computed-
  // style check. Heights are measured live so multi-level stacks
  // subtract their real total at any scroll state.
  const stickyCover = Array.from(
    scroller.querySelectorAll<HTMLElement>('div.sticky'),
  )
    .filter(
      (s) => s !== el && !s.contains(el) && !s.classList.contains('bottom-0'),
    )
    .reduce((sum, s) => sum + s.offsetHeight, 0)
  const top =
    el.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop -
    stickyCover -
    topOffset
  scroller.scrollTo({ top, behavior })
}
