import type { Currency, ModuleId } from '@life-portal/shared-types';
import { AccessService } from '../access/access.module';
import { selectedAvailableModules } from '@life-portal/shared-domain';
import { Injectable } from '@nestjs/common';
import type {
  DashboardResponse,
  WidgetCard,
  WidgetStat,
  WidgetTone,
} from '@life-portal/shared-types';
import {
  arrangeWidgets,
  diffDays,
  formatCentsCompact,
  formatDay,
  formatPct,
  relativeDays,
} from '@life-portal/shared-domain';
import { BoardsService } from '../boards/boards.service';
import { CashflowService } from '../cashflow/cashflow.service';
import { ItemsService } from '../items/items.module';
import { LoansService } from '../loans/loans.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { PersonalService } from '../personal/personal.module';
import { FxService } from '../fx/fx.module';
import { SettingsService } from '../settings/settings.module';
import { SpendingService } from '../spending/spending.service';
import { StocksService } from '../stocks/stocks.service';

/** Salary landing within this many days is worth a nudge on the dashboard. */
const SALARY_SOON_DAYS = 5;

@Injectable()
export class DashboardService {
  constructor(
    private readonly access: AccessService,
    private readonly loans: LoansService,
    private readonly cashflow: CashflowService,
    private readonly items: ItemsService,
    private readonly stocks: StocksService,
    private readonly boards: BoardsService,
    private readonly personal: PersonalService,
    private readonly nutrition: NutritionService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
    private readonly spending: SpendingService,
  ) {}

  /**
   * Builds every dashboard card in one pass.
   *
   * Each widget contributes its own card from its own summary; nothing here reaches into
   * another widget's internals (constitution principle I). Adding a widget means adding one
   * `build*Card` method and listing it below.
   *
   * The order the cards come back in is the user's, not the list below: `arrangeWidgets`
   * applies `settings.widgetOrder` — what they dragged the cards into — and falls back to each
   * widget's own `order` for anything they have not arranged.
   */
  async build(userId: string, today: string): Promise<DashboardResponse> {
    const settings = await this.settings.get(userId);
    const identity = await this.access.forUser(userId);
    const selected = selectedAvailableModules(
      settings.selectedModules,
      identity.access,
    );
    const has = (id: ModuleId) => selected.includes(id);
    const finance = ['money', 'stocks', 'loans', 'items', 'personal'].some(
      (id) => selected.includes(id as ModuleId),
    );
    const { currency, fx } = finance
      ? await this.fx.displayFor(userId, today)
      : {
          currency: settings.displayCurrency as Currency,
          fx: {
            displayCurrency: settings.displayCurrency as Currency,
            rates: {},
          },
        };
    const [
      loans,
      cashflow,
      items,
      stocks,
      allBoards,
      personal,
      nutrition,
      spending,
    ] = await Promise.all([
      has('loans') ? this.loans.summary(userId, today) : undefined,
      has('money') ? this.cashflow.summary(userId, today) : undefined,
      has('items') ? this.items.summary(userId, currency, fx) : undefined,
      has('stocks')
        ? this.stocks.summary(userId, today, {
            taxRate: settings.capitalGainsTaxRate,
            currency,
            fx,
          })
        : undefined,
      has('projects') || has('epam')
        ? this.boards.summaries(userId, today)
        : [],
      has('personal')
        ? this.personal.summary(userId, today, currency, fx)
        : undefined,
      has('nutrition') ? this.nutrition.summary(userId, today) : undefined,
      has('money') ? this.spending.summary(userId, today) : undefined,
    ]);
    const boardSummaries = allBoards.filter((board) =>
      board.key === 'epam' ? has('epam') : has('projects'),
    );
    const cards: WidgetCard[] = [];
    if (loans) cards.push(this.loansCard(loans, currency));
    if (cashflow && spending) {
      const card = this.cashflowCard(cashflow, today, currency);
      const daily = this.spendingCard(spending);
      cards.push({
        ...card,
        title: 'Money',
        subtitle: 'Balance, budget and spending',
        stats: [card.stats[0], card.stats[1], daily.stats[0]],
        alert: card.alert ?? daily.alert,
      });
    }
    if (items) cards.push(this.itemsCard(items, currency));
    if (stocks) cards.push(this.stocksCard(stocks, currency));
    if (personal) cards.push(this.personalCard(personal, currency));
    if (nutrition) cards.push(this.nutritionCard(nutrition));
    if (has('projects')) {
      const projects = boardSummaries.filter((board) => board.key !== 'epam');
      cards.push({
        key: 'projects',
        id: 'projects',
        title: 'Projects',
        href: '/projects',
        icon: 'folder',
        accent: 'violet',
        tone: 'neutral',
        order: 10,
        stats: [
          { label: 'Projects', value: String(projects.length) },
          {
            label: 'Open tasks',
            value: String(projects.reduce((n, p) => n + p.openTaskCount, 0)),
          },
          {
            label: 'Overdue',
            value: String(projects.reduce((n, p) => n + p.overdueTaskCount, 0)),
          },
        ],
      });
    }
    boardSummaries
      .filter((board) => board.key === 'epam')
      .forEach((board) => cards.push(this.boardCard(board, 0)));
    const netPositionCents =
      cashflow && items && stocks && loans
        ? cashflow.currentBalanceCents +
          items.expectedProceedsCents +
          (stocks.totalMarketValueCents ?? stocks.totalCostCents) -
          loans.totalRemainingCents
        : undefined;
    return {
      generatedAt: new Date().toISOString(),
      today,
      cards: arrangeWidgets(cards, settings.widgetOrder),
      netPositionCents,
      displayCurrency: currency,
      summaries: {
        loans,
        cashflow,
        items,
        stocks,
        boards: boardSummaries,
        personal,
        nutrition,
      },
      attention: this.attention({
        loans,
        cashflow,
        stocks,
        boardSummaries,
        personal,
        today,
      }),
    };
  }

  // ---------------------------------------------------------------- cards

  private loansCard(
    loans: NonNullable<DashboardResponse['summaries']['loans']>,
    currency: string,
  ): WidgetCard {
    const focus = loans.focus;
    const stats: WidgetStat[] = [
      {
        label: focus ? `Owed to ${focus.lender}` : 'Total owed',
        value: formatCentsCompact(
          focus?.remainingCents ?? loans.totalRemainingCents,
          currency,
        ),
        raw: focus?.remainingCents ?? loans.totalRemainingCents,
        tone: loans.totalRemainingCents > 0 ? 'warn' : 'good',
      },
      {
        label: 'Repaid',
        value: `${Math.round((focus?.progressRatio ?? 0) * 100)}%`,
        raw: focus?.progressRatio ?? 0,
        tone: 'good',
      },
      {
        label: 'Clear by',
        value: focus?.worstCasePayoffDate
          ? formatDay(focus.worstCasePayoffDate)
          : 'not scheduled',
        tone: focus?.worstCasePayoffDate ? 'neutral' : 'warn',
        estimated: true,
      },
    ];

    return {
      key: 'loans',
      id: 'loans',
      title: 'Debts',
      subtitle:
        loans.activeCount > 1
          ? `${loans.activeCount} active loans`
          : focus?.lender,
      href: '/loans',
      icon: 'hand-coins',
      accent: 'rose',
      tone: loans.totalRemainingCents > 0 ? 'warn' : 'good',
      stats,
      progress: focus?.progressRatio,
      alert:
        focus && !focus.worstCasePayoffDate
          ? 'No guaranteed repayment plan — add one'
          : undefined,
      order: 1,
    };
  }

  private cashflowCard(
    cashflow: DashboardResponse['summaries']['cashflow'],
    today: string,
    currency: string,
  ): WidgetCard {
    const nextIncomeDate = cashflow.nextIncomeDate;
    const daysToIncome = nextIncomeDate
      ? diffDays(today, nextIncomeDate)
      : undefined;
    const tone: WidgetTone =
      cashflow.freeTodayCents < 0
        ? 'bad'
        : cashflow.freeTodayCents < 20_000
          ? 'warn'
          : 'good';

    return {
      key: 'cashflow',
      id: 'cashflow',
      title: 'Free money',
      subtitle: `Reconciled ${formatDay(cashflow.balanceAsOf)}`,
      href: '/cashflow',
      icon: 'wallet',
      accent: 'emerald',
      tone,
      stats: [
        {
          label: 'On hand',
          value: formatCentsCompact(cashflow.currentBalanceCents, currency),
          raw: cashflow.currentBalanceCents,
        },
        {
          label: 'Free to spend',
          value: formatCentsCompact(cashflow.freeTodayCents, currency),
          raw: cashflow.freeTodayCents,
          tone,
          estimated: true,
        },
        {
          label: 'Salary',
          value: nextIncomeDate
            ? relativeDays(today, nextIncomeDate)
            : 'not set',
          raw: daysToIncome,
          tone:
            daysToIncome != null && daysToIncome <= SALARY_SOON_DAYS
              ? 'good'
              : 'neutral',
        },
      ],
      alert:
        cashflow.freeTodayCents < 0
          ? 'Committed spending exceeds your balance before payday'
          : undefined,
      order: 2,
    };
  }

  /**
   * Today's remaining allowance, and whether anything needs attention.
   *
   * One quick action only (principle I): adding a payment by hand, which is the thing that
   * happens often and would otherwise start with a navigation.
   */
  private spendingCard(
    spending: Awaited<ReturnType<SpendingService['summary']>>,
  ): WidgetCard {
    const { remainingTodayCents, dailyBudgetCents, currency } = spending;
    const ratioLeft =
      dailyBudgetCents > 0 ? remainingTodayCents / dailyBudgetCents : 1;
    const tone: WidgetTone =
      remainingTodayCents <= 0 ? 'bad' : ratioLeft < 0.25 ? 'warn' : 'good';

    // A message the app could not read, or one it can prove never arrived, is money not counted.
    const needsAttention = spending.unparsedCount + spending.gapCount;

    return {
      key: 'spending',
      id: 'spending',
      title: 'Spending',
      subtitle: needsAttention
        ? `${needsAttention} to look at`
        : `${formatCentsCompact(spending.spentTodayCents, currency)} today`,
      // The spending view lives inside the Free money page — the owner merged the two, since
      // both answer one question. The module keeps its own API namespace; only the route merged.
      href: '/cashflow',
      icon: 'wallet',
      accent: 'sky',
      tone,
      stats: [
        {
          label: 'Left today',
          value: formatCentsCompact(remainingTodayCents, currency),
          raw: remainingTodayCents,
          tone,
          // Captured payments are a lower bound, so this is a best case (principle VI).
          estimated: true,
        },
        {
          label: 'Spent today',
          value: formatCentsCompact(spending.spentTodayCents, currency),
          raw: spending.spentTodayCents,
          estimated: true,
        },
        {
          label: 'Unplanned',
          value: formatCentsCompact(spending.extraThisMonthCents, currency),
          raw: spending.extraThisMonthCents,
          tone: spending.extraThisMonthCents > 0 ? 'warn' : 'neutral',
        },
      ],
      alert: needsAttention
        ? 'Some messages are unread or may be missing, so today may be understated'
        : undefined,
      order: 3,
    };
  }

  private itemsCard(
    items: NonNullable<DashboardResponse['summaries']['items']>,
    currency: string,
  ): WidgetCard {
    return {
      key: 'items',
      id: 'items',
      title: 'Items to sell',
      subtitle: items.openCount
        ? `${items.openCount} still to go`
        : 'nothing listed',
      href: '/items',
      icon: 'tag',
      accent: 'amber',
      tone: items.nearlySoldCount > 0 ? 'good' : 'neutral',
      stats: [
        {
          label: 'Expected',
          value: formatCentsCompact(items.expectedProceedsCents, currency),
          raw: items.expectedProceedsCents,
          estimated: true,
        },
        { label: 'Open', value: String(items.openCount), raw: items.openCount },
        {
          label: 'Sold',
          value: formatCentsCompact(items.realisedProceedsCents, currency),
          raw: items.realisedProceedsCents,
          tone: 'good',
        },
      ],
      alert: items.nearlySoldCount
        ? `${items.nearlySoldCount} with a buyer waiting`
        : undefined,
      order: 3,
    };
  }

  private stocksCard(
    stocks: DashboardResponse['summaries']['stocks'],
    currency: string,
  ): WidgetCard {
    const pnl = stocks.totalUnrealisedPnlPct;
    const tone: WidgetTone =
      pnl == null ? 'neutral' : pnl >= 0 ? 'good' : 'bad';

    return {
      key: 'stocks',
      id: 'stocks',
      title: 'Stocks',
      subtitle: stocks.positionCount
        ? `${stocks.positionCount} positions`
        : 'no holdings',
      href: '/stocks',
      icon: 'trending-up',
      accent: 'sky',
      tone: stocks.quotesStale ? 'warn' : tone,
      stats: [
        {
          label: 'Market value',
          value:
            stocks.totalMarketValueCents != null
              ? formatCentsCompact(stocks.totalMarketValueCents, currency)
              : 'no prices',
          raw: stocks.totalMarketValueCents,
          tone,
        },
        {
          label: 'Gain',
          value: pnl != null ? formatPct(pnl) : '—',
          raw: pnl,
          tone,
        },
        {
          label: 'At target',
          value: formatCentsCompact(stocks.totalValueAtTargetCents, currency),
          raw: stocks.totalValueAtTargetCents,
          estimated: true,
        },
      ],
      alert: stocks.quotesStale
        ? 'Prices are stale — refresh or enter them manually'
        : stocks.nextEsppDate
          ? `Next ESPP purchase ${formatDay(stocks.nextEsppDate)}`
          : undefined,
      order: 4,
    };
  }

  private boardCard(
    board: NonNullable<DashboardResponse['summaries']['boards']>[number],
    index: number,
  ): WidgetCard {
    const stats: WidgetStat[] = [
      {
        label: 'Open',
        value: String(board.openTaskCount),
        raw: board.openTaskCount,
      },
      {
        label: 'Urgent',
        value: String(board.urgentTaskCount),
        raw: board.urgentTaskCount,
        tone: board.urgentTaskCount > 0 ? 'warn' : 'neutral',
      },
    ];

    // People and contribution stats only appear on boards that opted into those features.
    if (board.needsAttentionCount != null) {
      stats.push({
        label: 'Need me',
        value: `${board.needsAttentionCount}/${board.peopleCount ?? 0}`,
        raw: board.needsAttentionCount,
        tone: board.needsAttentionCount > 0 ? 'warn' : 'good',
      });
    } else if (board.contributionPointsLast6Months != null) {
      stats.push({
        label: 'Points (6m)',
        value: String(board.contributionPointsLast6Months),
        raw: board.contributionPointsLast6Months,
        tone: 'good',
      });
    } else {
      stats.push({
        label: 'Overdue',
        value: String(board.overdueTaskCount),
        raw: board.overdueTaskCount,
        tone: board.overdueTaskCount > 0 ? 'bad' : 'neutral',
      });
    }

    const alerts: string[] = [];
    if (board.needsAttentionCount)
      alerts.push(`${board.needsAttentionCount} need attention`);
    if (board.overdueOneOnOneCount)
      alerts.push(`${board.overdueOneOnOneCount} 1:1s overdue`);
    if (board.overdueTaskCount)
      alerts.push(`${board.overdueTaskCount} overdue`);

    return {
      key: 'board',
      id: `board:${board.key}`,
      title: board.name,
      subtitle: board.kind === 'employer' ? 'Talent Partner' : undefined,
      href: `/boards/${board.key}`,
      icon:
        board.kind === 'employer'
          ? 'users'
          : board.kind === 'client_project'
            ? 'briefcase'
            : 'rocket',
      accent: board.accent,
      tone: alerts.length ? 'warn' : 'neutral',
      stats,
      alert: alerts.join(' · ') || undefined,
      order: 10 + index,
    };
  }

  private personalCard(
    personal: DashboardResponse['summaries']['personal'],
    currency: string,
  ): WidgetCard {
    return {
      key: 'personal',
      id: 'personal',
      title: 'Personal life',
      subtitle: personal.next ? personal.next.title : 'nothing planned',
      href: '/personal',
      icon: 'heart',
      accent: 'fuchsia',
      tone: personal.next ? 'good' : 'neutral',
      stats: [
        {
          label: 'Next up',
          value: personal.next ? `${personal.next.daysUntil}d` : '—',
          raw: personal.next?.daysUntil,
          tone:
            personal.next && personal.next.daysUntil <= 7 ? 'good' : 'neutral',
        },
        {
          label: 'Ideas',
          value: String(personal.ideaCount),
          raw: personal.ideaCount,
        },
        {
          label: 'Committed',
          value: formatCentsCompact(personal.upcomingCommittedCents, currency),
          raw: personal.upcomingCommittedCents,
        },
      ],
      alert:
        personal.plannedCount === 0
          ? 'Nothing booked — plan something'
          : undefined,
      order: 20,
    };
  }

  // ---------------------------------------------------------------- attention

  /** Cross-widget nudges. These are the only place one widget may comment on another. */
  /**
   * The food card: eaten, left, protein left — and the one quick action the amended principle I
   * allows, because logging happens several times a day and should not start with a navigation.
   *
   * Readable before the profile exists: with no targets there is still a calorie count and an
   * invitation to fill the profile in, rather than three dashes or a misleading zero.
   */
  private nutritionCard(
    nutrition: NonNullable<DashboardResponse['summaries']['nutrition']>,
  ): WidgetCard {
    const { targetKcal, leftKcal, proteinLeftG } = nutrition;
    const overBy = leftKcal != null && leftKcal < 0 ? -leftKcal : 0;
    const tone: WidgetTone = !nutrition.targetsAvailable
      ? 'neutral'
      : overBy > 0
        ? 'bad'
        : leftKcal != null && targetKcal != null && leftKcal < targetKcal * 0.1
          ? 'warn'
          : 'good';

    const cheatNote =
      nutrition.daysUntilCheat === 0
        ? 'cheat day — enjoy it'
        : nutrition.daysUntilCheat != null
          ? `cheat day in ${nutrition.daysUntilCheat}d`
          : undefined;

    return {
      key: 'nutrition',
      id: 'nutrition',
      title: 'Food',
      subtitle:
        cheatNote ??
        (nutrition.entryCount > 0
          ? `${nutrition.entryCount} logged today`
          : 'nothing logged yet'),
      href: '/nutrition',
      icon: 'utensils',
      accent: 'lime',
      tone,
      stats: nutrition.targetsAvailable
        ? [
            {
              label: 'Eaten',
              value: `${nutrition.eatenKcal} kcal`,
              raw: nutrition.eatenKcal,
            },
            {
              label: overBy > 0 ? 'Over by' : 'Left today',
              value: leftKcal == null ? '—' : `${Math.abs(leftKcal)} kcal`,
              raw: leftKcal,
              tone,
              estimated: nutrition.targetsAvailable,
            },
            {
              label: 'Protein left',
              value:
                proteinLeftG == null ? '—' : `${Math.max(0, proteinLeftG)} g`,
              raw: proteinLeftG,
              tone:
                proteinLeftG != null && proteinLeftG <= 0 ? 'good' : 'neutral',
              estimated: nutrition.targetsAvailable,
            },
          ]
        : [
            {
              label: 'Eaten',
              value: `${nutrition.eatenKcal} kcal`,
              raw: nutrition.eatenKcal,
            },
            {
              label: 'Protein',
              value: `${nutrition.proteinEatenG} g`,
              raw: nutrition.proteinEatenG,
            },
            {
              label: 'Logged foods',
              value: String(nutrition.entryCount),
              raw: nutrition.entryCount,
            },
          ],
      progress:
        targetKcal && targetKcal > 0
          ? Math.min(1, nutrition.eatenKcal / targetKcal)
          : undefined,
      alert: nutrition.targetsAvailable
        ? undefined
        : 'Log meals now; set nutrition goals whenever you’re ready',
      quickAction: { kind: 'log-food', label: 'Log food' },
      order: 25,
    };
  }

  private attention(input: {
    loans: DashboardResponse['summaries']['loans'];
    cashflow: DashboardResponse['summaries']['cashflow'];
    stocks: DashboardResponse['summaries']['stocks'];
    boardSummaries: NonNullable<DashboardResponse['summaries']['boards']>;
    personal: DashboardResponse['summaries']['personal'];
    today: string;
  }): DashboardResponse['attention'] {
    const out: DashboardResponse['attention'] = [];

    if (input.cashflow?.nextIncomeDate) {
      const days = diffDays(input.today, input.cashflow?.nextIncomeDate);
      if (days >= 0 && days <= SALARY_SOON_DAYS) {
        out.push({
          tone: 'good',
          message: `Salary lands ${relativeDays(input.today, input.cashflow?.nextIncomeDate)} — review the plan before it does.`,
          href: '/cashflow',
        });
      }
    }

    if (input.cashflow && input.cashflow.freeTodayCents < 0) {
      out.push({
        tone: 'bad',
        message:
          'Committed spending exceeds your balance before the next salary.',
        href: '/cashflow',
      });
    }

    if (
      input.loans?.focus &&
      !input.loans.focus.worstCasePayoffDate &&
      input.loans.totalRemainingCents > 0
    ) {
      out.push({
        tone: 'warn',
        message: `No guaranteed repayment plan for ${input.loans.focus.lender} — the debt has no end date.`,
        href: `/loans`,
      });
    }

    if (
      input.stocks &&
      input.stocks.positionCount > 0 &&
      input.stocks.quotesStale
    ) {
      out.push({
        tone: 'warn',
        message:
          'Share prices are stale. Refresh them so the target figures mean something.',
        href: '/stocks',
      });
    }

    for (const board of input.boardSummaries) {
      if (board.needsAttentionCount) {
        out.push({
          tone: 'warn',
          message: `${board.needsAttentionCount} on ${board.name} need attention.`,
          href: `/boards/${board.key}`,
        });
      }
      if (board.overdueOneOnOneCount) {
        out.push({
          tone: 'warn',
          message: `${board.overdueOneOnOneCount} overdue 1:1${board.overdueOneOnOneCount === 1 ? '' : 's'} on ${board.name}.`,
          href: `/boards/${board.key}`,
        });
      }
    }

    if (input.personal?.next && input.personal.next.daysUntil <= 7) {
      out.push({
        tone: 'good',
        message: `${input.personal.next.title} is ${relativeDays(input.today, input.personal.next.date)}.`,
        href: '/personal',
      });
    }

    return out;
  }
}
