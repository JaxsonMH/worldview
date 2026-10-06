// Worldview Globe: Live TV. News channels' own live streams on YouTube, in a
// small player you can move out of the way. Channels are listed in
// config/worldview/live-tv.json. A channel that isn't live right now (or
// doesn't allow embedding) shows YouTube's message; "Open on YouTube" always works.

import tv from '../../../config/worldview/live-tv.json';
import { h } from '../ui.js';

export function createLiveTv(root, button) {
  let current = null;

  function play(channel) {
    current = channel;
    render();
  }

  function render() {
    const src = current
      ? `https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(current.channel)}&autoplay=1&mute=1`
      : null;
    root.replaceChildren(
      h(
        'header.wv-tv-head',
        {},
        h('strong', '📺 Live TV'),
        current ? h('span', ` · ${current.name}`) : null,
        h(
          'button.wv-card-close',
          { type: 'button', 'aria-label': 'Close Live TV', onclick: close },
          '×',
        ),
      ),
      src
        ? h('iframe.wv-tv-frame', {
            src,
            title: `${current.name} live stream`,
            allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
            allowFullscreen: true,
            referrerPolicy: 'strict-origin-when-cross-origin',
          })
        : h(
            'p.wv-hint',
            'Pick a channel. Streams start muted; unmute in the player.',
          ),
      current
        ? h(
            'a.wv-link',
            {
              href: `https://www.youtube.com/channel/${current.channel}/live`,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            'Open on YouTube ↗',
          )
        : null,
      h(
        'div.wv-tv-list',
        {},
        tv.channels.map((c) =>
          h(
            'button.wv-chip' +
              (current?.channel === c.channel ? '.is-active' : ''),
            { type: 'button', onclick: () => play(c), title: c.region },
            c.name,
          ),
        ),
      ),
    );
  }

  function open() {
    root.hidden = false;
    render();
  }

  function close() {
    current = null;
    root.hidden = true;
    root.replaceChildren(); // stops the stream
  }

  button.addEventListener('click', () => (root.hidden ? open() : close()));
  return { open, close };
}
