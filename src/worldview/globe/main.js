// Worldview Globe: a clean interface over the God's Eye View globe engine.
// We reuse its globe, base maps and data layers (flights, quakes, weather…)
// but none of its interface; the layer list comes from config/worldview/layers.json.

import * as Cesium from 'cesium';
import { createStandaloneScene } from '../../standalone/scene.js';
import { createStandaloneCatalog } from '../../standalone/catalog.js';
import { LayerLifecycle } from '../../data/lifecycle.js';
import layerConfig from '../../../config/worldview/layers.json';
import { newsApi } from '../newsApi.js';
import { h, timeAgo, toast } from '../ui.js';
import { createMyNews } from './myNews.js';
import { createInfoCard } from './infoCard.js';
import { createLiveView } from './liveView.js';
import { createSourceLayer } from './sourceLayers.js';
import { createTopicBar } from './topicBar.js';
import { createLiveTv } from './liveTv.js';

const STORAGE_KEY = 'worldview.globe.layers';
const BASEMAPS = [
  ['esri-imagery', 'Satellite'],
  ['osm', 'Street map'],
  ['photoreal', 'Google 3D'],
];

const $ = (id) => document.getElementById(id);

function savedLayerChoice() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? null;
  } catch {
    return null;
  }
}

function loadPref(name, fallback) {
  try {
    const value = localStorage.getItem(`worldview.globe.${name}`);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function savePref(name, value) {
  try {
    localStorage.setItem(`worldview.globe.${name}`, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private windows); the choice just isn't remembered.
  }
}

function saveLayerChoice(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private windows can refuse storage; layers just won't be remembered.
  }
}

async function start() {
  const controller = new AbortController();
  const defer = () => {}; // the page lives until it is closed
  const loaderStatus = document.querySelector('.loader-status');

  const scene = await createStandaloneScene({
    signal: controller.signal,
    defer,
    loaderStatus,
  });
  const { viewer } = scene;
  // Day/night shading: the night side of the Earth is darkened, live.
  const setLighting = (on) => {
    viewer.scene.globe.enableLighting = on;
    viewer.scene.globe.dynamicAtmosphereLighting = on;
    viewer.scene.requestRender();
  };
  setLighting(loadPref('lighting', true));
  // Keep the data credits in the globe's corner rather than under the panel.
  const credits = document.getElementById('cesium-credits');
  if (credits) $('cesiumContainer').append(credits);

  // Data layers from the globe engine.
  loaderStatus.textContent = 'Preparing data layers…';
  const catalog = createStandaloneCatalog({
    signal: controller.signal,
    surface: scene.operations.surface,
  });
  const manager = new LayerLifecycle(viewer);
  for (const layer of catalog.layers) manager.register(layer);
  for (const layer of catalog.layers) layer.attachDataManager?.(manager);
  for (const layer of catalog.layers)
    layer.attachMapStackController?.(scene.mapStackController);
  manager.finalizeRegistrations(catalog.metadata);

  const card = createInfoCard($('card'));
  let liveView = null;
  const openLive = (spot) => liveView.open(spot);
  const myNews = createMyNews({ viewer, card, onExplore: openLive });
  liveView = createLiveView({
    viewer,
    root: $('live'),
    topicColor: myNews.topicColor,
    onOpenArticle: (a) => myNews.openArticle(a),
  });

  const configured = layerConfig.groups.flatMap((g) => g.layers);
  const engineIds = new Set(manager.getAll().map((l) => l.id));
  // Worldview's own live sources (wildfires, alerts, road events, …).
  const sourceMeta = new Map(
    ((await newsApi.sources().catch(() => [])) ?? []).map((m) => [m.id, m]),
  );
  const sourceLayers = new Map();
  for (const entry of configured.filter(
    (l) => l.source && sourceMeta.has(l.source),
  )) {
    const layer = createSourceLayer(entry, sourceMeta.get(entry.source), {
      viewer,
      card,
      onExplore: openLive,
      topicColor: myNews.topicColor,
    });
    sourceLayers.set(entry.id, layer);
  }
  const known = configured.filter(
    (l) => l.id === 'my-news' || engineIds.has(l.id) || sourceLayers.has(l.id),
  );
  const saved = savedLayerChoice();
  const wantOn = new Set(
    saved ?? configured.filter((l) => l.on).map((l) => l.id),
  );

  const isOn = (id) =>
    id === 'my-news'
      ? myNews.enabled
      : sourceLayers.has(id)
        ? sourceLayers.get(id).enabled
        : manager.isEnabled(id);
  async function setLayer(id, on) {
    if (id === 'my-news') await myNews.setEnabled(on);
    else if (sourceLayers.has(id)) await sourceLayers.get(id).setEnabled(on);
    else if (manager.isEnabled(id) !== on)
      await manager.toggle(id, { origin: 'user' });
    saveLayerChoice(known.filter((l) => isOn(l.id)).map((l) => l.id));
    renderPanel();
  }

  // ---------- panel ----------
  function layerStatus(id) {
    if (id === 'my-news') return myNews.status();
    if (sourceLayers.has(id)) return sourceLayers.get(id).status();
    const info = manager.getAll().find((l) => l.id === id);
    if (!info?.enabled) return { text: '' };
    const s = info.stats ?? {};
    if (s.keyRequired)
      return {
        text: 'Needs a free key: see docs/worldview/ADDING-A-KEY.md',
        kind: 'warn',
      };
    const errorText = s.error ? String(s.error?.message ?? s.error) : null;
    if (errorText && !(s.count > 0))
      return { text: 'Unavailable right now', kind: 'bad', title: errorText };
    if (
      info.lifecycleState &&
      info.lifecycleState !== 'enabled' &&
      info.lifecycleState !== 'idle'
    )
      return { text: 'Loading…' };
    if (s.loading) return { text: 'Loading…' };
    const parts = [];
    if (Number.isFinite(s.count))
      parts.push(`${s.count.toLocaleString()} shown`);
    if (s.lastUpdate)
      parts.push(`updated ${timeAgo(new Date(s.lastUpdate).toISOString())}`);
    if (errorText)
      return {
        text: [...parts, 'some data missing'].join(' · '),
        kind: 'warn',
        title: errorText,
      };
    return { text: parts.join(' · ') };
  }

  // The panel has a fixed header (title, layer search) and a body that is
  // redrawn as data arrives, so typing in the search box is never interrupted.
  const panel = $('panel');
  const panelBody = h('div.wv-panel-body');
  let layerQuery = '';
  const layerSearch = h('input.wv-layer-search', {
    type: 'search',
    placeholder: 'Find a layer…',
    'aria-label': 'Find a layer',
    oninput: (e) => {
      layerQuery = e.target.value.trim().toLowerCase();
      renderPanel();
    },
  });
  panel.replaceChildren(
    h(
      'div.wv-panel-head',
      {},
      h('h2.wv-panel-title', 'Layers'),
      h(
        'button.wv-icon-btn',
        {
          type: 'button',
          title: 'Hide the panel (more room for the globe)',
          'aria-label': 'Hide the layer panel',
          onclick: () => document.body.classList.add('panel-hidden'),
        },
        '⟨',
      ),
    ),
    layerSearch,
    panelBody,
  );
  $('panel-show').addEventListener('click', () =>
    document.body.classList.remove('panel-hidden'),
  );

  const matches = (l, group) =>
    !layerQuery ||
    `${l.name} ${l.about} ${group.name}`.toLowerCase().includes(layerQuery);

  function renderPanel() {
    const open = new Set(
      [...panelBody.querySelectorAll('details[open]')].map(
        (d) => d.dataset.group,
      ),
    );
    const first = !panelBody.childElementCount;
    const active = known.filter((l) => isOn(l.id));
    panelBody.replaceChildren(
      active.length
        ? h(
            'div.wv-active-layers',
            { 'aria-label': 'Layers switched on' },
            active.map((l) =>
              h(
                'button.wv-pill',
                {
                  type: 'button',
                  title: `Turn off ${l.name}`,
                  onclick: () => setLayer(l.id, false),
                },
                `${l.icon ?? ''} ${l.name}`,
                h('span', { 'aria-hidden': 'true' }, ' ×'),
              ),
            ),
          )
        : null,
      ...layerConfig.groups.map((group) => {
        const layers = group.layers.filter(
          (l) => known.includes(l) && matches(l, group),
        );
        if (!layers.length) return null;
        const onCount = layers.filter((l) => isOn(l.id)).length;
        return h(
          'details.wv-group',
          {
            open:
              layerQuery ||
              (first
                ? group.name === 'News' || onCount > 0
                : open.has(group.name)),
            'data-group': group.name,
          },
          h(
            'summary',
            {},
            h('span.wv-group-icon', group.icon ?? ''),
            h('span', group.name),
            onCount ? h('span.wv-count', `${onCount} on`) : null,
          ),
          layers.map((l) => {
            const on = isOn(l.id);
            // A Worldview source knows whether its key is set; engine layers just say so.
            const missingKey = l.source
              ? sourceMeta.get(l.source)?.configured === false
              : Boolean(l.needsKey);
            const status = on
              ? layerStatus(l.id)
              : { text: missingKey ? `Needs a free ${l.needsKey} key` : '' };
            return h(
              'label.wv-layer' + (on ? '.is-on' : ''),
              { title: l.about },
              h('span.wv-layer-icon', { 'aria-hidden': 'true' }, l.icon ?? '•'),
              h(
                'span.wv-layer-text',
                {},
                h('span.wv-layer-name', l.name),
                h('span.wv-layer-about', l.about),
                status.text
                  ? h(
                      `span.wv-layer-status.is-${status.kind ?? 'ok'}`,
                      { title: status.title },
                      status.text,
                    )
                  : null,
              ),
              h('input.wv-switch', {
                type: 'checkbox',
                role: 'switch',
                checked: on,
                'aria-label': l.name,
                onchange: (e) => setLayer(l.id, e.target.checked),
              }),
            );
          }),
          group.name === 'News' && myNews.enabled ? myNews.controls() : null,
        );
      }),
      h(
        'section.wv-basemap',
        {},
        h('h3', 'Base map'),
        h(
          'div.wv-chips',
          {},
          BASEMAPS.map(([id, label]) =>
            h(
              'button.wv-chip' + (currentBasemap === id ? '.is-active' : ''),
              {
                type: 'button',
                onclick: async () => {
                  try {
                    await scene.mapStackController.setStack(id);
                    currentBasemap = id;
                  } catch {
                    toast(
                      `${label} isn't available${id === 'photoreal' ? ' without a Google Maps key' : ''}.`,
                    );
                  }
                  renderPanel();
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
            checked: viewer.scene.globe.enableLighting,
            onchange: (e) => {
              setLighting(e.target.checked);
              savePref('lighting', e.target.checked);
            },
          }),
          'Day / night shading',
        ),
      ),
      h(
        'footer.wv-panel-foot',
        {},
        'Right-click anywhere on the globe for a 📡 Live view. Data may be delayed or incomplete; each item shows its source. ',
        h(
          'a',
          {
            href: '/index.html',
            title: 'The original God’s Eye View interface, with extra tools',
          },
          'Classic view',
        ),
      ),
    );
    renderStats();
  }

  // ---------- stats strip + headline ticker ----------
  function renderStats() {
    const items = known
      .filter((l) => isOn(l.id))
      .map((l) => {
        const count =
          l.id === 'my-news'
            ? myNews.count
            : sourceLayers.has(l.id)
              ? sourceLayers.get(l.id).count
              : manager.getAll().find((x) => x.id === l.id)?.stats?.count;
        return Number.isFinite(count)
          ? h(
              'span.wv-stat',
              { title: l.name },
              `${l.icon ?? ''} ${count.toLocaleString()}`,
            )
          : null;
      })
      .filter(Boolean);
    $('stats').replaceChildren(...items);
    $('stats').hidden = !items.length;
  }

  let tickerKey = '';
  function renderTicker() {
    const latest = myNews.enabled ? myNews.latest(14) : [];
    const key = latest.map((a) => a.id).join(',');
    if (key === tickerKey) return;
    tickerKey = key;
    const ticker = $('ticker');
    ticker.hidden = !latest.length;
    const items = latest.map((a) =>
      h(
        'button.wv-tick',
        { type: 'button', onclick: () => myNews.openArticle(a) },
        h('span.wv-dot', { style: { background: myNews.colorOf(a) } }),
        h('strong', a.feed_title),
        ' ',
        a.title,
        h('small', ` · ${timeAgo(a.published_at)}`),
      ),
    );
    // Two copies so the scroll loops seamlessly.
    ticker.replaceChildren(
      h('span.wv-ticker-label', 'Latest'),
      h(
        'div.wv-ticker-track',
        {},
        h('div.wv-ticker-run', {}, items),
        h(
          'div.wv-ticker-run',
          { 'aria-hidden': 'true' },
          items.map((n) => n.cloneNode(true)),
        ),
      ),
    );
    // Cloned buttons need their own click handlers.
    const clones = ticker.querySelectorAll(
      '.wv-ticker-run:last-child .wv-tick',
    );
    clones.forEach((node, i) =>
      node.addEventListener('click', () => myNews.openArticle(latest[i])),
    );
  }

  let currentBasemap = scene.tileset ? 'photoreal' : 'esri-imagery';

  // Refresh layer statuses as data arrives (cheap: one small re-render).
  let pending = false;
  const refresh = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      renderPanel();
    });
  };
  manager.subscribeActivity?.(refresh);
  myNews.onChange(() => {
    refresh();
    renderTicker();
  });
  for (const layer of sourceLayers.values()) layer.onChange(refresh);
  createTopicBar($('topic-bar'), myNews);
  createLiveTv($('tv'), $('tv-button'));
  setInterval(refresh, 15_000);

  // ---------- clicks on the globe ----------
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    if (liveView.handlePick(picked)) return;
    if (myNews.handlePick(picked)) return;
    const entity =
      picked?.id instanceof Cesium.Entity
        ? picked.id
        : nearestEntity(viewer, click.position);
    const asPick = { id: entity };
    for (const layer of sourceLayers.values())
      if (layer.handlePick(asPick)) return;
    if (entity) card.showEntity(entity);
    else card.hide();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ---------- place search ----------
  // Right-click anywhere: Live view of that spot.
  handler.setInputAction((click) => {
    const spot = pointAt(viewer, click.position);
    if (spot) openLive({ ...spot, kind: 'point' });
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  $('live-here').addEventListener('click', () => {
    const centre = new Cesium.Cartesian2(
      viewer.canvas.clientWidth / 2,
      viewer.canvas.clientHeight / 2,
    );
    const spot = pointAt(viewer, centre);
    if (!spot) return toast('Point the globe at somewhere on Earth first.');
    // Radius from how far you're zoomed out.
    const km = viewer.camera.positionCartographic.height / 1000 / 4;
    const radius = [5, 25, 100, 300].find((r) => r >= km) ?? 300;
    openLive({ ...spot, kind: 'point', radius });
  });

  setupPlaceSearch(viewer, openLive);

  // Turn on the remembered layers, then follow "Show on globe" links.
  $('loading').hidden = true;
  renderPanel();
  for (const l of known)
    if (wantOn.has(l.id)) await setLayer(l.id, true).catch(() => {});
  await myNews.followLink(location.hash);
  window.addEventListener('hashchange', () => myNews.followLink(location.hash));
  window.__worldview = { viewer, manager, myNews, Cesium }; // for troubleshooting in the browser console
}

/**
 * Some engine layers draw their symbols separately from the data they carry,
 * and small dots are hard to hit, so when a click lands on nothing we take the
 * nearest data item within a few pixels.
 */
function nearestEntity(viewer, clickPosition, maxPixels = 14) {
  const now = Cesium.JulianDate.now();
  // Ignore anything on the far side of the Earth.
  const occluder = new Cesium.EllipsoidalOccluder(
    Cesium.Ellipsoid.WGS84,
    viewer.camera.positionWC,
  );
  let best = null;
  let bestDistance = maxPixels;
  for (let i = 0; i < viewer.dataSources.length; i++) {
    const source = viewer.dataSources.get(i);
    // Our own sources' small dots count too; My News and the Live view handle their own clicks.
    if (!source.show || /^worldview-(my-news|live)/.test(source.name)) continue;
    for (const entity of source.entities.values) {
      if (!entity.isShowing || !entity.position) continue;
      const position = entity.position.getValue(now);
      if (!position || !occluder.isPointVisible(position)) continue;
      const screen = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        position,
      );
      if (!screen) continue;
      const distance = Cesium.Cartesian2.distance(screen, clickPosition);
      if (distance < bestDistance) {
        best = entity;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** Latitude/longitude under a screen position, or null when it's space. */
function pointAt(viewer, position) {
  const cartesian = viewer.camera.pickEllipsoid(
    position,
    viewer.scene.globe.ellipsoid,
  );
  if (!cartesian) return null;
  const c = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lat: Cesium.Math.toDegrees(c.latitude),
    lon: Cesium.Math.toDegrees(c.longitude),
  };
}

function setupPlaceSearch(viewer, openLive) {
  const form = $('place-search');
  const input = form.querySelector('input');
  const list = form.querySelector('.wv-suggest');
  let timer;
  let results = [];
  const fly = (p) => {
    const height =
      p.kind === 'country'
        ? 4_000_000
        : p.kind === 'region'
          ? 1_500_000
          : 60_000;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, height),
      duration: 1.6,
    });
    list.hidden = true;
    input.value = p.name;
    openLive({
      lat: p.lat,
      lon: p.lon,
      name: p.name,
      region: p.region,
      kind: p.kind === 'city' ? 'place' : p.kind,
    });
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      results =
        q.length >= 2 ? await newsApi.placeSearch(q).catch(() => []) : [];
      list.replaceChildren(
        ...results.map((p) =>
          h(
            'button',
            { type: 'button', onclick: () => fly(p) },
            p.name,
            h('small', [p.region, p.country_code].filter(Boolean).join(', ')),
          ),
        ),
      );
      list.hidden = !results.length;
    }, 200);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (results[0]) fly(results[0]);
  });
  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) list.hidden = true;
  });
}

start().catch((err) => {
  console.error(err);
  document.querySelector('.loader-status').textContent =
    `The globe couldn't start: ${err.message}`;
});
