// Worldview Globe: layers for Worldview's own live sources (BC wildfires,
// weather alerts, road events, world events, volcanoes, …), served by the news
// service at /api/news/sources/<id>/events in one shared format:
//   {id, title, summary, lat, lon, time, severity 0-3, url, geometry?, extra}
//
// Each layer draws its events, refreshes on the source's own schedule while
// switched on, and opens a card on click with "Related news" (stories near the
// same spot in the same few days) and the Live view.

import * as Cesium from 'cesium';
import { newsApi } from '../newsApi.js';
import { fullTime, h, timeAgo } from '../ui.js';
import { iconBadge, SEVERITY_COLORS, SEVERITY_NAMES } from './badges.js';

const RELATED_KM = 75;
const RELATED_HOURS = 96;
const FUEL_COLORS = {
  Coal: '#6c757d',
  Gas: '#f4a261',
  Oil: '#8d6e63',
  Nuclear: '#9b5de5',
  Hydro: '#4cc9f0',
  Wind: '#90e0ef',
  Solar: '#ffd166',
  Biomass: '#80b918',
  Geothermal: '#e76f51',
  Waste: '#adb5bd',
};

export function createSourceLayer(
  entry,
  meta,
  { viewer, card, onExplore, topicColor },
) {
  const ds = new Cesium.CustomDataSource(`worldview-src-${entry.source}`);
  ds.show = false;
  viewer.dataSources.add(ds);
  const state = {
    enabled: false,
    events: new Map(),
    fetchedAt: null,
    error: null,
    loading: false,
    meta,
    selected: null,
  };
  let timer = null;
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());

  async function load() {
    state.loading = true;
    changed();
    try {
      const res = await fetch(`/api/news/sources/${entry.source}/events`).then(
        (r) => {
          if (!r.ok) throw new Error(`news service answered ${r.status}`);
          return r.json();
        },
      );
      state.meta = { ...state.meta, ...res };
      state.events = new Map(res.events.map((e) => [e.id, e]));
      state.fetchedAt = res.fetched_at;
      state.error = res.error;
      draw();
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      changed();
    }
  }

  function draw() {
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    const style = entry.style ?? 'icon';
    for (const e of state.events.values()) {
      const position = Cesium.Cartesian3.fromDegrees(e.lon, e.lat);
      const properties = { worldviewEvent: e.id };
      if (style === 'aurora') {
        const chance = e.extra?.chance ?? 10;
        ds.entities.add({
          position,
          point: {
            pixelSize: 6 + chance / 6,
            color: Cesium.Color.fromCssColorString(
              chance >= 50 ? '#b5ffb0' : '#4ade80',
            ).withAlpha(0.15 + chance / 180),
            scaleByDistance: new Cesium.NearFarScalar(2e6, 1.6, 2e7, 0.7),
          },
          properties,
        });
        continue;
      }
      if (style === 'dots') {
        const color = e.extra?.fuel
          ? (FUEL_COLORS[e.extra.fuel] ?? '#ced4da')
          : SEVERITY_COLORS[e.severity];
        const mw = e.extra?.capacity_mw;
        ds.entities.add({
          position,
          point: {
            pixelSize: mw ? Math.min(4 + Math.sqrt(mw) / 6, 14) : 8,
            color: Cesium.Color.fromCssColorString(color).withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1e5, 1.4, 1.5e7, 0.6),
          },
          properties,
        });
        continue;
      }
      const { image, size } = iconBadge(
        meta.icon ?? entry.icon,
        e.severity ?? 0,
        { selected: state.selected === e.id },
      );
      ds.entities.add({
        position,
        billboard: {
          image,
          width: size,
          height: size,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties,
      });
      // Alert areas and affected roads.
      const g = e.geometry;
      const color = Cesium.Color.fromCssColorString(
        SEVERITY_COLORS[e.severity ?? 0],
      );
      if (g?.type === 'Polygon' || g?.type === 'MultiPolygon') {
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const poly of polys) {
          ds.entities.add({
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(poly[0].flat()),
              material: color.withAlpha(0.12),
              outline: false,
              height: 0,
            },
            properties,
          });
          ds.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(poly[0].flat()),
              width: 1.5,
              material: color.withAlpha(0.8),
              clampToGround: false,
            },
            properties,
          });
        }
      } else if (g?.type === 'LineString' || g?.type === 'MultiLineString') {
        const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
        for (const line of lines) {
          ds.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(line.flat()),
              width: 4,
              material: color.withAlpha(0.9),
            },
            properties,
          });
        }
      }
    }
    ds.entities.resumeEvents();
    viewer.scene.requestRender();
  }

  async function setEnabled(on) {
    state.enabled = on;
    ds.show = on;
    clearInterval(timer);
    if (on) {
      const minutes = Math.max(state.meta?.refresh_minutes ?? 15, 2);
      timer = setInterval(load, minutes * 60_000);
      await load();
    } else changed();
    viewer.scene.requestRender();
  }

  function status() {
    if (state.meta && state.meta.configured === false)
      return {
        text: `Needs a free key (${state.meta.needs_key.join(', ')}): see docs/worldview/ADDING-A-KEY.md`,
        kind: 'warn',
      };
    if (state.loading && !state.fetchedAt) return { text: 'Loading…' };
    if (state.error && !state.events.size)
      return { text: 'Unavailable right now', kind: 'bad', title: state.error };
    const parts = [`${state.events.size.toLocaleString()} shown`];
    if (state.fetchedAt) parts.push(`updated ${timeAgo(state.fetchedAt)}`);
    if (state.error)
      return {
        text: [...parts, 'last refresh failed'].join(' · '),
        kind: 'warn',
        title: state.error,
      };
    return { text: parts.join(' · ') };
  }

  async function showEvent(e) {
    state.selected = e.id;
    if ((entry.style ?? 'icon') === 'icon') draw();
    const related = h(
      'div.wv-related',
      {},
      h('p.wv-hint', 'Looking for related news…'),
    );
    card.showCustom(
      [
        h('p.wv-card-kicker', `${meta.icon ?? entry.icon} ${meta.name}`),
        h(
          'h2',
          {},
          e.url
            ? h(
                'a',
                { href: e.url, target: '_blank', rel: 'noopener noreferrer' },
                e.title,
              )
            : e.title,
        ),
        h(
          'p.wv-card-meta',
          {},
          h(
            'span.wv-sev',
            { style: { '--c': SEVERITY_COLORS[e.severity ?? 0] } },
            SEVERITY_NAMES[e.severity ?? 0],
          ),
          e.time
            ? h(
                'time',
                { datetime: e.time, title: fullTime(e.time) },
                ` · ${timeAgo(e.time)}`,
              )
            : null,
          e.extra?.expires ? ` · until ${fullTime(e.extra.expires)}` : null,
        ),
        e.summary
          ? h(
              'p.wv-card-text',
              e.summary.length > 500
                ? `${e.summary.slice(0, 500)}…`
                : e.summary,
            )
          : null,
        h(
          'div.wv-actions',
          {},
          e.url
            ? h(
                'a.wv-btn',
                { href: e.url, target: '_blank', rel: 'noopener noreferrer' },
                'Source ↗',
              )
            : null,
          onExplore
            ? h(
                'button.wv-btn.wv-btn-ghost',
                {
                  type: 'button',
                  onclick: () =>
                    onExplore({ lat: e.lat, lon: e.lon, kind: 'point' }),
                },
                '📡 Live view here',
              )
            : null,
        ),
        h(
          'h3',
          `Related news · within ${RELATED_KM} km, last ${RELATED_HOURS / 24} days`,
        ),
        related,
        h('p.wv-live-source', `${meta.attribution ?? ''}`),
      ],
      () => {
        state.selected = null;
        if ((entry.style ?? 'icon') === 'icon') draw();
      },
    );
    const news = await newsApi
      .search({
        near: { lat: e.lat, lon: e.lon, km: RELATED_KM },
        last_hours: RELATED_HOURS,
        limit: 8,
      })
      .catch(() => null);
    related.replaceChildren(
      news?.articles?.length
        ? h(
            'ul.wv-card-list',
            {},
            news.articles.map((a) =>
              h(
                'li',
                {},
                h(
                  'a.wv-related-link',
                  { href: `/reader.html#article=${a.id}` },
                  h('span.wv-dot', {
                    style: {
                      background: topicColor(
                        a.topics.find(
                          (t) =>
                            !['Canada', 'World', 'Local'].includes(t.topic),
                        )?.topic ?? a.topics[0]?.topic,
                      ),
                    },
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
          )
        : h('p.wv-hint', 'No stories from your feeds near here in that time.'),
    );
  }

  function handlePick(picked) {
    const entity = picked?.id;
    if (!(entity instanceof Cesium.Entity) || !ds.entities.contains(entity))
      return false;
    const e = state.events.get(entity.properties?.worldviewEvent?.getValue());
    if (e) showEvent(e);
    return Boolean(e);
  }

  return {
    id: entry.id,
    get enabled() {
      return state.enabled;
    },
    get count() {
      return state.events.size;
    },
    dataSource: ds,
    setEnabled,
    status,
    handlePick,
    showEvent,
    onChange: (fn) => listeners.add(fn),
  };
}
