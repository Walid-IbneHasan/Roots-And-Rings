import { $ui, setFilters } from '../lib/stores';

/**
 * Client-side catalog: filter (category / body type / attribute), sort, and progressive
 * "Load More" over server-rendered product cells. Also drives the mobile filter drawer.
 */
const PAGE_SIZE = 9;

function init(): void {
  const grid = document.querySelector<HTMLElement>('[data-product-grid]');
  if (!grid) return;

  const cells = Array.from(grid.querySelectorAll<HTMLElement>('.product-cell'));
  const form = document.querySelector<HTMLFormElement>('[data-filter-form]');
  const sortSel = document.querySelector<HTMLSelectElement>('[data-sort]');
  const countEl = document.querySelector<HTMLElement>('[data-count]');
  const emptyEl = document.querySelector<HTMLElement>('[data-empty]');
  const loadWrap = document.querySelector<HTMLElement>('[data-loadmore-wrap]');
  const loadBtn = document.querySelector<HTMLElement>('[data-loadmore]');
  const panel = document.getElementById('filters');
  const overlay = document.getElementById('filters-overlay');

  let visible = PAGE_SIZE;

  const selected = (group: string): string[] =>
    Array.from(form?.querySelectorAll<HTMLInputElement>(`input[data-filter="${group}"]:checked`) ?? []).map(
      (i) => i.value,
    );

  function matches(cell: HTMLElement): boolean {
    const cats = selected('category');
    const bodyTypes = selected('bodyType');
    const attrs = selected('attribute');
    if (cats.length && !cats.includes(cell.dataset.category ?? '')) return false;
    if (bodyTypes.length && !bodyTypes.includes(cell.dataset.bodytype ?? '')) return false;
    if (attrs.length) {
      const badges = (cell.dataset.badges ?? '').split('|');
      if (!attrs.some((a) => badges.includes(a))) return false;
    }
    return true;
  }

  function sortCells(arr: HTMLElement[]): HTMLElement[] {
    const s = sortSel?.value ?? 'newest';
    const comparators: Record<string, (a: HTMLElement, b: HTMLElement) => number> = {
      'price-asc': (a, b) => Number(a.dataset.price) - Number(b.dataset.price),
      'price-desc': (a, b) => Number(b.dataset.price) - Number(a.dataset.price),
      newest: (a, b) => ((a.dataset.date ?? '') < (b.dataset.date ?? '') ? 1 : (a.dataset.date ?? '') > (b.dataset.date ?? '') ? -1 : 0),
    };
    return [...arr].sort(comparators[s] ?? comparators.newest);
  }

  function apply(): void {
    const matched = sortCells(cells.filter(matches));
    const matchedSet = new Set(matched);
    matched.forEach((c) => grid.appendChild(c)); // reorder DOM to sorted order
    cells.forEach((c) => {
      if (!matchedSet.has(c)) c.style.display = 'none';
    });
    matched.forEach((c, i) => {
      c.style.display = i < visible ? '' : 'none';
    });
    if (countEl) countEl.textContent = String(matched.length);
    if (emptyEl) emptyEl.hidden = matched.length > 0;
    if (loadWrap) loadWrap.hidden = visible >= matched.length;
  }

  form?.addEventListener('change', () => {
    visible = PAGE_SIZE;
    apply();
  });
  sortSel?.addEventListener('change', apply);
  loadBtn?.addEventListener('click', () => {
    visible += PAGE_SIZE;
    apply();
  });
  document.querySelector('[data-filters-clear]')?.addEventListener('click', () => {
    form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((i) => (i.checked = false));
    visible = PAGE_SIZE;
    apply();
    setFilters(false);
  });

  // mobile drawer
  document.querySelectorAll('[data-filters-open]').forEach((b) => b.addEventListener('click', () => setFilters(true)));
  document.querySelectorAll('[data-filters-close]').forEach((b) => b.addEventListener('click', () => setFilters(false)));
  overlay?.addEventListener('click', () => setFilters(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $ui.get().filtersOpen) setFilters(false);
  });
  $ui.subscribe((s) => {
    panel?.classList.toggle('open', s.filtersOpen);
    overlay?.classList.toggle('open', s.filtersOpen);
  });

  // pre-select category from ?category= query
  const cat = new URLSearchParams(location.search).get('category');
  if (cat) {
    const cb = form?.querySelector<HTMLInputElement>(`input[data-filter="category"][value="${cat}"]`);
    if (cb) cb.checked = true;
  }

  apply();
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
