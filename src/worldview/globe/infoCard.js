// Worldview Globe: the card that opens when you click something on the globe.

import * as Cesium from 'cesium';
import { fullTime, h, timeAgo } from '../ui.js';

// Internal fields that mean nothing to a reader.
const HIDDEN_KEYS =
  /^(_|uid|icon|color|colour|style|geometry|bbox|feature|raw|model|sprite)|(^id|Id|ID|_id)$/;
// Friendlier names for common fields.
const LABELS = {
  mag: 'Magnitude',
  depth: 'Depth (km)',
  alt: 'Altitude',
  altitude: 'Altitude',
  speed: 'Speed',
  time: 'Time',
};

function prettyKey(key) {
  if (LABELS[key]) return LABELS[key];
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function prettyValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    // Epoch milliseconds (e.g. earthquake times) read better as dates.
    if (value > 1e12 && value < 1e13)
      return fullTime(new Date(value).toISOString());
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return null;
  const text = String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export function createInfoCard(root) {
  let onClose = null;
  function open(...children) {
    onClose?.();
    onClose = null;
    root.replaceChildren(
      h(
        'button.wv-card-close',
        { type: 'button', 'aria-label': 'Close', onclick: hide },
        '×',
      ),
      ...children
        .flat(Infinity)
        .filter((c) => c !== null && c !== undefined && c !== false),
    );
    root.hidden = false;
  }

  function hide() {
    root.hidden = true;
    root.replaceChildren();
    onClose?.();
    onClose = null;
  }

  /** Anything from the globe engine's layers: show its name and readable properties. */
  function showEntity(entity) {
    const now = Cesium.JulianDate.now();
    const props = entity.properties?.getValue?.(now) ?? {};
    const title =
      entity.name ||
      props.name ||
      props.title ||
      props.callsign ||
      props.place ||
      'Selected item';
    const rows = Object.entries(props)
      .filter(([key, value]) => !HIDDEN_KEYS.test(key) && value !== title)
      .map(([key, value]) => [prettyKey(key), prettyValue(value)])
      .filter(([, value]) => value !== null)
      .slice(0, 14);
    let description = entity.description?.getValue?.(now);
    if (description)
      description = new DOMParser()
        .parseFromString(description, 'text/html')
        .body.textContent.trim();
    open(
      h('h2', String(title)),
      description ? h('p.wv-card-text', description.slice(0, 400)) : null,
      rows.length
        ? h(
            'dl.wv-props',
            {},
            rows.map(([k, v]) => [h('dt', k), h('dd', v)]),
          )
        : null,
      !rows.length && !description
        ? h('p.wv-hint', 'No extra details for this item.')
        : null,
    );
  }

  /** One news article. */
  function showArticle(
    a,
    {
      topicColor = () => '#888',
      onClose: closed = null,
      onExplore = null,
    } = {},
  ) {
    const places = a.places.filter((p) => p.precision !== 'country');
    open(
      h(
        'p.wv-card-kicker',
        {},
        h('strong', a.feed_title),
        ' · ',
        h(
          'time',
          { datetime: a.published_at, title: fullTime(a.published_at) },
          timeAgo(a.published_at),
        ),
      ),
      h(
        'h2',
        {},
        h(
          'a',
          { href: a.url, target: '_blank', rel: 'noopener noreferrer' },
          a.title,
        ),
      ),
      h(
        'div.wv-card-tags',
        {},
        a.topics.map((t) =>
          h('span.wv-tag', { style: { '--c': topicColor(t.topic) } }, t.topic),
        ),
      ),
      places.length
        ? h(
            'p.wv-card-places',
            `📍 ${places.map((p, i) => (places.length > 1 ? `${i + 1}. ${p.name}` : p.name)).join(' → ')}`,
          )
        : null,
      h(
        'div.wv-actions',
        {},
        h(
          'a.wv-btn',
          { href: a.url, target: '_blank', rel: 'noopener noreferrer' },
          'Read article ↗',
        ),
        h(
          'a.wv-btn.wv-btn-ghost',
          { href: `/reader.html#article=${a.id}` },
          'Open in Reader',
        ),
        onExplore
          ? h(
              'button.wv-btn.wv-btn-ghost',
              { type: 'button', onclick: onExplore },
              '📡 Live view here',
            )
          : null,
      ),
    );
    onClose = closed;
  }

  /** Any content, with a callback for when the card closes or is replaced. */
  function showCustom(children, closed = null) {
    open(...children);
    onClose = closed;
  }

  /** Several articles at once (a country's unplaced stories, or a busy spot). */
  function showArticleList(title, articles, { onPick }) {
    open(
      h('h2', title),
      h(
        'ul.wv-card-list',
        {},
        articles.map((a) =>
          h(
            'li',
            {},
            h(
              'button',
              { type: 'button', onclick: () => onPick(a) },
              a.title,
              h('small', `${a.feed_title} · ${timeAgo(a.published_at)}`),
            ),
          ),
        ),
      ),
    );
  }

  return { showEntity, showArticle, showArticleList, showCustom, hide };
}
