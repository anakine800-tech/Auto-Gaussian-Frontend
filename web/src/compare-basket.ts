import { representativeAttempt } from './catalog-data';
import type { ChainObject } from './catalog-data';
import type { AttemptSummary } from './api';
import { useSyncExternalStore } from 'react';

type Basket = { ids: string[]; message: string };
export const COMPARE_LIMIT = 10;
const baskets = new Map<string, Basket>();
const event = 'ag:compare-basket';
const valid = (id: unknown): id is string =>
  typeof id === 'string' &&
  Boolean(id) &&
  id !== '.' &&
  id !== '..' &&
  !/[\/\\\0]/.test(id);
function normalize(ids: unknown): string[] {
  return Array.isArray(ids) ? [...new Set(ids.filter(valid))] : [];
}
function read(study: string): Basket {
  if (!baskets.has(study)) {
    let ids: string[] = [];
    try {
      ids = normalize(
        JSON.parse(sessionStorage.getItem('ag:cmp:' + study) ?? '[]'),
      );
    } catch {
      /* Storage is optional. */
    }
    const basket = {
      ids: ids.slice(0, COMPARE_LIMIT),
      message:
        ids.length > COMPARE_LIMIT
          ? `比较篮最多 ${COMPARE_LIMIT} 项；缓存中超过上限的项未加入。`
          : '',
    };
    baskets.set(study, basket);
    try {
      sessionStorage.setItem('ag:cmp:' + study, JSON.stringify(basket.ids));
    } catch {
      /* URL remains usable. */
    }
  }
  return baskets.get(study)!;
}
function save(study: string, basket: Basket) {
  baskets.set(study, basket);
  try {
    sessionStorage.setItem('ag:cmp:' + study, JSON.stringify(basket.ids));
  } catch {
    /* URL remains usable. */
  }
  window.dispatchEvent(new Event(event));
}
function writeURL(ids: string[]) {
  const [path, query = ''] = location.hash.split('?');
  const params = new URLSearchParams(query);
  params.set('cmp', ids.join(','));
  history.replaceState(
    history.state,
    '',
    location.pathname + location.search + path + '?' + params,
  );
}
export function syncBasketURL(study: string) {
  if (!study) return;
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const current = read(study);
  if (params.has('cmp')) {
    const raw = (params.get('cmp') ?? '').split(',');
    const normalized = normalize(raw);
    const ids = normalized.slice(0, COMPARE_LIMIT);
    const same = JSON.stringify(current.ids) === JSON.stringify(ids);
    // Keep a restoration/rejection notice through navigation of the same basket.
    const basket = {
      ids,
      message:
        normalized.length > COMPARE_LIMIT
          ? `比较篮最多 ${COMPARE_LIMIT} 项；链接中超过上限的项未加入。`
          : same
            ? current.message
            : '',
    };
    if (JSON.stringify(current) !== JSON.stringify(basket)) save(study, basket);
    if (raw.join(',') !== ids.join(',')) writeURL(ids);
  } else if (current.ids.length) writeURL(current.ids);
}
export function setCompared(study: string, id: string, checked: boolean) {
  const current = read(study);
  if (!valid(id)) return;
  if (
    checked &&
    !current.ids.includes(id) &&
    current.ids.length >= COMPARE_LIMIT
  ) {
    save(study, {
      ...current,
      message: `比较篮最多 ${COMPARE_LIMIT} 项，请先移除一项。`,
    });
    return;
  }
  const ids = checked
    ? normalize([...current.ids, id])
    : current.ids.filter((v) => v !== id);
  save(study, { ids, message: '' });
  writeURL(ids);
  window.dispatchEvent(new Event('ag:location'));
}
export function clearBasket(study: string) {
  save(study, { ids: [], message: '' });
  writeURL([]);
  window.dispatchEvent(new Event('ag:location'));
}
const subscribe = (notify: () => void) => {
  window.addEventListener(event, notify);
  return () => window.removeEventListener(event, notify);
};
export function useCompareBasket(study: string) {
  return useSyncExternalStore(subscribe, () => read(study));
}
export function addObjectToBasket(
  study: string,
  object: ChainObject,
  attempts: AttemptSummary[],
) {
  const id = representativeAttempt(object, attempts);
  if (id) setCompared(study, id, true);
}
