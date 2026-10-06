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
  const myNews = createMyNews({ viewer, card });

  const configured = layerConfig.groups.flatMap((g) => g.layers);
  const engineIds = new Set(manager.getAll().map((l) => l.id));
  const known = configured.filter(
    (l) => l.id === 'my-news' || engineIds.has(l.id),
  );
  const saved = savedLayerChoice();
  const wantOn = new Set(
    saved ?? configured.filter((l) => l.on).map((l) => l.id),
  );

  const isOn = (id) =>
    id === 'my-news' ? myNews.enabled : manager.isEnabled(id);
  async function setLayer(id, on) {
    if (id === 'my-news') await myNews.setEnabled(on);
    else if (manager.isEnabled(id) !== on)
      await manager.toggle(id, { origin: 'user' });
    saveLayerChoice(known.filter((l) => isOn(l.id)).map((l) => l.id));
    renderPanel();
  }

  // ---------- panel ----------
  function layerStatus(id) {
    if (id === 'my-news') return myNews.status();
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

  function renderPanel() {
    const panel = $('panel');
    const open = new Set(
      [...panel.querySelectorAll('details[open]')].map((d) => d.dataset.group),
    );
    const first = !panel.childElementCount;
    panel.replaceChildren(
      h('h2.wv-panel-title', 'Layers'),
      ...layerConfig.groups.map((group) => {
        const layers = group.layers.filter((l) => known.includes(l));
        if (!layers.length) return null;
        const onCount = layers.filter((l) => isOn(l.id)).length;
        return h(
          'details.wv-group',
          {
            open: first
              ? group.name === 'News' || onCount > 0
              : open.has(group.name),
            'data-group': group.name,
          },
          h(
            'summary',
            {},
            h('span', group.name),
            onCount ? h('span.wv-count', `${onCount} on`) : null,
          ),
          layers.map((l) => {
            const on = isOn(l.id);
            const status = on
              ? layerStatus(l.id)
              : { text: l.needsKey ? `Needs a free ${l.needsKey} key` : '' };
            return h(
              'label.wv-layer' + (on ? '.is-on' : ''),
              { title: l.about },
              h('input.wv-switch', {
                type: 'checkbox',
                role: 'switch',
                checked: on,
                onchange: (e) => setLayer(l.id, e.target.checked),
              }),
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
      ),
      h(
        'footer.wv-panel-foot',
        {},
        'Data may be delayed or incomplete; each item shows its source. ',
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
  myNews.onChange(refresh);
  setInterval(refresh, 15_000);

  // ---------- clicks on the globe ----------
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    if (myNews.handlePick(picked)) return;
    const entity =
      picked?.id instanceof Cesium.Entity
        ? picked.id
        : nearestEntity(viewer, click.position);
    if (entity) card.showEntity(entity);
    else card.hide();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ---------- place search ----------
  setupPlaceSearch(viewer);

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
    if (!source.show || source.name.startsWith('worldview-')) continue;
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

function setupPlaceSearch(viewer) {
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
