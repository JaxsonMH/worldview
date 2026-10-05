// Worldview: the shared news filter (CLAUDE.md section 5 design rule).
// One plain object describes "which articles", for the Reader list and,
// in Phase 2, the globe's My News layer. It matches the news service's
// ArticleFilter (news/worldview_news/filters.py) key for key.

export const SORTS = Object.freeze(['newest', 'oldest', 'source', 'topic']);

const LIST_KEYS = ['feeds', 'folders', 'topics'];
const TEXT_KEYS = ['q', 'since', 'until', 'country', 'admin1', 'city'];
const BOOL_KEYS = ['read', 'starred', 'has_location'];

/** Drop empty values so equal filters compare and save identically. */
export function cleanFilter(filter = {}) {
  const out = {};
  for (const key of TEXT_KEYS) {
    const value = typeof filter[key] === 'string' ? filter[key].trim() : '';
    if (value) out[key] = value;
  }
  for (const key of LIST_KEYS) {
    const list = Array.isArray(filter[key]) ? [...new Set(filter[key])] : [];
    if (list.length)
      out[key] =
        key === 'feeds'
          ? list.map(Number).sort((a, b) => a - b)
          : [...list].sort();
  }
  for (const key of BOOL_KEYS) {
    if (typeof filter[key] === 'boolean') out[key] = filter[key];
  }
  if (Number(filter.last_hours) > 0) out.last_hours = Number(filter.last_hours);
  const near = filter.near;
  if (
    near &&
    [near.lat, near.lon, near.km].every((v) => Number.isFinite(Number(v))) &&
    Number(near.km) > 0
  ) {
    out.near = {
      lat: Number(near.lat),
      lon: Number(near.lon),
      km: Number(near.km),
    };
    if (near.label) out.near.label = String(near.label);
  }
  if (SORTS.includes(filter.sort) && filter.sort !== 'newest')
    out.sort = filter.sort;
  return out;
}

/** The filter as sent to the API (labels are for people, not the server). */
export function toQuery(filter, { limit = 100, offset = 0 } = {}) {
  const query = { ...cleanFilter(filter), limit, offset };
  if (query.near)
    query.near = {
      lat: query.near.lat,
      lon: query.near.lon,
      km: query.near.km,
    };
  return query;
}

/** Encode a filter into a URL hash, so reloads, links and Back keep it. */
export function filterToHash(filter) {
  const clean = cleanFilter(filter);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(clean)) {
    if (key === 'near') {
      params.set('near', [value.lat, value.lon, value.km].join(','));
      if (value.label) params.set('near_label', value.label);
    } else if (Array.isArray(value)) params.set(key, value.join('|'));
    else params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `#${text}` : '';
}

export function filterFromHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const filter = {};
  for (const key of TEXT_KEYS)
    if (params.has(key)) filter[key] = params.get(key);
  for (const key of LIST_KEYS) {
    if (params.has(key))
      filter[key] = params.get(key).split('|').filter(Boolean);
  }
  for (const key of BOOL_KEYS) {
    if (params.has(key)) filter[key] = params.get(key) === 'true';
  }
  if (params.has('last_hours'))
    filter.last_hours = Number(params.get('last_hours'));
  if (params.has('sort')) filter.sort = params.get('sort');
  if (params.has('near')) {
    const [lat, lon, km] = params.get('near').split(',').map(Number);
    filter.near = {
      lat,
      lon,
      km,
      label: params.get('near_label') || undefined,
    };
  }
  return cleanFilter(filter);
}

export function sameFilter(a, b) {
  return JSON.stringify(cleanFilter(a)) === JSON.stringify(cleanFilter(b));
}

const HOUR_LABELS = {
  6: 'last 6 hours',
  24: 'last 24 hours',
  168: 'last 7 days',
  720: 'last 30 days',
};

/**
 * Plain-English pieces of a filter, each with the key(s) that remove it.
 * `names` optionally maps feed ids, country codes and "CC.admin1" to display names.
 */
export function describeFilter(filter, names = {}) {
  const f = cleanFilter(filter);
  const parts = [];
  if (f.q) parts.push({ label: `“${f.q}”`, remove: ['q'] });
  for (const topic of f.topics ?? [])
    parts.push({ label: topic, remove: ['topics', topic] });
  for (const folder of f.folders ?? [])
    parts.push({ label: `Folder: ${folder}`, remove: ['folders', folder] });
  for (const id of f.feeds ?? [])
    parts.push({
      label: names.feeds?.[id] ?? `Feed ${id}`,
      remove: ['feeds', id],
    });
  if (f.last_hours)
    parts.push({
      label: HOUR_LABELS[f.last_hours] ?? `last ${f.last_hours} hours`,
      remove: ['last_hours'],
    });
  if (f.since)
    parts.push({ label: `from ${f.since.slice(0, 10)}`, remove: ['since'] });
  if (f.until)
    parts.push({ label: `until ${f.until.slice(0, 10)}`, remove: ['until'] });
  if (f.read === false) parts.push({ label: 'Unread', remove: ['read'] });
  if (f.read === true) parts.push({ label: 'Read', remove: ['read'] });
  if (f.starred) parts.push({ label: 'Starred', remove: ['starred'] });
  if (f.has_location === true)
    parts.push({ label: 'Has a location', remove: ['has_location'] });
  if (f.has_location === false)
    parts.push({ label: 'No location', remove: ['has_location'] });
  if (f.city) parts.push({ label: f.city, remove: ['city'] });
  if (f.admin1) {
    parts.push({
      label: names.regions?.[`${f.country}.${f.admin1}`] ?? f.admin1,
      remove: ['admin1'],
    });
  }
  if (f.country)
    parts.push({
      label: names.countries?.[f.country] ?? f.country,
      remove: ['country'],
    });
  if (f.near) {
    parts.push({
      label: `within ${f.near.km} km of ${f.near.label ?? `${f.near.lat.toFixed(2)}, ${f.near.lon.toFixed(2)}`}`,
      remove: ['near'],
    });
  }
  if (f.sort) parts.push({ label: `sorted by ${f.sort}`, remove: ['sort'] });
  return parts;
}

/** Remove one piece (as given by describeFilter) from a filter. */
export function removePart(filter, [key, value]) {
  const next = { ...cleanFilter(filter) };
  if (value !== undefined && Array.isArray(next[key])) {
    next[key] = next[key].filter((v) => v !== value);
  } else {
    delete next[key];
    if (key === 'country') {
      delete next.admin1;
      delete next.city;
    }
    if (key === 'admin1') delete next.city;
  }
  return cleanFilter(next);
}
