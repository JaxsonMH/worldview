// Worldview Globe: the "My News" layer. Articles from the news service are
// pinned where they happened, coloured by topic. A story with several places
// gets one pin per place; clicking it draws a line joining them in the order
// the story mentions them. Stories only placed at country level go in a
// per-country marker.
// The layer uses the same filter object as the Reader (../newsFilter.js).

import * as Cesium from 'cesium';
import {
  cleanFilter,
  describeFilter,
  filterFromHash,
  filterToHash,
  toQuery,
} from '../newsFilter.js';
import { newsApi } from '../newsApi.js';
import { h, timeAgo } from '../ui.js';

const MAX_ARTICLES = 1000;
const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_FILTER = { last_hours: 24 };
const TIME_CHOICES = [
  [6, '6h'],
  [24, '24h'],
  [168, '7 days'],
  [720, '30 days'],
];
// Broad "where" topics; a pin is coloured by a subject topic when it has one.
const BROAD_TOPICS = new Set(['Canada', 'World', 'Local']);

export function createMyNews({ viewer, card }) {
  const pins = new Cesium.CustomDataSource('worldview-my-news');
  const lines = new Cesium.CustomDataSource('worldview-my-news-lines');
  pins.clustering.enabled = true;
  pins.clustering.pixelRange = 28;
  pins.clustering.minimumClusterSize = 3;
  pins.clustering.clusterEvent.addEventListener((entities, cluster) => {
    cluster.label.show = true;
    cluster.label.text = String(entities.length);
    cluster.label.font = '600 13px system-ui, sans-serif';
    cluster.label.fillColor = Cesium.Color.WHITE;
    cluster.label.horizontalOrigin = Cesium.HorizontalOrigin.CENTER;
    cluster.label.verticalOrigin = Cesium.VerticalOrigin.CENTER;
    cluster.label.disableDepthTestDistance = Number.POSITIVE_INFINITY;
    cluster.billboard.show = false;
    cluster.point.show = true;
    cluster.point.pixelSize = Math.min(18 + Math.sqrt(entities.length) * 3, 44);
    cluster.point.color =
      Cesium.Color.fromCssColorString('#0b6e99').withAlpha(0.85);
    cluster.point.outlineColor = Cesium.Color.WHITE;
    cluster.point.outlineWidth = 2;
    cluster.point.disableDepthTestDistance = Number.POSITIVE_INFINITY;
  });
  viewer.dataSources.add(lines);
  viewer.dataSources.add(pins);
  pins.show = lines.show = false;

  const state = {
    enabled: false,
    filter: { ...DEFAULT_FILTER },
    articles: new Map(), // id -> article
    shown: 0,
    unplaced: 0,
    total: 0,
    loading: false,
    error: null,
    loadedAt: null,
    topics: [],
  };
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());
  let timer = null;

  newsApi
    .topics()
    .then((t) => {
      state.topics = t;
      if (state.enabled) draw();
    })
    .catch(() => {});

  const topicColor = (name) =>
    state.topics.find((t) => t.name === name)?.color ?? '#7a7a7a';
  function articleColor(a) {
    const subject =
      a.topics.find((t) => !BROAD_TOPICS.has(t.topic)) ?? a.topics[0];
    return topicColor(subject?.topic);
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
      const keep = [...state.articles.values()].filter((a) => a.pinnedByLink);
      state.articles = new Map(data.articles.map((a) => [a.id, a]));
      for (const a of keep)
        if (!state.articles.has(a.id)) state.articles.set(a.id, a);
      state.total = data.total;
      state.loadedAt = new Date().toISOString();
      draw();
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      changed();
    }
  }

  function draw() {
    pins.entities.suspendEvents();
    pins.entities.removeAll();
    const byCountry = new Map();
    let shown = 0;
    for (const a of state.articles.values()) {
      const color = Cesium.Color.fromCssColorString(articleColor(a));
      const fine = a.places.filter((p) => p.precision !== 'country');
      if (!fine.length) {
        const country = a.places.find((p) => p.precision === 'country');
        if (country) {
          const bucket = byCountry.get(country.country_code) ?? {
            place: country,
            articles: [],
          };
          bucket.articles.push(a);
          byCountry.set(country.country_code, bucket);
        }
        continue;
      }
      shown += 1;
      for (const p of fine) {
        pins.entities.add({
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
          point: {
            pixelSize: p.precision === 'region' ? 9 : 11,
            color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { worldviewArticle: a.id },
        });
      }
    }
    for (const [code, bucket] of byCountry) {
      pins.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          bucket.place.lon,
          bucket.place.lat,
        ),
        // Grey, and bigger the more stories it holds; click to list them.
        point: {
          pixelSize: Math.min(10 + Math.sqrt(bucket.articles.length) * 3, 30),
          color: Cesium.Color.fromCssColorString('#5f6b73').withAlpha(0.85),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { worldviewCountry: code },
      });
    }
    state.countryBuckets = byCountry;
    state.shown = shown;
    state.unplaced = [...byCountry.values()].reduce(
      (n, b) => n + b.articles.length,
      0,
    );
    pins.entities.resumeEvents();
    if (selectedId && state.articles.has(selectedId))
      drawRoute(state.articles.get(selectedId));
    viewer.scene.requestRender();
  }

  let selectedId = null;
  /** Join a story's places with a line, in the order the story mentions them. */
  function drawRoute(a) {
    lines.entities.removeAll();
    const fine = a ? a.places.filter((p) => p.precision !== 'country') : [];
    // The selected story's places get their own markers, never hidden in a cluster.
    fine.forEach((p, i) => {
      lines.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: {
          pixelSize: 14,
          color: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString(articleColor(a)),
          outlineWidth: 4,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { worldviewArticle: a.id },
      });
    });
    if (fine.length > 1) {
      lines.entities.add({
        polyline: {
          positions: fine.map((p) =>
            Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
          ),
          width: 3,
          arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(articleColor(a)),
            dashLength: 14,
          }),
        },
      });
    }
    viewer.scene.requestRender();
  }

  function showArticle(a) {
    // Open the card first: opening it closes the previous story's line.
    card.showArticle(a, { topicColor, onClose: clearSelection });
    selectedId = a.id;
    drawRoute(a);
  }

  function clearSelection() {
    selectedId = null;
    drawRoute(null);
  }

  function flyToArticle(a) {
    const fine = a.places.filter((p) => p.precision !== 'country');
    const targets = fine.length ? fine : a.places;
    if (!targets.length) return false;
    if (targets.length === 1) {
      const p = targets[0];
      const height =
        p.precision === 'country'
          ? 3_500_000
          : p.precision === 'region'
            ? 900_000
            : 40_000;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, height),
        duration: 1.8,
      });
    } else {
      const rect = Cesium.Rectangle.fromCartographicArray(
        targets.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat)),
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
    if (!state.enabled || !picked) return false;
    // A cluster of pins: list its articles.
    if (Array.isArray(picked.id)) {
      const ids = new Set();
      for (const entity of picked.id) {
        const id = entity.properties?.worldviewArticle?.getValue();
        if (id) ids.add(id);
        const code = entity.properties?.worldviewCountry?.getValue();
        if (code)
          for (const a of state.countryBuckets.get(code)?.articles ?? [])
            ids.add(a.id);
      }
      if (!ids.size) return false;
      const list = [...ids].map((id) => state.articles.get(id)).filter(Boolean);
      card.showArticleList(`${list.length} stories here`, list, {
        onPick: showArticle,
      });
      return true;
    }
    const entity = picked.id;
    if (!(entity instanceof Cesium.Entity)) return false;
    const articleId = entity.properties?.worldviewArticle?.getValue();
    if (articleId) {
      showArticle(state.articles.get(articleId));
      return true;
    }
    const code = entity.properties?.worldviewCountry?.getValue();
    if (code) {
      const bucket = state.countryBuckets.get(code);
      card.showArticleList(
        `${bucket.place.name}: stories without a town`,
        bucket.articles,
        { onPick: showArticle },
      );
      return true;
    }
    return false;
  }

  async function setEnabled(on) {
    state.enabled = on;
    pins.show = lines.show = on;
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
      draw();
    }
    showArticle(article);
    flyToArticle(article);
    changed();
  }

  function status() {
    if (state.error)
      return { text: `News service unavailable: ${state.error}`, kind: 'bad' };
    if (state.loading && !state.loadedAt) return { text: 'Loading…' };
    const parts = [`${state.shown.toLocaleString()} stories on the map`];
    if (state.unplaced) parts.push(`${state.unplaced} by country only`);
    if (state.total > MAX_ARTICLES)
      parts.push(`newest ${MAX_ARTICLES} of ${state.total.toLocaleString()}`);
    if (state.loadedAt) parts.push(`updated ${timeAgo(state.loadedAt)}`);
    return { text: parts.join(' · ') };
  }

  /** Extra controls under the My News switch: time window, active filters, legend. */
  function controls() {
    const f = state.filter;
    const extra = describeFilter({ ...f, last_hours: undefined });
    const present = new Set();
    for (const a of state.articles.values()) {
      const subject =
        a.topics.find((t) => !BROAD_TOPICS.has(t.topic)) ?? a.topics[0];
      if (subject) present.add(subject.topic);
    }
    return h(
      'div.wv-news-controls',
      {},
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
            { 'aria-label': 'Pin colours' },
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
    setEnabled,
    handlePick,
    followLink,
    status,
    controls,
    onChange: (fn) => listeners.add(fn),
  };
}
