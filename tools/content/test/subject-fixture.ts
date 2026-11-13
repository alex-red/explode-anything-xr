import type { SubjectDraft, SubjectMeta } from '../src/index.ts';

/**
 * A draft written by hand for these tests, in the form a model fills in. It stands in for a
 * model's answer; it is test data, not a statement about any real place.
 */
export const DRAFT: SubjectDraft = {
  title: 'Lantern World',
  statement: 'A made-up layered world used to test the builder. Its layers and its weather are invented and stand for nothing real.',
  parts: [
    { id: 'crust', label: 'Crust', summary: 'The thin outer shell of rock.', shape: 'sphere', size: 'large', color: '#b5533c', nested: 0 },
    { id: 'mantle', label: 'Mantle', summary: 'The thick layer of slow-moving rock under the crust.', shape: 'box', size: 'large', color: '#d98a4e', nested: 1 },
    { id: 'core', label: 'Core', summary: 'The hot centre that warms everything above it.', shape: 'sphere', size: 'medium', color: '#f2c14e', nested: 2 },
    { id: 'air', label: 'Thin air', summary: 'A thin layer of gas above the ground.', shape: 'torus', size: 'large', color: '#e8c9a0', nested: null },
    { id: 'dust', label: 'Dust storm', summary: 'Dust lifted from the ground by wind.', shape: 'sphere', size: 'small', color: '#c97f4a', nested: null },
    { id: 'ice', label: 'Polar ice', summary: 'A cap of ice at the pole.', shape: 'cylinder', size: 'small', color: '#eef4f8', nested: null },
    { id: 'moon', label: 'Small moon', summary: 'A small body that goes around the world.', shape: 'box', size: 'small', color: '#8a8580', nested: null },
  ],
  connections: [
    { from: 'core', to: 'mantle', kind: 'transmits', flow: 'heat', label: 'deep heat', rule: 'Heat from the core passes up into the mantle.' },
    { from: 'mantle', to: 'crust', kind: 'transmits', flow: 'heat', label: 'rising heat', rule: 'The mantle passes its heat on to the crust.' },
    { from: 'crust', to: 'air', kind: 'transmits', flow: 'heat', label: 'warm ground', rule: 'Warm ground heats the air above it.' },
    { from: 'air', to: 'dust', kind: 'powers', flow: 'torque', label: 'wind', rule: 'Moving air lifts dust and keeps the storm going.' },
    { from: 'air', to: 'ice', kind: 'depends_on', flow: 'heat', label: 'cold air', rule: 'The ice cap needs the cold air above it to last.' },
  ],
  chain: ['crust', 'air', 'dust'],
  chain_label: 'warm ground to the dust storm',
  cut: { from: 'crust', to: 'air' },
};

export const META: SubjectMeta = {
  provider: 'test',
  model: 'test-model-1',
  created_at: '2026-11-13T00:00:00.000Z',
  sources: [
    { title: 'Lantern World', url: 'https://en.wikipedia.org/wiki/Lantern_World' },
    { title: 'Weather of Lantern World', url: 'https://en.wikipedia.org/wiki/Weather_of_Lantern_World' },
  ],
};
