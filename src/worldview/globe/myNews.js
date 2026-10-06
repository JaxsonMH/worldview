// Worldview Globe: the "My News" layer.
//
// Stories are grouped into markers by country, province/state or place,
// depending on how far you're zoomed out (or a level you pick). Each marker's
// ring shows the topic mix of its stories, with the count in the middle.
// Click a marker to list its stories and draw glowing lines to the other
// places those stories mention, at the same level. Click a story to see its
// own places, numbered in the order it mentions them.
//
// The layer uses the same filter object as the Reader (../newsFilter.js);
// grouping rules live in ../newsLevels.js.

import * as Cesium from 'cesium';
import {
  cleanFilter,
  describeFilter,
  filterFromHash,
  filterToHash,
  toQuery,
} from '../newsFilter.js';
import { newsApi } from '../newsApi.js';
import {
  aggregate,
  collapsePlaces,
  LEVEL_NAMES,
  levelForHeight,
  linksOf,
  unitsForArticle,
} from '../newsLevels.js';
import { h, timeAgo } from '../ui.js';
import { badge } from './badges.js';

const MAX_ARTICLES = 1500;
const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_FILTER = { last_hours: 24 };
const TIME_CHOICES = [
  [6, '6h'],
  [24, '24h'],
  [168, '7 days'],
  [720, '30 days'],
];
const LEVEL_CHOICES = [
  ['auto', 'Auto'],
  ['country', 'Countries'],
  ['region', 'Provinces'],
  ['place', 'Places'],
];
// Broad "where" topics; colours come from a subject topic when there is one.
const BROAD_TOPICS = new Set(['Canada', 'World', 'Local']);
const LINK_COLOR = Cesium.Color.fromCssColorString('#ffd166');

export function createMyNews({ viewer, card, onExplore }) {
  const markers = new Cesium.CustomDataSource('worldview-my-news');
  const overlay = new Cesium.CustomDataSource('worldview-my-news-overlay'); // lines + selected route
  viewer.dataSources.add(overlay);
  viewer.dataSources.add(markers);
  markers.show = overlay.show = false;

  const state = {
    enabled: false,
    filter: { ...DEFAULT_FILTER },
    articles: new Map(),
    total: 0,
    loading: false,
    error: null,
    loadedAt: null,
    topics: [],
    anchors: { countries: {}, regions: {} },
    levelChoice: 'auto',
    level: 'country',
    groups: { units: new Map(), links: new Map() },
    selectedUnit: null,
    selectedArticle: null,
    showAllLinks: false,
  };
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());
  let timer = null;

  newsApi
    .topics()
    .then((t) => {
      state.topics = t;
      if (state.enabled) regroup();
    })
    .catch(() => {});
  newsApi
    .anchors()
    .then((a) => {
      state.anchors = a;
      if (state.enabled) regroup();
    })
    .catch(() => {});

  const topicColor = (name) =>
    state.topics.find((t) => t.name === name)?.color ?? '#8a8f98';
  const subjectOf = (a) =>
    (a.topics.find((t) => !BROAD_TOPICS.has(t.topic)) ?? a.topics[0])?.topic;

  /** [color, share] pairs for a set of stories, biggest first, max 5 slices. */
  function topicMix(articles) {
    const counts = new Map();
    for (const a of articles) {
      const t = subjectOf(a) ?? 'Other';
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((x, y) => y[1] - x[1]);
    const top = sorted.slice(0, 4);
    const rest = sorted.slice(4).reduce((n, [, c]) => n + c, 0);
    if (rest) top.push(['Other', rest]);
    return top.map(([t, c]) => [topicColor(t), c / articles.length]);
  }

  function currentLevel() {
    if (state.levelChoice !== 'auto') return state.levelChoice;
    return levelForHeight(viewer.camera.positionCartographic.height);
  }

  async function load() {
    state.loading = true;
    state.error = null;
    changed();
    try {
      const data = await newsApi.search(
        toQuery(
          { ...state.filter, has_location: true },
          { limit: MAX_ARTICLES },
        ),
      );
      const linked = [...state.articles.values()].filter((a) => a.pinnedByLink);
      state.articles = new Map(data.articles.map((a) => [a.id, a]));
      for (const a of linked)
        if (!state.articles.has(a.id)) state.articles.set(a.id, a);
      state.total = data.total;
      state.loadedAt = new Date().toISOString();
      regroup();
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      changed();
    }
  }

  /** Group stories at the current level and redraw markers (and the selection). */
  function regroup() {
    state.level = currentLevel();
    state.groups = aggregate(
      [...state.articles.values()],
      state.level,
      state.anchors,
    );
    if (state.selectedUnit && !state.groups.units.has(state.selectedUnit))
      state.selectedUnit = null;
    drawMarkers();
    drawOverlay();
    changed();
  }

  function drawMarkers() {
    markers.entities.suspendEvents();
    markers.entities.removeAll();
    // Biggest first, so small markers are drawn on top and stay clickable.
    const units = [...state.groups.units.values()].sort(
      (a, b) => b.articles.length - a.articles.length,
    );
    for (const unit of units) {
      const selected = unit.key === state.selectedUnit;
      const { image, size } = badge({
        count: unit.articles.length,
        mix: topicMix(unit.articles),
        kind: unit.kind,
        selected,
      });
      markers.entities.add({
        position: Cesium.Cartesian3.fromDegrees(unit.lon, unit.lat),
        billboard: {
          image,
          width: size,
          height: size,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { worldviewUnit: unit.key },
      });
    }
    markers.entities.resumeEvents();
    viewer.scene.requestRender();
  }

  function addLink(from, to, count, emphasis = 1) {
    overlay.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(from.lon, from.lat),
          Cesium.Cartesian3.fromDegrees(to.lon, to.lat),
        ],
        width: (2 + Math.log2(count + 1) * 2) * emphasis,
        arcType: Cesium.ArcType.GEODESIC,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: LINK_COLOR.withAlpha(0.35 + 0.5 * emphasis),
          glowPower: 0.25,
        }),
      },
    });
  }

  /** Connection lines for the selected marker (or all, faintly), and the selected story's route. */
  function drawOverlay() {
    overlay.entities.removeAll();
    const { units, links } = state.groups;
    if (state.showAllLinks) {
      for (const link of links.values()) {
        const a = units.get(link.a);
        const b = units.get(link.b);
        if (a && b) addLink(a, b, link.articles.length, 0.35);
      }
    }
    if (state.selectedUnit && !state.selectedArticle) {
      const from = units.get(state.selectedUnit);
      for (const link of linksOf(links, state.selectedUnit)) {
        const to = units.get(link.a === state.selectedUnit ? link.b : link.a);
        if (from && to) addLink(from, to, link.articles.length);
      }
    }
    if (state.selectedArticle) {
      const stops = unitsForArticle(
        state.selectedArticle.places,
        'place',
        state.anchors,
      );
      for (let i = 1; i < stops.length; i++) addLink(stops[i - 1], stops[i], 1);
      stops.forEach((stop, i) => {
        const { image, size } = badge({
          count: 1,
          mix: [[topicColor(subjectOf(state.selectedArticle)), 1]],
          kind: stop.kind,
          selected: true,
          text: stops.length > 1 ? String(i + 1) : '',
        });
        overlay.entities.add({
          position: Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat),
          billboard: {
            image,
            width: size,
            height: size,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { worldviewArticle: state.selectedArticle.id },
        });
      });
    }
    viewer.scene.requestRender();
  }

  // ---------- cards ----------

  function showUnit(key) {
    const unit = state.groups.units.get(key);
    if (!unit) return;
    state.selectedUnit = key;
    state.selectedArticle = null;
    drawMarkers();
    drawOverlay();
    const connections = linksOf(state.groups.links, key).slice(0, 8);
    const stories = [...unit.articles].sort((a, b) =>
      b.published_at.localeCompare(a.published_at),
    );
    const mix = new Map();
    for (const a of stories) {
      const t = subjectOf(a) ?? 'Other';
      mix.set(t, (mix.get(t) ?? 0) + 1);
    }
    const kindName = {
      country: 'Country',
      region: 'Province / state',
      place: 'Place',
    }[unit.kind];
    card.showCustom(
      [
        h(
          'p.wv-card-kicker',
          `${kindName} · ${stories.length} ${stories.length === 1 ? 'story' : 'stories'}`,
        ),
        h('h2', unit.name),
        h(
          'div.wv-mixbar',
          { 'aria-label': 'Topics' },
          [...mix.entries()]
            .sort((x, y) => y[1] - x[1])
            .map(([t, n]) =>
              h('span', {
                style: { flex: n, background: topicColor(t) },
                title: `${t}: ${n}`,
              }),
            ),
        ),
        h(
          'div.wv-card-tags',
          {},
          [...mix.entries()]
            .sort((x, y) => y[1] - x[1])
            .slice(0, 6)
            .map(([t, n]) =>
              h(
                'span.wv-tag',
                { style: { '--c': topicColor(t) } },
                `${t} ${n}`,
              ),
            ),
        ),
        connections.length
          ? h(
              'div.wv-connections',
              {},
              h('h3', 'Also in these stories'),
              connections.map((link) => {
                const other = state.groups.units.get(
                  link.a === key ? link.b : link.a,
                );
                return other
                  ? h(
                      'button.wv-chip',
                      { type: 'button', onclick: () => flyToUnit(other.key) },
                      `${other.name} · ${link.articles.length}`,
                    )
                  : null;
              }),
            )
          : null,
        h(
          'div.wv-actions',
          {},
          onExplore
            ? h(
                'button.wv-btn',
                {
                  type: 'button',
                  onclick: () =>
                    onExplore({
                      lat: unit.lat,
                      lon: unit.lon,
                      name: unit.name,
                      kind: unit.kind,
                    }),
                },
                '📡 Live view here',
              )
            : null,
          h(
            'a.wv-btn.wv-btn-ghost',
            { href: `/reader.html${readerHashFor(unit)}` },
            'Open in Reader',
          ),
        ),
        h(
          'ul.wv-card-list',
          {},
          stories.slice(0, 60).map((a) =>
            h(
              'li',
              {},
              h(
                'button',
                { type: 'button', onclick: () => showArticle(a) },
                h('span.wv-dot', {
                  style: { background: topicColor(subjectOf(a)) },
                }),
                h(
                  'span',
                  {},
                  a.title,
                  h('small', `${a.feed_title} · ${timeAgo(a.published_at)}`),
                ),
              ),
            ),
          ),
        ),
        stories.length > 60
          ? h('p.wv-hint', `…and ${stories.length - 60} more in the Reader.`)
          : null,
      ],
      clearSelection,
    );
  }

  function readerHashFor(unit) {
    const f = { ...state.filter };
    if (unit.kind === 'country') f.country = unit.cc;
    else if (unit.kind === 'region')
      Object.assign(f, { country: unit.cc, admin1: unit.admin1 });
    else f.near = { lat: unit.lat, lon: unit.lon, km: 15, label: unit.name };
    return filterToHash(f);
  }

  function flyToUnit(key) {
    const unit = state.groups.units.get(key);
    if (!unit) return;
    const height = { country: 7_000_000, region: 2_500_000, place: 300_000 }[
      unit.kind
    ];
    // Keep the level while flying, so the marker we fly to still exists on arrival.
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        unit.lon,
        unit.lat,
        Math.max(height, viewer.camera.positionCartographic.height * 0.6),
      ),
      duration: 1.4,
      complete: () => showUnit(key),
    });
  }

  function showArticle(a) {
    card.showArticle(a, {
      topicColor,
      onClose: clearSelection,
      onExplore: onExplore
        ? () => {
            const first = collapsePlaces(a.places)[0];
            if (first)
              onExplore({
                lat: first.lat,
                lon: first.lon,
                name: first.name,
                kind: 'place',
              });
          }
        : null,
    });
    state.selectedArticle = a;
    drawOverlay();
  }

  function clearSelection() {
    const had = state.selectedUnit || state.selectedArticle;
    state.selectedUnit = null;
    state.selectedArticle = null;
    if (had) {
      drawMarkers();
      drawOverlay();
    }
  }

  function flyToArticle(a) {
    const stops = unitsForArticle(a.places, 'place', state.anchors);
    if (!stops.length) return false;
    if (stops.length === 1) {
      const s = stops[0];
      const height =
        s.kind === 'country'
          ? 4_000_000
          : s.kind === 'region'
            ? 1_200_000
            : 60_000;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, height),
        duration: 1.8,
      });
    } else {
      const rect = Cesium.Rectangle.fromCartographicArray(
        stops.map((s) => Cesium.Cartographic.fromDegrees(s.lon, s.lat)),
      );
      const pad = Math.max(rect.width, rect.height) * 0.4 + 0.01;
      viewer.camera.flyTo({
        destination: new Cesium.Rectangle(
          rect.west - pad,
          rect.south - pad,
          rect.east + pad,
          rect.north + pad,
        ),
        duration: 1.8,
      });
    }
    return true;
  }

  /** Clicks on the globe: returns true when the click was on My News. */
  function handlePick(picked) {
    if (!state.enabled || !(picked?.id instanceof Cesium.Entity)) return false;
    const props = picked.id.properties;
    const unitKey = props?.worldviewUnit?.getValue();
    if (unitKey) {
      showUnit(unitKey);
      return true;
    }
    const articleId = props?.worldviewArticle?.getValue();
    if (articleId && state.selectedArticle?.id === articleId) return true;
    return false;
  }

  // Regroup when the zoom crosses a level boundary.
  viewer.camera.moveEnd.addEventListener(() => {
    if (
      state.enabled &&
      state.levelChoice === 'auto' &&
      currentLevel() !== state.level
    )
      regroup();
  });

  async function setEnabled(on) {
    state.enabled = on;
    markers.show = overlay.show = on;
    clearInterval(timer);
    if (on) {
      timer = setInterval(load, REFRESH_MS);
      await load();
    } else {
      changed();
    }
    viewer.scene.requestRender();
  }

  function setFilter(next) {
    state.filter = cleanFilter(next);
    const hash = filterToHash(state.filter);
    history.replaceState(null, '', hash || location.pathname);
    if (state.enabled) load();
    else changed();
  }

  /** "Show on globe" links: #article=ID plus the Reader's filter. */
  async function followLink(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const filter = filterFromHash(hash);
    const hasFilter = Object.keys(filter).length > 0;
    if (hasFilter) state.filter = filter;
    const articleId = Number(params.get('article'));
    if (!articleId) {
      if (hasFilter && state.enabled) await load();
      return;
    }
    if (!state.enabled) await setEnabled(true);
    else if (hasFilter) await load();
    const article =
      state.articles.get(articleId) ??
      (await newsApi.article(articleId).catch(() => null));
    if (!article) return;
    article.pinnedByLink = true;
    if (!state.articles.has(article.id)) {
      state.articles.set(article.id, article);
      regroup();
    }
    flyToArticle(article);
    showArticle(article);
    changed();
  }

  function status() {
    if (state.error)
      return { text: `News service unavailable: ${state.error}`, kind: 'bad' };
    if (state.loading && !state.loadedAt) return { text: 'Loading…' };
    const parts = [`${state.articles.size.toLocaleString()} stories`];
    if (state.total > MAX_ARTICLES)
      parts.push(`newest ${MAX_ARTICLES} of ${state.total.toLocaleString()}`);
    if (state.loadedAt) parts.push(`updated ${timeAgo(state.loadedAt)}`);
    return { text: parts.join(' · ') };
  }

  /** Extra controls under the My News switch. */
  function controls() {
    const f = state.filter;
    const extra = describeFilter({ ...f, last_hours: undefined });
    const present = new Set(
      [...state.articles.values()].map(subjectOf).filter(Boolean),
    );
    return h(
      'div.wv-news-controls',
      {},
      h('span.wv-mini-label', 'When'),
      h(
        'div.wv-chips',
        { role: 'group', 'aria-label': 'Time window' },
        TIME_CHOICES.map(([hours, label]) =>
          h(
            'button.wv-chip' + (f.last_hours === hours ? '.is-active' : ''),
            {
              type: 'button',
              onclick: () =>
                setFilter({
                  ...f,
                  last_hours: hours,
                  since: undefined,
                  until: undefined,
                }),
            },
            label,
          ),
        ),
      ),
      h(
        'span.wv-mini-label',
        `Group by · now showing ${LEVEL_NAMES[state.level]}`,
      ),
      h(
        'div.wv-chips',
        { role: 'group', 'aria-label': 'Group stories by' },
        LEVEL_CHOICES.map(([value, label]) =>
          h(
            'button.wv-chip' +
              (state.levelChoice === value ? '.is-active' : ''),
            {
              type: 'button',
              title:
                value === 'auto'
                  ? 'Follow the zoom: countries far out, provinces in between, places up close'
                  : undefined,
              onclick: () => {
                state.levelChoice = value;
                regroup();
              },
            },
            label,
          ),
        ),
      ),
      h(
        'label.wv-check',
        {},
        h('input', {
          type: 'checkbox',
          checked: state.showAllLinks,
          onchange: (e) => {
            state.showAllLinks = e.target.checked;
            drawOverlay();
          },
        }),
        'Show all connections',
      ),
      extra.length
        ? h(
            'p.wv-news-filter',
            {},
            'Filtered: ',
            extra.map((p) => p.label).join(' · '),
            ' ',
            h(
              'button.wv-link',
              {
                type: 'button',
                onclick: () => setFilter({ last_hours: f.last_hours ?? 24 }),
              },
              'Clear',
            ),
          )
        : null,
      h(
        'a.wv-link',
        { href: `/reader.html${filterToHash(f)}` },
        'Filter or search in the Reader →',
      ),
      present.size
        ? h(
            'ul.wv-legend',
            { 'aria-label': 'Ring colours' },
            state.topics
              .filter((t) => present.has(t.name))
              .map((t) =>
                h(
                  'li',
                  {},
                  h('span.wv-dot', { style: { background: t.color } }),
                  t.name,
                ),
              ),
          )
        : null,
    );
  }

  return {
    get enabled() {
      return state.enabled;
    },
    /** Stories near a point, for the live location view. */
    storiesNear(lat, lon, km) {
      const out = [];
      for (const a of state.articles.values()) {
        if (
          collapsePlaces(a.places).some(
            (p) =>
              p.precision !== 'country' &&
              distanceKm(lat, lon, p.lat, p.lon) <= km,
          )
        )
          out.push(a);
      }
      return out.sort((x, y) => y.published_at.localeCompare(x.published_at));
    },
    topicColor,
    colorOf: (a) => topicColor(subjectOf(a)),
    get count() {
      return state.articles.size;
    },
    /** Newest stories, for the headline ticker. */
    latest(n) {
      return [...state.articles.values()]
        .sort((x, y) => y.published_at.localeCompare(x.published_at))
        .slice(0, n);
    },
    /** Open a story from elsewhere (ticker, Live view): fly to it and show its card. */
    openArticle(a) {
      flyToArticle(a);
      showArticle(a);
    },
    showArticle,
    setEnabled,
    handlePick,
    followLink,
    status,
    controls,
    onChange: (fn) => listeners.add(fn),
  };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * toRad) / 2) ** 2 +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(((lon2 - lon1) * toRad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
