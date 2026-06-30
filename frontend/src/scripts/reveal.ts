/**
 * Scroll-reveal: adds `.is-visible` to `.fade-up` elements as they enter the viewport.
 * No-op (everything shown immediately) when the user prefers reduced motion.
 */
function initReveal(): void {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = Array.from(document.querySelectorAll<HTMLElement>('.fade-up'));

  if (prefersReduced || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
  );

  els.forEach((el) => observer.observe(el));
}

if (document.readyState !== 'loading') {
  initReveal();
} else {
  document.addEventListener('DOMContentLoaded', initReveal);
}
