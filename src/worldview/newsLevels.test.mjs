import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregate, collapsePlaces, levelForHeight, linksOf, unitsForArticle } from './newsLevels.js';

const victoria = { name: 'Victoria', country_code: 'CA', admin1: '02', lat: 48.43, lon: -123.37, precision: 'city' };
const nanaimo = { name: 'Nanaimo', country_code: 'CA', admin1: '02', lat: 49.17, lon: -123.94, precision: 'city' };
const bc = { name: 'British Columbia', country_code: 'CA', admin1: '02', lat: 54, lon: -125, precision: 'region' };
const canada = { name: 'Canada', country_code: 'CA', lat: 45.4, lon: -75.7, precision: 'country' };
const ottawa = { name: 'Ottawa', country_code: 'CA', admin1: '08', lat: 45.42, lon: -75.7, precision: 'city' };
const ontario = { name: 'Ontario', country_code: 'CA', admin1: '08', lat: 49, lon: -84, precision: 'region' };
const seattle = { name: 'Seattle', country_code: 'US', admin1: 'WA', lat: 47.6, lon: -122.3, precision: 'city' };
const usa = { name: 'United States', country_code: 'US', lat: 38.9, lon: -77, precision: 'country' };
const anchors = {
  countries: { CA: { name: 'Canada', lat: 51.8, lon: -100.5 }, US: { name: 'United States', lat: 39.5, lon: -90.2 } },
  regions: { 'CA.02': { name: 'British Columbia', lat: 54, lon: -125 }, 'CA.08': { name: 'Ontario', lat: 49, lon: -84 }, 'US.WA': { name: 'Washington', lat: 47.4, lon: -120.5 } },
};
const names = (units) => units.map((u) => u.name);

test('zoom height picks the level', () => {
  assert.equal(levelForHeight(20_000_000), 'country');
  assert.equal(levelForHeight(2_000_000), 'region');
  assert.equal(levelForHeight(80_000), 'place');
});

test('a province or country named only as context is dropped', () => {
  assert.deepEqual(names(collapsePlaces([victoria, bc, canada])), ['Victoria']);
  // A province named with a town in a *different* province stays.
  assert.deepEqual(names(collapsePlaces([victoria, ontario])), ['Victoria', 'Ontario']);
  // A country with nothing inside it stays.
  assert.deepEqual(names(collapsePlaces([victoria, usa])), ['Victoria', 'United States']);
});

test('the Victoria + B.C. story no longer joins Victoria to the middle of BC', () => {
  const units = unitsForArticle([victoria, bc], 'place', anchors);
  assert.deepEqual(names(units), ['Victoria']);
});

test('roll-up by level keeps mention order and removes repeats', () => {
  const places = [victoria, nanaimo, ottawa, seattle];
  assert.deepEqual(names(unitsForArticle(places, 'place', anchors)), ['Victoria', 'Nanaimo', 'Ottawa', 'Seattle']);
  assert.deepEqual(names(unitsForArticle(places, 'region', anchors)), ['British Columbia', 'Ontario', 'Washington']);
  assert.deepEqual(names(unitsForArticle(places, 'country', anchors)), ['Canada', 'United States']);
});

test('country-level points use the anchor, not the capital', () => {
  const [unit] = unitsForArticle([canada], 'place', anchors);
  assert.equal(unit.kind, 'country');
  assert.deepEqual([unit.lat, unit.lon], [51.8, -100.5]);
});

test('aggregate counts stories per unit and per link', () => {
  const stories = [
    { id: 1, places: [victoria, bc] },
    { id: 2, places: [victoria, ottawa] },
    { id: 3, places: [nanaimo, ottawa] },
  ];
  const place = aggregate(stories, 'place', anchors);
  assert.equal(place.units.size, 3);
  assert.equal(place.links.size, 2);
  const region = aggregate(stories, 'region', anchors);
  assert.deepEqual([...region.units.values()].map((u) => [u.name, u.articles.length]), [['British Columbia', 3], ['Ontario', 2]]);
  const [bcToOntario] = linksOf(region.links, 'r:CA.02');
  assert.equal(bcToOntario.articles.length, 2);
  // Stories inside one province draw no line at province level.
  assert.equal(aggregate([{ id: 4, places: [victoria, nanaimo] }], 'region', anchors).links.size, 0);
});
