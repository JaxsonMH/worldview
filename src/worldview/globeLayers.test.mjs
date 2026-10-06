import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../../config/worldview/layers.json', import.meta.url), 'utf8'));
const catalogSource = readFileSync(new URL('../app/constructCatalog.js', import.meta.url), 'utf8');

test('layers.json is well formed', () => {
  assert.ok(Array.isArray(config.groups) && config.groups.length > 0);
  const ids = config.groups.flatMap((g) => g.layers.map((l) => l.id));
  assert.equal(new Set(ids).size, ids.length, 'a layer is listed twice');
  assert.ok(ids.includes('my-news'));
  for (const group of config.groups) {
    assert.ok(group.name, 'every group needs a name');
    for (const layer of group.layers) assert.ok(layer.id && layer.name, `layer needs id and name: ${JSON.stringify(layer)}`);
  }
});

test('layers left out of the Worldview globe on purpose', () => {
  const ids = new Set(config.groups.flatMap((g) => g.layers.map((l) => l.id)));
  // Licence-plate reader cameras: too close to tracking people (CLAUDE.md guardrails).
  assert.ok(!ids.has('alpr-cameras'));
});

test('the engine catalog still builds the layer factories we rely on', () => {
  for (const factory of ['createApplicationEarthquakes', 'createApplicationFlights', 'createApplicationSatellites', 'createWeatherLayer', 'createApplicationCables']) {
    assert.ok(catalogSource.includes(factory), `${factory} is gone from the engine catalog`);
  }
});
