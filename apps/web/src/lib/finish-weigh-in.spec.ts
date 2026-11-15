import { weighInField, weighInWrite } from './finish-weigh-in';

const rows = [
  { id: 'b', day: '2026-11-15', weightGrams: 80_000, version: 2 },
  { id: 'a', day: '2026-11-10', weightGrams: 81_000, version: 1 },
];

describe('the finish sheet weigh-in (#25)', () => {
  it("shows today's weigh-in, else prefills the latest", () => {
    expect(weighInField(rows, '2026-11-15')).toEqual({ today: rows[0], prefill: rows[0] });
    expect(weighInField(rows.slice(1), '2026-11-15')).toEqual({ prefill: rows[1] });
    expect(weighInField([], '2026-11-15')).toEqual({});
    expect(weighInField(undefined, '2026-11-15')).toEqual({});
  });

  it("never rewrites today's measurement when it is confirmed unchanged", () => {
    const field = weighInField(rows, '2026-11-15');
    expect(weighInWrite(field, 80_000, true)).toBeUndefined();
    expect(weighInWrite(field, 80_000, false)).toBeUndefined();
  });

  it("labels a changed number as replacing today's measurement", () => {
    expect(weighInWrite(weighInField(rows, '2026-11-15'), 81_500, false)).toEqual({ weightGrams: 81_500, replaces: 80_000 });
  });

  it('saves a prefilled latest weight only when asked to', () => {
    const field = weighInField(rows.slice(1), '2026-11-15');
    expect(weighInWrite(field, 81_000, false)).toBeUndefined();
    expect(weighInWrite(field, 81_000, true)).toEqual({ weightGrams: 81_000 });
  });

  it('never writes an empty or impossible weight', () => {
    expect(weighInWrite({}, undefined, true)).toBeUndefined();
    expect(weighInWrite({}, 5_000, true)).toBeUndefined();
    expect(weighInWrite({}, 80_000.5, true)).toBeUndefined();
  });
});
