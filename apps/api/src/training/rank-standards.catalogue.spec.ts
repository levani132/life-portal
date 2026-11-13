import { RANK_BENCHMARKS, catalogueMeasure, milestoneStarts } from '@life-portal/shared-domain';
import catalogue from './catalogue/free-exercise-db.json';
import { seedKeyFor } from './catalogue.seeder';

/**
 * Rank standards (#5) against the catalogue they rank: every standard names a real shared
 * exercise, assumes the measure that exercise is logged with (otherwise its sets would be read
 * wrongly, e.g. a weighted pull-up logged as weight only), says how load is entered, and has
 * strictly rising tiers for both standards sets.
 */
type Entry = (typeof catalogue.exercises)[number];
const byKey = new Map<string, Entry>(catalogue.exercises.map((entry) => [seedKeyFor(entry), entry]));

describe('rank standards and the catalogue', () => {
  const latest = RANK_BENCHMARKS[RANK_BENCHMARKS.length - 1];
  const standards = Object.entries(latest.exercises);

  it('covers substantially more of the catalogue than the first draft', () => {
    expect(standards.length).toBeGreaterThanOrEqual(190);
  });

  it.each(standards)('%s exists, with the measure it is logged with', (key, standard) => {
    const entry = byKey.get(key);
    expect(entry).toBeDefined();
    expect(catalogueMeasure(entry as never)).toBe(standard.measure);
  });

  it.each(standards)('%s says how load is entered and has rising tiers', (_key, standard) => {
    expect(standard.note).toBeTruthy();
    for (const starts of [standard.starts.men, standard.starts.women]) {
      expect(starts).toHaveLength(8);
      expect(starts[0]).toBe(0);
      const divisions = milestoneStarts(starts);
      for (let i = 1; i < divisions.length; i++) expect(divisions[i]).toBeGreaterThan(divisions[i - 1]);
    }
  });

  it('marks every machine and cable standard provisional', () => {
    for (const [key, standard] of standards) {
      if (standard.machine && !['fedb:Leg_Press', 'fedb:Leg_Extensions', 'fedb:Seated_Leg_Curl', 'fedb:Wide-Grip_Lat_Pulldown', 'fedb:Close-Grip_Front_Lat_Pulldown', 'fedb:Seated_Cable_Rows', 'fedb:Leverage_Chest_Press', 'fedb:Machine_Bench_Press'].includes(key)) {
        expect([key, standard.provisional]).toEqual([key, true]);
      }
    }
  });
});
