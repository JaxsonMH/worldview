// Worldview Globe: the topic bar floating over the globe. One chip per topic
// with its colour and how many stories it has right now. Click a chip to show
// only that topic; click more to add them; "All" brings everything back.
// It filters what My News draws straight away (no reload).

import { h } from '../ui.js';

export function createTopicBar(root, myNews) {
  function render() {
    if (!myNews.enabled) {
      root.hidden = true;
      return;
    }
    const counts = myNews.topicCounts();
    const selected = myNews.visibleTopics;
    const topics = myNews.topics.filter((t) => counts.get(t.name));
    root.hidden = !topics.length;
    const toggle = (name) => {
      let next;
      if (!selected)
        next = new Set([name]); // from "all": show just this one
      else {
        next = new Set(selected);
        if (next.has(name)) next.delete(name);
        else next.add(name);
      }
      myNews.setVisibleTopics(next.size ? next : null);
    };
    root.replaceChildren(
      h(
        'button.wv-topic' + (!selected ? '.is-on' : ''),
        {
          type: 'button',
          onclick: () => myNews.setVisibleTopics(null),
          title: 'Show every topic',
        },
        'All topics',
      ),
      ...topics.map((t) =>
        h(
          'button.wv-topic' +
            (selected?.has(t.name) ? '.is-on' : '') +
            (selected && !selected.has(t.name) ? '.is-off' : ''),
          {
            type: 'button',
            style: { '--c': t.color },
            title: selected?.has(t.name)
              ? `Hide ${t.name}`
              : selected
                ? `Add ${t.name}`
                : `Show only ${t.name}`,
            'aria-pressed': String(Boolean(selected?.has(t.name))),
            onclick: () => toggle(t.name),
          },
          h('span.wv-dot', { style: { background: t.color } }),
          t.name,
          h('small', String(counts.get(t.name))),
        ),
      ),
    );
  }
  myNews.onChange(render);
  return { render };
}
