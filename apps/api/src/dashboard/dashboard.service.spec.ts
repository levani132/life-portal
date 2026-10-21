import { DashboardService } from './dashboard.service';

function fixture(selectedModules: string[]) {
  const summary = () => ({
    summary: jest.fn(),
    summaries: jest.fn().mockResolvedValue([]),
  });
  const loans = summary();
  const money = summary();
  const items = summary();
  const stocks = summary();
  const boards = summary();
  const personal = summary();
  const nutrition = summary();
  const spending = summary();
  nutrition.summary.mockResolvedValue({
    targetsAvailable: false,
    eatenKcal: 0,
    proteinEatenG: 0,
    entryCount: 0,
    targetKcal: 0,
  });
  const settings = {
    get: jest.fn().mockResolvedValue({
      displayCurrency: 'GEL',
      selectedModules,
      widgetOrder: [],
    }),
  };
  const fx = { displayFor: jest.fn() };
  const access = {
    forUser: jest.fn().mockResolvedValue({ access: { nutrition: true } }),
  };
  // Mocks intentionally cover service boundaries; no Mongo or finance call should run.
  const service = new DashboardService(
    access as never,
    loans as never,
    money as never,
    items as never,
    stocks as never,
    boards as never,
    personal as never,
    nutrition as never,
    settings as never,
    fx as never,
    spending as never,
  );
  return {
    service,
    loans,
    money,
    items,
    stocks,
    boards,
    personal,
    nutrition,
    spending,
    fx,
  };
}
describe('selected dashboard', () => {
  it('builds Food only without querying disabled finance or board services', async () => {
    const f = fixture(['nutrition', 'money']); // saved choice cannot bypass current access
    const result = await f.service.build('person', '2026-10-22');
    expect(result.cards.map((card) => card.id)).toEqual(['nutrition']);
    expect(result.netPositionCents).toBeUndefined();
    expect(result.attention).toEqual([]);
    for (const service of [
      f.loans,
      f.money,
      f.items,
      f.stocks,
      f.personal,
      f.spending,
    ])
      expect(service.summary).not.toHaveBeenCalled();
    expect(f.boards.summaries).not.toHaveBeenCalled();
    expect(f.fx.displayFor).not.toHaveBeenCalled();
    expect(f.nutrition.summary).toHaveBeenCalledWith('person', '2026-10-22');
  });
  it('respects an explicitly empty Home', async () => {
    const f = fixture([]);
    expect((await f.service.build('person', '2026-10-22')).cards).toEqual([]);
    expect(f.nutrition.summary).not.toHaveBeenCalled();
  });
});
