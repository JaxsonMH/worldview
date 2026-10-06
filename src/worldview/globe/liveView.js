// Worldview Globe: the Live view. Pick any spot and see everything being
// reported there right now: traffic cameras (live pictures), weather, news,
// earthquakes, fires, aircraft, ships, satellites, transit and road traffic.
//
// The data comes from the globe engine's "tools": ready-made questions such
// as "aircraft in this area" that each return a sentence plus structured rows.
// Each section shows its source and when it was fetched; anything unavailable
// (no free key yet, nothing covers this area) says so in plain English.

import * as Cesium from 'cesium';
import { composeCatalog, coreTools } from '../../tools/index.js';
import { createToolServices } from '../../tools/services.js';
import { newsApi } from '../newsApi.js';
import { fullTime, h, timeAgo } from '../ui.js';
import { SEVERITY_COLORS } from './badges.js';

const RADII = [5, 25, 100, 300];
const REFRESH_MS = 60_000;
const MAX_CAMERAS = 12;

let catalog;
function tools() {
  catalog ??= composeCatalog({
    tools: coreTools,
    services: createToolServices({
      fetchImpl: (...args) => globalThis.fetch(...args),
      appUrl: location.origin,
    }),
  });
  return catalog;
}

/** Plain-English reason a section has nothing to show. */
function explain(error) {
  const text = String(error?.message ?? error);
  if (/key/i.test(text))
    return {
      text: `${text}. See docs/worldview/ADDING-A-KEY.md.`,
      kind: 'warn',
    };
  if (/No supported|covers/i.test(text)) return { text, kind: 'muted' };
  return { text: `Unavailable right now (${text})`, kind: 'bad' };
}

const SECTIONS = [
  {
    id: 'cameras',
    icon: '📷',
    title: 'Live cameras',
    source: 'DriveBC and other public road cameras',
  },
  { id: 'weather', icon: '🌤️', title: 'Weather now', source: 'Open-Meteo' },
  {
    id: 'events',
    icon: '🚨',
    title: 'Alerts & events',
    source:
      'Wildfires, weather alerts, road events, disasters, volcanoes, tsunami, world events, outages',
  },
  { id: 'news', icon: '📰', title: 'News here', source: 'Your feeds' },
  { id: 'quakes', icon: '🌋', title: 'Earthquakes (24h)', source: 'USGS' },
  { id: 'fires', icon: '🔥', title: 'Active fires', source: 'NASA FIRMS' },
  { id: 'aircraft', icon: '✈️', title: 'Aircraft overhead', source: 'ADS-B' },
  { id: 'ships', icon: '🚢', title: 'Ships nearby', source: 'AISStream' },
  {
    id: 'satellites',
    icon: '🛰️',
    title: 'Satellites overhead',
    source: 'CelesTrak (bright satellites)',
  },
  {
    id: 'transit',
    icon: '🚌',
    title: 'Transit vehicles',
    source: 'GTFS-realtime',
  },
  { id: 'traffic', icon: '🚗', title: 'Road traffic', source: 'TomTom' },
];

export function createLiveView({ viewer, root, onOpenArticle, topicColor }) {
  const layer = new Cesium.CustomDataSource('worldview-live');
  viewer.dataSources.add(layer);
  const state = {
    spot: null,
    radius: 25,
    results: {},
    loadedAt: null,
    timer: null,
    run: 0,
  };
  const modal = document.createElement('div');
  modal.className = 'wv-modal';
  modal.hidden = true;
  document.body.append(modal);

  async function open(spot) {
    state.spot = { ...spot };
    state.radius =
      spot.radius ??
      (spot.kind === 'country' ? 300 : spot.kind === 'region' ? 100 : 25);
    root.hidden = false;
    document.body.classList.add('has-live');
    if (!spot.name) {
      const near = await newsApi
        .placeNearest(spot.lat, spot.lon)
        .catch(() => null);
      state.spot.name = near
        ? `${near.distance_km > 3 ? 'Near ' : ''}${near.name}`
        : `${spot.lat.toFixed(2)}, ${spot.lon.toFixed(2)}`;
      state.spot.region = near?.region;
    }
    refresh();
    clearInterval(state.timer);
    state.timer = setInterval(refresh, REFRESH_MS);
  }

  function close() {
    clearInterval(state.timer);
    state.spot = null;
    root.hidden = true;
    document.body.classList.remove('has-live');
    layer.entities.removeAll();
    viewer.scene.requestRender();
  }

  async function refresh() {
    if (!state.spot) return;
    const run = ++state.run;
    const { lat, lon } = state.spot;
    const r = state.radius;
    const area = { lat, lon, radius_km: r };
    const point = { lat, lon };
    const jobs = {
      cameras: () => tools().call('find_cctv_cameras', { area, limit: 60 }),
      weather: () => tools().call('get_weather', { location: point }),
      events: () => newsApi.nearby(lat, lon, Math.max(r, 50)),
      news: () =>
        newsApi.search({
          near: { lat, lon, km: Math.max(r, 10) },
          last_hours: 168,
          limit: 25,
        }),
      quakes: () =>
        tools().call('get_earthquakes', {
          area: { lat, lon, radius_km: Math.max(r, 300) },
          limit: 25,
        }),
      fires: () =>
        tools().call('get_active_fires', {
          area: { lat, lon, radius_km: Math.max(r, 100) },
          limit: 25,
        }),
      aircraft: () =>
        tools().call('aircraft_in_area', {
          area: { lat, lon, radius_km: Math.min(Math.max(r, 25), 250) },
          limit: 40,
        }),
      ships: () =>
        tools().call('vessels_in_area', {
          area: { lat, lon, radius_km: Math.max(r, 25) },
          limit: 25,
        }),
      satellites: () =>
        tools().call('satellites_overhead', {
          location: point,
          group: 'visual',
          limit: 15,
        }),
      transit: () => tools().call('get_transit_vehicles', { area, limit: 25 }),
      traffic: () =>
        tools().call('get_traffic_flow', {
          area: { lat, lon, radius_km: Math.min(r, 25) },
        }),
    };
    for (const id of Object.keys(jobs)) state.results[id] ??= { loading: true };
    render();
    await Promise.all(
      Object.entries(jobs).map(async ([id, job]) => {
        try {
          const value = await job();
          if (run === state.run)
            state.results[id] = { value, at: new Date().toISOString() };
        } catch (error) {
          if (run === state.run)
            state.results[id] = {
              error: explain(error),
              at: new Date().toISOString(),
            };
        }
        if (run === state.run) {
          render();
          drawMap();
        }
      }),
    );
    state.loadedAt = new Date().toISOString();
    render();
  }

  // ---------- globe markers ----------
  function drawMap() {
    layer.entities.removeAll();
    if (!state.spot) return;
    const { lat, lon } = state.spot;
    const centre = Cesium.Cartesian3.fromDegrees(lon, lat);
    layer.entities.add({
      position: centre,
      ellipse: {
        semiMajorAxis: state.radius * 1000,
        semiMinorAxis: state.radius * 1000,
        material: Cesium.Color.fromCssColorString('#ffd166').withAlpha(0.08),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#ffd166').withAlpha(0.9),
        outlineWidth: 2,
        height: 0,
      },
    });
    layer.entities.add({
      position: centre,
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#ffd166'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const dot = (row, color, size, props) =>
      layer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
        point: {
          pixelSize: size,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: props,
      });
    for (const row of rows('cameras'))
      dot(row, '#4cc9f0', 8, { worldviewCamera: row.id });
    for (const row of rows('quakes'))
      dot(row, '#ef476f', 6 + row.magnitude * 2, {
        worldviewLiveSection: 'quakes',
      });
    for (const row of rows('aircraft'))
      dot(row, '#e9ecef', 6, { worldviewLiveSection: 'aircraft' });
    for (const row of rows('fires'))
      dot(row, '#f77f00', 7, { worldviewLiveSection: 'fires' });
    for (const row of rows('ships'))
      dot(row, '#06d6a0', 7, { worldviewLiveSection: 'ships' });
    for (const group of state.results.events?.value?.sources ?? [])
      for (const e of group.events)
        dot(e, SEVERITY_COLORS[e.severity ?? 0], 9, {
          worldviewLiveSection: 'events',
        });
    viewer.scene.requestRender();
  }

  function rows(id) {
    return state.results[id]?.value?.data?.rows ?? [];
  }

  /** Clicks on Live view markers. Returns true when handled. */
  function handlePick(picked) {
    const entity = picked?.id;
    if (!(entity instanceof Cesium.Entity) || !layer.entities.contains(entity))
      return false;
    const camera = entity.properties?.worldviewCamera?.getValue();
    if (camera) openCamera(rows('cameras').findIndex((c) => c.id === camera));
    const section = entity.properties?.worldviewLiveSection?.getValue();
    if (section)
      root
        .querySelector(`[data-section="${section}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  // ---------- panel ----------
  function render() {
    if (!state.spot) return;
    const s = state.spot;
    root.replaceChildren(
      h(
        'header.wv-live-head',
        {},
        h('p.wv-live-kicker', '📡 Live view'),
        h('h2', s.name ?? 'This spot'),
        h(
          'p.wv-live-sub',
          [s.region, `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}`]
            .filter(Boolean)
            .join(' · '),
        ),
        h(
          'div.wv-chips',
          { role: 'group', 'aria-label': 'Radius' },
          RADII.map((km) =>
            h(
              'button.wv-chip' + (state.radius === km ? '.is-active' : ''),
              {
                type: 'button',
                onclick: () => (
                  (state.radius = km),
                  (state.results = {}),
                  refresh()
                ),
              },
              `${km} km`,
            ),
          ),
        ),
        h(
          'p.wv-live-sub',
          state.loadedAt
            ? `Refreshes every minute · last ${timeAgo(state.loadedAt)}`
            : 'Gathering live data…',
          ' ',
          h(
            'button.wv-link',
            { type: 'button', onclick: refresh },
            'Refresh now',
          ),
        ),
        h(
          'button.wv-card-close',
          { type: 'button', 'aria-label': 'Close live view', onclick: close },
          '×',
        ),
      ),
      h('div.wv-live-body', {}, SECTIONS.map(renderSection)),
    );
  }

  function renderSection(section) {
    const result = state.results[section.id] ?? { loading: true };
    const value = result.value;
    let count = null;
    let body;
    if (result.loading) body = h('p.wv-hint', 'Loading…');
    else if (result.error)
      body = h(`p.wv-live-msg.is-${result.error.kind}`, result.error.text);
    else ({ count, body } = SECTION_BODIES[section.id](value));
    if (
      result.error?.kind === 'muted' ||
      (count === 0 && section.id !== 'weather')
    ) {
      return h(
        'section.wv-live-section.is-empty',
        { 'data-section': section.id },
        h(
          'h3',
          {},
          h('span', section.icon),
          section.title,
          h(
            'span.wv-live-none',
            result.error ? 'not covered here' : 'none right now',
          ),
        ),
      );
    }
    return h(
      'section.wv-live-section',
      { 'data-section': section.id },
      h(
        'h3',
        {},
        h('span', section.icon),
        section.title,
        count ? h('span.wv-count', String(count)) : null,
      ),
      body,
      result.at
        ? h('p.wv-live-source', `${section.source} · ${timeAgo(result.at)}`)
        : null,
    );
  }

  const SECTION_BODIES = {
    cameras(value) {
      const cams = value.data.rows;
      return {
        count: value.data.total,
        body: h(
          'div.wv-cam-grid',
          {},
          cams.slice(0, MAX_CAMERAS).map((cam, i) => cameraTile(cam, i)),
          value.data.total > MAX_CAMERAS
            ? h(
                'p.wv-hint',
                `Nearest ${MAX_CAMERAS} of ${value.data.total}; shrink the radius or click camera dots on the globe.`,
              )
            : null,
        ),
      };
    },
    events(value) {
      const groups = value.sources.filter((g) => g.events.length);
      const total = groups.reduce((n, g) => n + g.total, 0);
      return {
        count: total,
        body: h(
          'div',
          {},
          groups.map((g) =>
            h(
              'div.wv-live-group',
              {},
              h(
                'h4',
                `${g.icon} ${g.name}`,
                g.total > g.events.length ? ` (${g.total})` : '',
              ),
              h(
                'ul.wv-live-list',
                {},
                g.events.slice(0, 5).map((e) =>
                  h(
                    'li',
                    {},
                    h(
                      e.url ? 'a.wv-live-link' : 'span',
                      e.url
                        ? {
                            href: e.url,
                            target: '_blank',
                            rel: 'noopener noreferrer',
                          }
                        : {},
                      h('span.wv-dot', {
                        style: {
                          background: SEVERITY_COLORS[e.severity ?? 0],
                        },
                      }),
                      ' ',
                      e.title,
                    ),
                    h(
                      'small',
                      [
                        e.time && timeAgo(e.time),
                        e.summary && e.summary.slice(0, 110),
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      };
    },
    weather(value) {
      const w = value.data.weather ?? {};
      return {
        count: null,
        body: h(
          'div.wv-weather',
          {},
          h(
            'span.wv-weather-temp',
            Number.isFinite(w.temperature_c)
              ? `${Math.round(w.temperature_c)}°`
              : '–',
          ),
          h(
            'span',
            {},
            h('strong', w.conditions ?? ''),
            h('br'),
            [
              Number.isFinite(w.feels_like_c) &&
                `feels ${Math.round(w.feels_like_c)}°`,
              Number.isFinite(w.wind_kph) &&
                `wind ${Math.round(w.wind_kph)} km/h`,
              Number.isFinite(w.precipitation_mm) &&
                w.precipitation_mm > 0 &&
                `${w.precipitation_mm} mm rain`,
              Number.isFinite(w.visibility_m) &&
                `visibility ${Math.round(w.visibility_m / 1000)} km`,
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
      };
    },
    news(value) {
      return {
        count: value.total,
        body: h(
          'ul.wv-card-list',
          {},
          value.articles.slice(0, 8).map((a) =>
            h(
              'li',
              {},
              h(
                'button',
                { type: 'button', onclick: () => onOpenArticle(a) },
                h('span.wv-dot', {
                  style: {
                    background: topicColor(
                      a.topics.find(
                        (t) => !['Canada', 'World', 'Local'].includes(t.topic),
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
        ),
      };
    },
    quakes(value) {
      return {
        count: value.data.total,
        body: list(value.data.rows, (q) => [
          `M${q.magnitude.toFixed(1)} · ${q.place}`,
          `${timeAgo(q.time)} · ${Math.round(q.depth_km)} km deep`,
        ]),
      };
    },
    fires(value) {
      return {
        count: value.data.total,
        body: list(value.data.rows, (f) => [
          `Fire detection ${f.confidence ? `(${f.confidence})` : ''}`,
          f.acquired_at ? timeAgo(f.acquired_at) : '',
        ]),
      };
    },
    aircraft(value) {
      const rows = value.data.rows;
      return {
        count: value.data.total,
        body: list(rows, (a) => [
          `${a.callsign?.trim() || a.id}${a.type_code ? ` · ${a.type_code}` : ''}`,
          [
            a.on_ground
              ? 'on the ground'
              : Number.isFinite(a.altitude_m) &&
                `${Math.round(a.altitude_m * 3.281).toLocaleString()} ft`,
            Number.isFinite(a.speed_mps) &&
              `${Math.round(a.speed_mps * 3.6)} km/h`,
            Number.isFinite(a.distance_km) &&
              `${a.distance_km.toFixed(0)} km away`,
            a.origin_country,
          ]
            .filter(Boolean)
            .join(' · '),
        ]),
      };
    },
    ships(value) {
      return {
        count: value.data.total,
        body: list(value.data.rows, (s) => [
          s.name || s.mmsi || 'Vessel',
          [
            s.type,
            Number.isFinite(s.speed_kn) && `${s.speed_kn} kn`,
            s.destination && `→ ${s.destination}`,
          ]
            .filter(Boolean)
            .join(' · '),
        ]),
      };
    },
    satellites(value) {
      return {
        count: value.data.total,
        body: list(value.data.rows, (s) => [
          s.name ?? s.id,
          [
            Number.isFinite(s.elevation_deg) &&
              `${Math.round(s.elevation_deg)}° up`,
            Number.isFinite(s.altitude_km) &&
              `${Math.round(s.altitude_km)} km high`,
          ]
            .filter(Boolean)
            .join(' · '),
        ]),
      };
    },
    transit(value) {
      return {
        count: value.data.total,
        body: list(value.data.rows, (v) => [
          `Route ${v.route ?? v.route_id ?? '?'}${v.label ? ` · ${v.label}` : ''}`,
          v.agency ?? '',
        ]),
      };
    },
    traffic(value) {
      return { count: null, body: h('p.wv-live-msg', value.summary) };
    },
  };

  function list(items, describe, max = 8) {
    return h(
      'ul.wv-live-list',
      {},
      items.slice(0, max).map((item) => {
        const [main, sub] = describe(item);
        return h('li', {}, h('span', main), sub ? h('small', sub) : null);
      }),
      items.length > max
        ? h('li.wv-hint', `…and ${items.length - max} more`)
        : null,
    );
  }

  // ---------- cameras ----------
  const frames = new Map(); // camera id -> {url, at}

  async function loadFrame(cam) {
    const result = await tools().call('get_cctv_snapshot', {
      camera_id: cam.id,
    });
    const image = result.images?.[0];
    if (!image) throw new Error('no picture');
    const frame = {
      url: `data:${image.mimeType};base64,${image.data}`,
      at: new Date().toISOString(),
    };
    frames.set(cam.id, frame);
    return frame;
  }

  function cameraTile(cam, index) {
    const img = h('img', { alt: cam.name, loading: 'lazy' });
    const caption = h(
      'figcaption',
      {},
      cam.name,
      h(
        'small',
        `${cam.provider ?? ''}${Number.isFinite(cam.distance_km) ? ` · ${cam.distance_km.toFixed(1)} km` : ''}`,
      ),
    );
    const tile = h(
      'figure.wv-cam',
      {
        tabindex: 0,
        role: 'button',
        onclick: () => openCamera(index),
        onkeydown: (e) => e.key === 'Enter' && openCamera(index),
      },
      img,
      caption,
    );
    const cached = frames.get(cam.id);
    if (cached && Date.now() - Date.parse(cached.at) < REFRESH_MS)
      img.src = cached.url;
    else {
      tile.classList.add('is-loading');
      loadFrame(cam)
        .then((f) => (img.src = f.url))
        .catch(() => tile.classList.add('is-broken'))
        .finally(() => tile.classList.remove('is-loading'));
    }
    return tile;
  }

  let modalTimer = null;
  function openCamera(index) {
    const cams = rows('cameras');
    if (index < 0 || !cams[index]) return;
    const cam = cams[index];
    const img = h('img', { alt: cam.name, src: frames.get(cam.id)?.url ?? '' });
    const stamp = h('span');
    const update = () =>
      loadFrame(cam)
        .then((f) => {
          img.src = f.url;
          stamp.textContent = `Picture fetched ${fullTime(f.at)}`;
        })
        .catch(
          () => (stamp.textContent = 'This camera has no picture right now.'),
        );
    modal.replaceChildren(
      h(
        'div.wv-modal-box',
        { role: 'dialog', 'aria-label': cam.name },
        h(
          'button.wv-card-close',
          { type: 'button', 'aria-label': 'Close', onclick: closeCamera },
          '×',
        ),
        h('h2', cam.name),
        h(
          'p.wv-live-sub',
          [cam.city, cam.provider, cam.credit].filter(Boolean).join(' · '),
        ),
        img,
        h(
          'div.wv-modal-foot',
          {},
          h(
            'button.wv-btn.wv-btn-ghost',
            {
              type: 'button',
              onclick: () =>
                openCamera((index - 1 + cams.length) % cams.length),
            },
            '← Previous',
          ),
          stamp,
          h(
            'button.wv-btn.wv-btn-ghost',
            {
              type: 'button',
              onclick: () => openCamera((index + 1) % cams.length),
            },
            'Next →',
          ),
        ),
      ),
    );
    modal.hidden = false;
    modal.onclick = (e) => e.target === modal && closeCamera();
    update();
    clearInterval(modalTimer);
    modalTimer = setInterval(update, 30_000);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 3000),
      duration: 1.2,
    });
  }

  function closeCamera() {
    clearInterval(modalTimer);
    modal.hidden = true;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modal.hidden) closeCamera();
      else if (state.spot) close();
    }
  });

  return {
    open,
    close,
    handlePick,
    get isOpen() {
      return Boolean(state.spot);
    },
  };
}
