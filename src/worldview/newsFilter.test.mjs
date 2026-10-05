import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanFilter,
  describeFilter,
  filterFromHash,
  filterToHash,
  removePart,
  sameFilter,
  toQuery,
} from './newsFilter.js';

test('cleanFilter drops empty values and normalises order', () => {
  assert.deepEqual(
    cleanFilter({ q: '  ', topics: ['Local', 'BC Politics', 'Local'], feeds: ['3', 1], read: null, sort: 'newest' }),
    { topics: ['BC Politics', 'Local'], feeds: [1, 3] },
  );
});

test('hash round trip keeps every kind of value', () => {
  const filter = {
    q: 'ferry delays',
    topics: ['BC Politics', 'Local'],
    feeds: [2, 7],
    last_hours: 24,
    read: false,
    has_location: true,
    country: 'CA',
    admin1: '02',
    near: { lat: 48.43, lon: -123.37, km: 50, label: 'Victoria' },
    sort: 'oldest',
  };
  assert.deepEqual(filterFromHash(filterToHash(filter)), cleanFilter(filter));
  assert.equal(filterToHash({}), '');
});

test('toQuery strips display-only labels and adds paging', () => {
  assert.deepEqual(toQuery({ near: { lat: 1, lon: 2, km: 3, label: 'X' } }, { offset: 100 }), {
    near: { lat: 1, lon: 2, km: 3 },
    limit: 100,
    offset: 100,
  });
});

test('describeFilter and removePart work together', () => {
  const filter = { topics: ['Local'], country: 'CA', admin1: '02', city: 'Victoria', last_hours: 24 };
  const parts = describeFilter(filter, { countries: { CA: 'Canada' }, regions: { 'CA.02': 'British Columbia' } });
  assert.deepEqual(
    parts.map((p) => p.label),
    ['Local', 'last 24 hours', 'Victoria', 'British Columbia', 'Canada'],
  );
  const withoutCountry = removePart(filter, parts.at(-1).remove);
  assert.deepEqual(withoutCountry, { topics: ['Local'], last_hours: 24 });
  assert.deepEqual(removePart(filter, ['topics', 'Local']).topics, undefined);
});

test('sameFilter ignores key order and empty values', () => {
  assert.ok(sameFilter({ topics: ['B', 'A'], q: '' }, { topics: ['A', 'B'] }));
  assert.ok(!sameFilter({ topics: ['A'] }, { topics: ['A'], starred: true }));
});
