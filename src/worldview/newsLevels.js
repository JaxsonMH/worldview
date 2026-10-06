// Worldview: group news by country, province/state or place, depending on how
// far the globe is zoomed out, and work out which places stories connect.
//
// Two ideas:
// 1. A story that names "Victoria" and "B.C." is about Victoria; "B.C." is just
//    context. So a province is dropped when the story also names a place inside
//    it, and a country is dropped when it names anything inside that country.
//    (This stops every BC story drawing a line to the middle of BC.)
// 2. Zoomed out, places are rolled up: towns into their province, provinces
//    into their country. Lines then join provinces (or countries) that the same
//    stories mention, never a town to its own province.
//
// Plain functions, no globe code, so they can be tested on their own.

export const LEVELS = Object.freeze(['country', 'region', 'place']);
export const LEVEL_NAMES = Object.freeze({
  country: 'countries',
  region: 'provinces & states',
  place: 'cities & places',
});

/** Camera height (metres) -> grouping level. */
export function levelForHeight(heightM) {
  if (heightM > 6_000_000) return 'country';
  if (heightM > 700_000) return 'region';
  return 'place';
}

const FINE = new Set(['city', 'street', 'poi']);

/** Drop provinces/countries a story only names as context for a place inside them. */
export function collapsePlaces(places) {
  return places.filter((p) => {
    if (p.precision === 'country')
      return !places.some(
        (q) =>
          q !== p &&
          q.precision !== 'country' &&
          q.country_code === p.country_code,
      );
    if (p.precision === 'region')
      return !places.some(
        (q) =>
          q !== p &&
          FINE.has(q.precision) &&
          q.country_code === p.country_code &&
          q.admin1 === p.admin1,
      );
    return true;
  });
}

const placeKey = (p) => `p:${p.name}@${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

/**
 * The map units one story belongs to at a level, in the order it mentions them.
 * Each unit: { key, kind: 'country' | 'region' | 'place', name, lat, lon, cc, admin1 }.
 * `anchors` = { countries: {CC: {name, lat, lon}}, regions: {'CC.A1': {...}} }.
 */
export function unitsForArticle(
  places,
  level,
  anchors = { countries: {}, regions: {} },
) {
  const units = [];
  const seen = new Set();
  const add = (unit) => {
    if (seen.has(unit.key)) return;
    seen.add(unit.key);
    units.push(unit);
  };
  const countryUnit = (p) => {
    const a = anchors.countries?.[p.country_code];
    return {
      key: `c:${p.country_code}`,
      kind: 'country',
      name: a?.name ?? (p.precision === 'country' ? p.name : p.country_code),
      lat: a?.lat ?? p.lat,
      lon: a?.lon ?? p.lon,
      cc: p.country_code,
    };
  };
  const regionUnit = (p) => {
    const a = anchors.regions?.[`${p.country_code}.${p.admin1}`];
    return {
      key: `r:${p.country_code}.${p.admin1}`,
      kind: 'region',
      name: a?.name ?? (p.precision === 'region' ? p.name : p.admin1),
      lat: a?.lat ?? p.lat,
      lon: a?.lon ?? p.lon,
      cc: p.country_code,
      admin1: p.admin1,
    };
  };
  for (const p of collapsePlaces(places)) {
    if (!p.country_code) continue;
    if (level === 'country' || p.precision === 'country') add(countryUnit(p));
    else if (level === 'region' || p.precision === 'region') {
      add(p.admin1 ? regionUnit(p) : countryUnit(p));
    } else {
      add({
        key: placeKey(p),
        kind: 'place',
        name: p.name,
        lat: p.lat,
        lon: p.lon,
        cc: p.country_code,
        admin1: p.admin1,
        precision: p.precision,
      });
    }
  }
  return units;
}

/**
 * Group many stories at one level.
 * Returns { units: Map<key, unit + {articles: []}>, links: Map<'a|b', {a, b, articles: []}> }.
 * Links join consecutive units of the same story (the order it mentions them).
 */
export function aggregate(articles, level, anchors) {
  const units = new Map();
  const links = new Map();
  for (const article of articles) {
    const list = unitsForArticle(article.places, level, anchors);
    for (const unit of list) {
      const entry = units.get(unit.key) ?? { ...unit, articles: [] };
      entry.articles.push(article);
      units.set(unit.key, entry);
    }
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1].key, list[i].key].sort();
      const key = `${a}|${b}`;
      const link = links.get(key) ?? { key, a, b, articles: [] };
      link.articles.push(article);
      links.set(key, link);
    }
  }
  return { units, links };
}

/** The links touching one unit, busiest first. */
export function linksOf(links, unitKey) {
  return [...links.values()]
    .filter((l) => l.a === unitKey || l.b === unitKey)
    .sort((x, y) => y.articles.length - x.articles.length);
}
