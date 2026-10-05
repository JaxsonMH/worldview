// Worldview Reader: a news reader over the news service (/api/news).
// Every list it shows comes from one filter object (../newsFilter.js), kept in
// the page address so reloads, Back and saved searches all restore it exactly.

import {
  cleanFilter,
  describeFilter,
  filterFromHash,
  filterToHash,
  removePart,
  sameFilter,
  toQuery,
} from '../newsFilter.js';
import { newsApi } from '../newsApi.js';

const PAGE = 100;
const TIME_CHOICES = [
  [6, '6h'],
  [24, '24h'],
  [168, '7 days'],
  [720, '30 days'],
  [0, 'Any time'],
];
const NEAR_KM = [10, 25, 50, 100, 250, 500];

const state = {
  filter: filterFromHash(location.hash),
  articles: [],
  total: 0,
  selectedId: null,
  facets: null,
  topics: [],
  saved: [],
  view: 'articles', // or 'feeds'
  feeds: [],
  loading: false,
  editingTopics: false,
};

// ---------- tiny DOM helper ----------

/** h('div.class', {attrs/on...}, ...children) — text children are always escaped.
 *  The props object may be left out: h('span', 'text'). */
function h(tag, props = {}, ...children) {
  if (
    props === null ||
    typeof props !== 'object' ||
    Array.isArray(props) ||
    props instanceof Node
  ) {
    children.unshift(props);
    props = {};
  }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object')
      Object.assign(el.style, value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return el;
}

const $ = (id) => document.getElementById(id);

function toast(message, kind = 'error') {
  const box = $('toast');
  box.textContent = message;
  box.dataset.kind = kind;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (box.hidden = true), 5000);
}

async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message);
    return undefined;
  }
}

// ---------- formatting ----------

function timeAgo(iso) {
  const seconds = (Date.now() - Date.parse(iso)) / 1000;
  if (seconds < 90) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 2 * 86400) return 'yesterday';
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const fullTime = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

function topicColor(name) {
  return state.topics.find((t) => t.name === name)?.color ?? '#888';
}

/** Turn a feed's HTML summary into safe paragraphs + an optional picture. */
function summaryContent(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const img = [...doc.images].find((i) => i.src.startsWith('https://'));
  const blocks = [...doc.body.querySelectorAll('p, li')]
    .map((n) => n.textContent.trim())
    .filter(Boolean);
  const paragraphs = blocks.length
    ? blocks
    : [doc.body.textContent.trim()].filter(Boolean);
  return { image: img?.src, alt: img?.alt ?? '', paragraphs };
}

function nameMaps() {
  const f = state.facets;
  if (!f) return {};
  return {
    feeds: Object.fromEntries(f.feeds.map((x) => [x.id, x.title])),
    countries: Object.fromEntries(f.countries.map((x) => [x.code, x.name])),
    regions: Object.fromEntries(
      f.regions.map((x) => [`${x.country}.${x.admin1}`, x.name]),
    ),
  };
}

// ---------- data loading ----------

function setFilter(next, { push = true } = {}) {
  state.filter = cleanFilter(next);
  const hash = filterToHash(state.filter);
  if (push && hash !== location.hash)
    history.pushState(null, '', hash || location.pathname);
  state.view = 'articles';
  loadArticles();
}

async function loadArticles({ more = false } = {}) {
  state.loading = true;
  renderMain();
  const offset = more ? state.articles.length : 0;
  const data = await attempt(() =>
    newsApi.search(toQuery(state.filter, { limit: PAGE, offset })),
  );
  state.loading = false;
  if (data) {
    state.articles = more
      ? [...state.articles, ...data.articles]
      : data.articles;
    state.total = data.total;
    if (!more && !state.articles.some((a) => a.id === state.selectedId))
      state.selectedId = null;
  }
  renderMain();
  renderSidebar();
}

async function loadFacets() {
  const first = !state.facets;
  const facets = await attempt(() => newsApi.facets());
  if (facets) state.facets = facets;
  renderSidebar();
  if (first && facets && state.view === 'articles') renderMain(); // place pickers + readable filter names
}

async function loadSaved() {
  const saved = await attempt(() => newsApi.savedSearches());
  if (saved) state.saved = saved;
  renderSidebar();
}

async function refreshStatus() {
  const health = await newsApi.health().catch(() => null);
  const el = $('status');
  if (!health) {
    el.textContent = 'News service offline';
    el.dataset.kind = 'bad';
    return;
  }
  el.dataset.kind = health.broken_feeds ? 'warn' : 'ok';
  el.textContent =
    `${health.articles.toLocaleString()} articles` +
    (health.last_new_article
      ? ` · updated ${timeAgo(health.last_new_article)}`
      : '') +
    (health.broken_feeds
      ? ` · ${health.broken_feeds} feed${health.broken_feeds > 1 ? 's' : ''} failing`
      : '');
}

// ---------- sidebar ----------

function sideItem({ label, count, active, onclick, color, warn, title }) {
  return h(
    'button.wv-side-item' + (active ? '.is-active' : ''),
    { type: 'button', onclick, title },
    color ? h('span.wv-dot', { style: { background: color } }) : null,
    h('span.wv-side-label', label),
    warn ? h('span.wv-warn', { title: 'This feed is failing' }, '!') : null,
    count ? h('span.wv-count', count.toLocaleString()) : null,
  );
}

function toggleInList(key, value) {
  const list = state.filter[key] ?? [];
  const next = list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
  setFilter({ ...state.filter, [key]: next });
}

function renderSidebar() {
  const side = $('sidebar');
  const f = state.facets;
  const filter = state.filter;
  const totalUnread = f ? f.folders.reduce((n, x) => n + x.unread, 0) : 0;
  const children = [
    h(
      'section.wv-side-section',
      {},
      sideItem({
        label: 'All articles',
        count: totalUnread,
        active: sameFilter(filter, {}),
        onclick: () => setFilter({}),
        title: 'Unread count',
      }),
      sideItem({
        label: 'Unread',
        active: sameFilter(filter, { read: false }),
        onclick: () => setFilter({ read: false }),
      }),
      sideItem({
        label: 'Starred',
        active: sameFilter(filter, { starred: true }),
        onclick: () => setFilter({ starred: true }),
      }),
    ),
    renderSavedSection(),
  ];
  if (f) {
    const topicCounts = Object.fromEntries(
      f.topics.map((t) => [t.topic, t.unread]),
    );
    children.push(
      h(
        'section.wv-side-section',
        {},
        h('h2.wv-side-title', 'Topics'),
        state.topics.map((t) =>
          sideItem({
            label: t.name,
            count: topicCounts[t.name],
            color: t.color,
            active: filter.topics?.includes(t.name),
            onclick: () => toggleInList('topics', t.name),
            title: t.description,
          }),
        ),
      ),
      h(
        'section.wv-side-section',
        {},
        h('h2.wv-side-title', 'Feeds'),
        f.folders.map((folder) =>
          h(
            'details.wv-folder',
            {
              open:
                filter.folders?.includes(folder.folder) ||
                filter.feeds?.length > 0,
            },
            h(
              'summary',
              {},
              sideItem({
                label: folder.folder ?? 'Other',
                count: folder.unread,
                active: filter.folders?.includes(folder.folder),
                onclick: (e) => {
                  e.preventDefault();
                  toggleInList('folders', folder.folder);
                },
              }),
            ),
            f.feeds
              .filter((feed) => feed.folder === folder.folder)
              .map((feed) =>
                sideItem({
                  label: feed.title,
                  count: feed.unread,
                  warn: feed.error_count > 0,
                  active: filter.feeds?.includes(feed.id),
                  onclick: () => toggleInList('feeds', feed.id),
                }),
              ),
          ),
        ),
      ),
    );
  }
  side.replaceChildren(...children);
}

function renderSavedSection() {
  const current = state.saved.find((s) => sameFilter(s.query, state.filter));
  return h(
    'section.wv-side-section',
    {},
    h(
      'h2.wv-side-title',
      {},
      'Saved searches',
      h(
        'button.wv-mini',
        {
          type: 'button',
          title: 'Save the current filters as a search',
          disabled: sameFilter(state.filter, {}) || Boolean(current),
          onclick: saveCurrentSearch,
        },
        '+ Save',
      ),
    ),
    state.saved.length
      ? state.saved.map((s) =>
          h(
            'div.wv-saved',
            {},
            sideItem({
              label: (s.pinned ? '★ ' : '') + s.name,
              active: current?.id === s.id,
              onclick: () => setFilter(s.query),
              title: describeFilter(s.query, nameMaps())
                .map((p) => p.label)
                .join(' · '),
            }),
            h(
              'details.wv-menu',
              {},
              h(
                'summary',
                {
                  title: 'Edit this saved search',
                  'aria-label': `Edit ${s.name}`,
                },
                '⋯',
              ),
              h(
                'div.wv-menu-body',
                {},
                h(
                  'button',
                  { type: 'button', onclick: () => renameSaved(s) },
                  'Rename',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onclick: () =>
                      updateSaved(
                        s,
                        { query: state.filter },
                        'Updated with current filters',
                      ),
                    disabled: sameFilter(s.query, state.filter),
                  },
                  'Replace with current filters',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onclick: () => updateSaved(s, { pinned: !s.pinned }),
                  },
                  s.pinned ? 'Unpin' : 'Pin to top',
                ),
                h(
                  'button.wv-danger',
                  { type: 'button', onclick: () => deleteSaved(s) },
                  'Delete',
                ),
              ),
            ),
          ),
        )
      : h('p.wv-hint', 'Set some filters, then press “+ Save”.'),
  );
}

async function saveCurrentSearch() {
  const suggestion = describeFilter(state.filter, nameMaps())
    .map((p) => p.label)
    .join(' · ')
    .slice(0, 80);
  const name = prompt('Name this saved search:', suggestion);
  if (!name?.trim()) return;
  const made = await attempt(() =>
    newsApi.createSaved({ name: name.trim(), query: state.filter }),
  );
  if (made) {
    toast(`Saved “${made.name}”`, 'ok');
    loadSaved();
  }
}

async function updateSaved(saved, changes, message) {
  const body = {
    name: saved.name,
    query: saved.query,
    pinned: saved.pinned,
    ...changes,
  };
  const done = await attempt(() => newsApi.updateSaved(saved.id, body));
  if (done) {
    if (message) toast(message, 'ok');
    loadSaved();
  }
}

function renameSaved(saved) {
  const name = prompt('New name:', saved.name);
  if (name?.trim() && name.trim() !== saved.name)
    updateSaved(saved, { name: name.trim() });
}

async function deleteSaved(saved) {
  if (
    !confirm(
      `Delete the saved search “${saved.name}”? Articles are not affected.`,
    )
  )
    return;
  await attempt(() => newsApi.deleteSaved(saved.id));
  loadSaved();
}

// ---------- filter bar ----------

function renderFilterBar() {
  const filter = state.filter;
  const f = state.facets;
  const search = h('input.wv-search', {
    id: 'wv-q',
    type: 'search',
    placeholder: 'Search headlines and summaries…',
    value: filter.q ?? '',
    'aria-label': 'Search',
  });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => setFilter({ ...state.filter, q: search.value }, { push: false }),
      350,
    );
  });

  const timeChips = h(
    'div.wv-chips',
    { role: 'group', 'aria-label': 'Time window' },
    TIME_CHOICES.map(([hours, label]) =>
      h(
        'button.wv-chip' +
          ((filter.last_hours ?? 0) === hours && !filter.since
            ? '.is-active'
            : ''),
        {
          type: 'button',
          onclick: () =>
            setFilter({
              ...state.filter,
              last_hours: hours || undefined,
              since: undefined,
              until: undefined,
            }),
        },
        label,
      ),
    ),
    h(
      'details.wv-pop',
      {},
      h(
        'summary.wv-chip' + (filter.since || filter.until ? '.is-active' : ''),
        'Dates…',
      ),
      renderDateRange(),
    ),
  );

  const select = (label, value, options, onchange) =>
    h(
      'label.wv-select',
      {},
      h('span', label),
      h(
        'select',
        { onchange: (e) => onchange(e.target.value) },
        options.map(([v, text]) =>
          h(
            'option',
            { value: v, selected: String(value ?? '') === String(v) },
            text,
          ),
        ),
      ),
    );

  const readValue = filter.starred
    ? 'starred'
    : filter.read === false
      ? 'unread'
      : filter.read === true
        ? 'read'
        : '';
  const controls = h(
    'div.wv-controls',
    {},
    select(
      'Show',
      readValue,
      [
        ['', 'All'],
        ['unread', 'Unread'],
        ['read', 'Read'],
        ['starred', 'Starred'],
      ],
      (v) =>
        setFilter({
          ...state.filter,
          read: v === 'unread' ? false : v === 'read' ? true : undefined,
          starred: v === 'starred' ? true : undefined,
        }),
    ),
    select(
      'Location',
      filter.has_location === undefined ? '' : String(filter.has_location),
      [
        ['', 'Any'],
        ['true', 'Has a location'],
        ['false', 'No location'],
      ],
      (v) =>
        setFilter({
          ...state.filter,
          has_location: v === '' ? undefined : v === 'true',
        }),
    ),
    f && renderPlacePickers(select),
    h(
      'details.wv-pop',
      {},
      h('summary.wv-chip' + (filter.near ? '.is-active' : ''), 'Near…'),
      renderNear(),
    ),
    select(
      'Sort',
      filter.sort ?? 'newest',
      [
        ['newest', 'Newest first'],
        ['oldest', 'Oldest first'],
        ['source', 'By source'],
        ['topic', 'By topic'],
      ],
      (v) => setFilter({ ...state.filter, sort: v }),
    ),
  );

  const parts = describeFilter(filter, nameMaps());
  const active = parts.length
    ? h(
        'div.wv-active',
        {},
        parts.map((p) =>
          h(
            'button.wv-pill',
            {
              type: 'button',
              title: 'Remove this filter',
              onclick: () => setFilter(removePart(state.filter, p.remove)),
            },
            p.label,
            h('span', { 'aria-hidden': 'true' }, ' ×'),
          ),
        ),
        h(
          'button.wv-link',
          { type: 'button', onclick: () => setFilter({}) },
          'Clear all',
        ),
      )
    : null;

  return h(
    'div.wv-filterbar',
    {},
    h('div.wv-row', {}, search, timeChips),
    controls,
    active,
  );
}

function renderPlacePickers(select) {
  const filter = state.filter;
  const f = state.facets;
  const regions = f.regions.filter((r) => r.country === filter.country);
  const cities = f.cities.filter(
    (c) =>
      (!filter.country || c.country === filter.country) &&
      (!filter.admin1 || c.admin1 === filter.admin1),
  );
  return h(
    'span.wv-places',
    {},
    select(
      'Country',
      filter.country,
      [
        ['', 'Any'],
        ...f.countries
          .slice(0, 80)
          .map((c) => [c.code, `${c.name} (${c.count})`]),
      ],
      (v) =>
        setFilter({
          ...state.filter,
          country: v,
          admin1: undefined,
          city: undefined,
          near: undefined,
        }),
    ),
    filter.country && regions.length
      ? select(
          'Province/state',
          filter.admin1,
          [
            ['', 'Any'],
            ...regions.map((r) => [r.admin1, `${r.name} (${r.count})`]),
          ],
          (v) => setFilter({ ...state.filter, admin1: v, city: undefined }),
        )
      : null,
    filter.country && cities.length
      ? select(
          'City',
          filter.city,
          [
            ['', 'Any'],
            ...cities
              .slice(0, 150)
              .map((c) => [c.name, `${c.name} (${c.count})`]),
          ],
          (v) => setFilter({ ...state.filter, city: v }),
        )
      : null,
  );
}

function renderDateRange() {
  const from = h('input', {
    type: 'date',
    value: state.filter.since?.slice(0, 10) ?? '',
  });
  const to = h('input', {
    type: 'date',
    value: state.filter.until?.slice(0, 10) ?? '',
  });
  return h(
    'div.wv-pop-body',
    {},
    h('label', {}, 'From ', from),
    h('label', {}, 'To ', to),
    h(
      'button.wv-btn',
      {
        type: 'button',
        onclick: () =>
          setFilter({
            ...state.filter,
            last_hours: undefined,
            since: from.value ? `${from.value}T00:00:00` : undefined,
            until: to.value ? `${to.value}T23:59:59` : undefined,
          }),
      },
      'Apply',
    ),
  );
}

function renderNear() {
  const near = state.filter.near;
  const input = h('input', {
    type: 'search',
    placeholder: 'Type a place, e.g. Victoria',
    value: near?.label ?? '',
  });
  const km = h(
    'select',
    {},
    NEAR_KM.map((k) =>
      h('option', { value: k, selected: (near?.km ?? 50) === k }, `${k} km`),
    ),
  );
  const results = h('div.wv-suggest');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      const places =
        q.length >= 2 ? await newsApi.placeSearch(q).catch(() => []) : [];
      results.replaceChildren(
        ...places.map((p) =>
          h(
            'button',
            {
              type: 'button',
              // One kind of location filter at a time: "near" replaces country/province/city.
              onclick: () =>
                setFilter({
                  ...state.filter,
                  country: undefined,
                  admin1: undefined,
                  city: undefined,
                  near: {
                    lat: p.lat,
                    lon: p.lon,
                    km: Number(km.value),
                    label: p.name,
                  },
                }),
            },
            p.name,
            h('small', [p.region, p.country_code].filter(Boolean).join(', ')),
          ),
        ),
      );
    }, 250);
  });
  return h(
    'div.wv-pop-body',
    {},
    h('label', {}, 'Within ', km, ' of'),
    input,
    results,
    near
      ? h(
          'button.wv-link',
          {
            type: 'button',
            onclick: () => setFilter(removePart(state.filter, ['near'])),
          },
          'Remove',
        )
      : null,
  );
}

// ---------- article list + preview ----------

function renderList() {
  if (!state.articles.length) {
    return h(
      'div.wv-empty',
      {},
      state.loading
        ? 'Loading…'
        : sameFilter(state.filter, {})
          ? 'No articles yet. The news service fetches feeds every 10 minutes; the first fetch starts when it does.'
          : 'Nothing matches these filters.',
    );
  }
  const items = state.articles.map((a) => {
    const place = a.places[0];
    return h(
      'li',
      {},
      h(
        'button.wv-item' +
          (a.id === state.selectedId ? '.is-selected' : '') +
          (a.read ? '' : '.is-unread'),
        { type: 'button', onclick: () => select(a.id), 'data-id': a.id },
        h('span.wv-item-title', a.title),
        h(
          'span.wv-item-meta',
          {},
          a.starred ? h('span.wv-star', { title: 'Starred' }, '★ ') : null,
          a.feed_title,
          ' · ',
          h(
            'time',
            { datetime: a.published_at, title: fullTime(a.published_at) },
            timeAgo(a.published_at),
          ),
          place ? ` · ${place.name}` : '',
        ),
        h(
          'span.wv-item-topics',
          {},
          a.topics.map((t) =>
            h(
              'span.wv-tag',
              { style: { '--c': topicColor(t.topic) } },
              t.topic,
            ),
          ),
        ),
      ),
    );
  });
  return h(
    'div.wv-list-wrap',
    {},
    h(
      'div.wv-list-head',
      {},
      h(
        'span',
        `${state.total.toLocaleString()} article${state.total === 1 ? '' : 's'}`,
      ),
      h(
        'button.wv-link',
        { type: 'button', onclick: markAllRead, disabled: !state.total },
        'Mark all as read',
      ),
    ),
    h('ul.wv-list', {}, items),
    state.articles.length < state.total
      ? h(
          'button.wv-btn.wv-more',
          {
            type: 'button',
            onclick: () => loadArticles({ more: true }),
            disabled: state.loading,
          },
          `Load more (${(state.total - state.articles.length).toLocaleString()} left)`,
        )
      : null,
  );
}

function renderPreview() {
  const a = state.articles.find((x) => x.id === state.selectedId);
  if (!a)
    return h(
      'div.wv-preview.wv-empty',
      {},
      'Pick an article to read it here. Keys: j / k next / previous, s star, o open, m read/unread.',
    );
  const body = summaryContent(a.summary);
  return h(
    'article.wv-preview',
    { 'aria-label': 'Article preview' },
    h(
      'h1',
      {},
      h(
        'a',
        { href: a.url, target: '_blank', rel: 'noopener noreferrer' },
        a.title,
      ),
    ),
    h(
      'p.wv-source',
      {},
      h('strong', a.feed_title),
      a.author ? ` · ${a.author}` : '',
      h('br'),
      'Published ',
      h('time', { datetime: a.published_at }, fullTime(a.published_at)),
      ' · fetched ',
      h('time', { datetime: a.fetched_at }, timeAgo(a.fetched_at)),
    ),
    h(
      'div.wv-actions',
      {},
      h(
        'a.wv-btn',
        { href: a.url, target: '_blank', rel: 'noopener noreferrer' },
        'Open original ↗',
      ),
      h(
        'button.wv-btn.wv-btn-ghost',
        { type: 'button', onclick: () => toggleStar(a) },
        a.starred ? '★ Starred' : '☆ Star',
      ),
      h(
        'button.wv-btn.wv-btn-ghost',
        { type: 'button', onclick: () => toggleRead(a) },
        a.read ? 'Mark unread' : 'Mark read',
      ),
      h(
        'button.wv-btn.wv-btn-ghost',
        {
          type: 'button',
          disabled: true,
          title: 'Comes with the globe’s My News layer (Phase 2)',
        },
        'Show on globe',
      ),
    ),
    renderTopicsBox(a),
    a.places.length
      ? h(
          'div.wv-meta-row',
          {},
          h('span.wv-meta-label', 'Places'),
          a.places.map((p) =>
            h(
              'button.wv-tag.wv-tag-place',
              {
                type: 'button',
                title: `${p.precision}-level, ${Math.round(p.confidence * 100)}% confident (found “${p.mention_text}”). Click for nearby news.`,
                onclick: () =>
                  setFilter({
                    near: { lat: p.lat, lon: p.lon, km: 25, label: p.name },
                  }),
              },
              p.name,
              p.precision === 'country'
                ? ''
                : h(
                    'small',
                    ` ${[p.admin1 && regionName(p), p.country_code].filter(Boolean).join(', ')}`,
                  ),
            ),
          ),
        )
      : h(
          'div.wv-meta-row',
          {},
          h('span.wv-meta-label', 'Places'),
          h('span.wv-hint', 'No confident location found'),
        ),
    body.image
      ? h('img.wv-picture', {
          src: body.image,
          alt: body.alt,
          loading: 'lazy',
          referrerPolicy: 'no-referrer',
        })
      : null,
    body.paragraphs.map((p) => h('p', {}, p)),
    h(
      'p.wv-hint',
      'This is the summary the feed provides. Open the original for the full story.',
    ),
  );
}

function regionName(place) {
  return (
    state.facets?.regions.find(
      (r) => r.country === place.country_code && r.admin1 === place.admin1,
    )?.name ?? place.admin1
  );
}

function renderTopicsBox(a) {
  if (!state.editingTopics) {
    return h(
      'div.wv-meta-row',
      {},
      h('span.wv-meta-label', 'Topics'),
      a.topics.map((t) =>
        h(
          'button.wv-tag',
          {
            type: 'button',
            style: { '--c': topicColor(t.topic) },
            title:
              t.source === 'feed_default'
                ? 'From the feed'
                : t.source === 'rule'
                  ? 'Added by a rule'
                  : 'Set by you',
            onclick: () => setFilter({ topics: [t.topic] }),
          },
          t.topic,
        ),
      ),
      h(
        'button.wv-link',
        {
          type: 'button',
          onclick: () => ((state.editingTopics = true), renderMain()),
        },
        'Edit',
      ),
    );
  }
  const chosen = new Set(a.topics.map((t) => t.topic));
  return h(
    'div.wv-meta-row.wv-editing',
    {},
    h('span.wv-meta-label', 'Topics'),
    state.topics.map((t) =>
      h(
        'label.wv-check',
        {},
        h('input', {
          type: 'checkbox',
          checked: chosen.has(t.name),
          onchange: (e) =>
            e.target.checked ? chosen.add(t.name) : chosen.delete(t.name),
        }),
        h('span.wv-dot', { style: { background: t.color } }),
        t.name,
      ),
    ),
    h(
      'button.wv-btn',
      {
        type: 'button',
        onclick: async () => {
          const done = await attempt(() =>
            newsApi.setTopics(a.id, [...chosen]),
          );
          if (done) {
            a.topics = [...chosen].map((topic) => ({
              topic,
              source: 'manual',
            }));
            state.editingTopics = false;
            renderMain();
            loadFacets();
          }
        },
      },
      'Save topics',
    ),
    h(
      'button.wv-link',
      {
        type: 'button',
        onclick: () => ((state.editingTopics = false), renderMain()),
      },
      'Cancel',
    ),
  );
}

async function select(id) {
  state.selectedId = id;
  state.editingTopics = false;
  const a = state.articles.find((x) => x.id === id);
  const wasUnread = a && !a.read;
  if (wasUnread) a.read = true;
  renderMain();
  document
    .querySelector(`.wv-item[data-id="${id}"]`)
    ?.scrollIntoView({ block: 'nearest' });
  if (wasUnread) {
    await attempt(() => newsApi.patchArticle(id, { read: true }));
    loadFacets();
  }
}

async function toggleStar(a) {
  a.starred = !a.starred;
  renderMain();
  await attempt(() => newsApi.patchArticle(a.id, { starred: a.starred }));
}

async function toggleRead(a) {
  a.read = !a.read;
  renderMain();
  await attempt(() => newsApi.patchArticle(a.id, { read: a.read }));
  loadFacets();
}

async function markAllRead() {
  if (
    !confirm(
      `Mark all ${state.total.toLocaleString()} matching articles as read?`,
    )
  )
    return;
  const done = await attempt(() =>
    newsApi.markRead(toQuery(state.filter, { limit: 1 })),
  );
  if (done) {
    toast(`Marked ${done.marked.toLocaleString()} as read`, 'ok');
    loadArticles();
    loadFacets();
  }
}

// ---------- feed management ----------

async function openFeeds() {
  state.view = 'feeds';
  renderMain();
  const feeds = await attempt(() => newsApi.feeds());
  if (feeds) state.feeds = feeds;
  renderMain();
}

function renderFeeds() {
  const folders = [
    ...new Set(state.feeds.map((f) => f.folder).filter(Boolean)),
  ];
  const url = h('input', {
    type: 'url',
    placeholder: 'https://example.com/feed',
    required: true,
  });
  const folder = h('input', {
    list: 'wv-folders',
    placeholder: 'Folder',
    value: 'Local',
  });
  const topic = h(
    'select',
    {},
    h('option', { value: '' }, 'No default topic'),
    state.topics.map((t) => h('option', { value: t.name }, t.name)),
  );
  const addForm = h(
    'form.wv-add',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button');
        button.disabled = true;
        button.textContent = 'Checking…';
        const made = await attempt(() =>
          newsApi.addFeed({
            url: url.value.trim(),
            folder: folder.value.trim() || 'Other',
            default_topic: topic.value || null,
          }),
        );
        button.disabled = false;
        button.textContent = 'Add feed';
        if (made) {
          toast(
            `Added “${made.title}” with ${made.article_count} articles`,
            'ok',
          );
          openFeeds();
          loadFacets();
        }
      },
    },
    h(
      'datalist',
      { id: 'wv-folders' },
      folders.map((x) => h('option', { value: x })),
    ),
    url,
    folder,
    topic,
    h('button.wv-btn', { type: 'submit' }, 'Add feed'),
  );
  const fileInput = h('input', {
    type: 'file',
    accept: '.opml,.xml,text/xml',
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const done = await attempt(async () =>
        newsApi.importOpml(await file.text()),
      );
      if (done) {
        toast(`Imported: ${done.added} new, ${done.updated} updated`, 'ok');
        openFeeds();
        loadFacets();
      }
    },
  });
  const rows = state.feeds.map((f) =>
    h(
      'tr' + (f.error_count ? '.is-broken' : '') + (f.enabled ? '' : '.is-off'),
      {},
      h(
        'td',
        {},
        h('strong', f.title),
        h('br'),
        h(
          'small',
          h(
            'a',
            { href: f.url, target: '_blank', rel: 'noopener noreferrer' },
            f.url,
          ),
        ),
      ),
      h('td', f.folder ?? ''),
      h(
        'td',
        {},
        h(
          'select',
          {
            'aria-label': `Default topic for ${f.title}`,
            onchange: async (e) => {
              const done = await attempt(() =>
                newsApi.patchFeed(f.id, { default_topic: e.target.value }),
              );
              if (done)
                toast(
                  `New articles from ${f.title} will be tagged ${e.target.value}`,
                  'ok',
                );
            },
          },
          state.topics.map((t) =>
            h(
              'option',
              { value: t.name, selected: t.name === f.default_topic },
              t.name,
            ),
          ),
        ),
      ),
      h('td.wv-num', f.article_count.toLocaleString()),
      h('td', f.last_fetched ? timeAgo(f.last_fetched) : 'never'),
      h(
        'td',
        f.error_count
          ? h(
              'span.wv-bad',
              { title: f.last_error },
              `Failing (${f.error_count}×): ${f.last_error}`,
            )
          : 'OK',
      ),
      h(
        'td',
        {},
        h(
          'label.wv-check',
          {},
          h('input', {
            type: 'checkbox',
            checked: f.enabled,
            onchange: async (e) => {
              await attempt(() =>
                newsApi.patchFeed(f.id, { enabled: e.target.checked }),
              );
              openFeeds();
              loadFacets();
            },
          }),
          'On',
        ),
      ),
    ),
  );
  return h(
    'section.wv-feeds',
    {},
    h(
      'div.wv-feeds-head',
      {},
      h('h1', 'Feeds'),
      h(
        'button.wv-link',
        {
          type: 'button',
          onclick: () => ((state.view = 'articles'), renderMain()),
        },
        '← Back to articles',
      ),
    ),
    h(
      'p.wv-hint',
      'Changes here are saved to config/worldview/feeds.opml. Turning a feed off keeps its old articles.',
    ),
    addForm,
    h(
      'div.wv-actions',
      {},
      h(
        'button.wv-btn.wv-btn-ghost',
        { type: 'button', onclick: () => fileInput.click() },
        'Import OPML…',
      ),
      fileInput,
      h(
        'a.wv-btn.wv-btn-ghost',
        { href: '/api/news/feeds.opml', download: 'worldview-feeds.opml' },
        'Export OPML',
      ),
      h(
        'button.wv-btn.wv-btn-ghost',
        {
          type: 'button',
          onclick: async (e) => {
            e.target.disabled = true;
            e.target.textContent = 'Fetching… (can take a minute)';
            await attempt(() => newsApi.fetchNow());
            e.target.disabled = false;
            e.target.textContent = 'Fetch all now';
            openFeeds();
            loadFacets();
            refreshStatus();
          },
        },
        'Fetch all now',
      ),
    ),
    h(
      'table.wv-table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          [
            'Feed',
            'Folder',
            'Default topic',
            'Articles',
            'Last checked',
            'Status',
            '',
          ].map((x) => h('th', x)),
        ),
      ),
      h('tbody', {}, rows),
    ),
  );
}

// ---------- page ----------

function renderMain() {
  const main = $('main');
  // Re-rendering replaces the search box; keep typing uninterrupted.
  const focused =
    document.activeElement?.id === 'wv-q'
      ? document.activeElement.selectionStart
      : null;
  try {
    paintMain(main);
  } finally {
    if (focused !== null) {
      const box = $('wv-q');
      box?.focus();
      box?.setSelectionRange(focused, focused);
    }
  }
}

function paintMain(main) {
  if (state.view === 'feeds') {
    main.replaceChildren(renderFeeds());
    return;
  }
  main.replaceChildren(
    h(
      'div.wv-reader',
      {},
      h('div.wv-left', {}, renderFilterBar(), renderList()),
      renderPreview(),
    ),
  );
}

function moveSelection(step) {
  if (!state.articles.length) return;
  const index = state.articles.findIndex((a) => a.id === state.selectedId);
  const next =
    state.articles[
      Math.min(Math.max(index + step, 0), state.articles.length - 1)
    ];
  if (next) select(next.id);
}

document.addEventListener('keydown', (e) => {
  if (
    e.target.closest('input, textarea, select') ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    state.view !== 'articles'
  )
    return;
  const a = state.articles.find((x) => x.id === state.selectedId);
  if (e.key === 'j') moveSelection(1);
  else if (e.key === 'k') moveSelection(-1);
  else if (e.key === 's' && a) toggleStar(a);
  else if (e.key === 'm' && a) toggleRead(a);
  else if (e.key === 'o' && a?.url) window.open(a.url, '_blank', 'noopener');
});

// Back/Forward, or editing the address by hand.
window.addEventListener('hashchange', () => {
  const next = filterFromHash(location.hash);
  if (!sameFilter(next, state.filter)) setFilter(next, { push: false });
});
$('manage-feeds').addEventListener('click', openFeeds);

async function start() {
  renderMain();
  state.topics = (await newsApi.topics().catch(() => [])) ?? [];
  await Promise.all([
    loadArticles(),
    loadFacets(),
    loadSaved(),
    refreshStatus(),
  ]);
  // Keep counts fresh while the page is open.
  setInterval(() => {
    refreshStatus();
    loadFacets();
  }, 60_000);
}

start();
