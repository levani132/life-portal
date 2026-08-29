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
import { StocksService } from '../stocks/stocks.service';

/** Salary landing within this many days is worth a nudge on the dashboard. */
const SALARY_SOON_DAYS = 5;

@Injectable()
export class DashboardService {
  constructor(
    private readonly loans: LoansService,
    private readonly cashflow: CashflowService,
    private readonly items: ItemsService,
    private readonly stocks: StocksService,
    private readonly boards: BoardsService,
    private readonly personal: PersonalService,
    private readonly nutrition: NutritionService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
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
    // One rate lookup for the whole dashboard, so every card on it agrees.
    const { currency, fx } = await this.fx.displayFor(userId, today);

    const [loans, cashflow, items, stocks, boardSummaries, personal, nutrition] = await Promise.all([
      this.loans.summary(userId, today),
      this.cashflow.summary(userId, today),
      this.items.summary(userId, currency, fx),
      this.stocks.summary(userId, today, { taxRate: settings.capitalGainsTaxRate, currency, fx }),
      this.boards.summaries(userId, today),
      this.personal.summary(userId, today, currency, fx),
      this.nutrition.summary(userId, today),
    ]);

    const cards: WidgetCard[] = [
      this.loansCard(loans, currency),
      this.cashflowCard(cashflow, today, currency),
      this.itemsCard(items, currency),
      this.stocksCard(stocks, currency),
      ...boardSummaries.map((board, index) => this.boardCard(board, index)),
      this.personalCard(personal, currency),
      this.nutritionCard(nutrition),
    ];

    // Net position: what is mine, minus what is owed. Stocks are counted at market value
    // where a quote exists, at cost otherwise, so an unpriced holding is not counted as zero.
    // Every term is already in `currency` because each summary converted its own rows — this
    // used to add dollars to lari, which is what made the headline figure meaningless.
    const netPositionCents =
      cashflow.currentBalanceCents +
      items.expectedProceedsCents +
      (stocks.totalMarketValueCents ?? stocks.totalCostCents) -
      loans.totalRemainingCents;

    return {
      generatedAt: new Date().toISOString(),
      today,
      cards: arrangeWidgets(cards, settings.widgetOrder),
      netPositionCents,
      displayCurrency: currency,
      summaries: { loans, cashflow, items, stocks, boards: boardSummaries, personal, nutrition },
      attention: this.attention({ loans, cashflow, stocks, boardSummaries, personal, today }),
    };
  }

  // ---------------------------------------------------------------- cards

  private loansCard(loans: DashboardResponse['summaries']['loans'], currency: string): WidgetCard {
    const focus = loans.focus;
    const stats: WidgetStat[] = [
      {
        label: focus ? `Owed to ${focus.lender}` : 'Total owed',
        value: formatCentsCompact(focus?.remainingCents ?? loans.totalRemainingCents, currency),
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
        value: focus?.worstCasePayoffDate ? formatDay(focus.worstCasePayoffDate) : 'not scheduled',
        tone: focus?.worstCasePayoffDate ? 'neutral' : 'warn',
        estimated: true,
      },
    ];

    return {
      key: 'loans',
      id: 'loans',
      title: 'Debts',
      subtitle: loans.activeCount > 1 ? `${loans.activeCount} active loans` : focus?.lender,
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
    const daysToIncome = nextIncomeDate ? diffDays(today, nextIncomeDate) : undefined;
    const tone: WidgetTone =
      cashflow.freeTodayCents < 0 ? 'bad' : cashflow.freeTodayCents < 20_000 ? 'warn' : 'good';

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
          value: nextIncomeDate ? relativeDays(today, nextIncomeDate) : 'not set',
          raw: daysToIncome,
          tone: daysToIncome != null && daysToIncome <= SALARY_SOON_DAYS ? 'good' : 'neutral',
        },
      ],
      alert:
        cashflow.freeTodayCents < 0
          ? 'Committed spending exceeds your balance before payday'
          : undefined,
      order: 2,
    };
  }

  private itemsCard(items: DashboardResponse['summaries']['items'], currency: string): WidgetCard {
    return {
      key: 'items',
      id: 'items',
      title: 'Items to sell',
      subtitle: items.openCount ? `${items.openCount} still to go` : 'nothing listed',
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
      alert: items.nearlySoldCount ? `${items.nearlySoldCount} with a buyer waiting` : undefined,
      order: 3,
    };
  }

  private stocksCard(stocks: DashboardResponse['summaries']['stocks'], currency: string): WidgetCard {
    const pnl = stocks.totalUnrealisedPnlPct;
    const tone: WidgetTone = pnl == null ? 'neutral' : pnl >= 0 ? 'good' : 'bad';

    return {
      key: 'stocks',
      id: 'stocks',
      title: 'Stocks',
      subtitle: stocks.positionCount ? `${stocks.positionCount} positions` : 'no holdings',
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

  private boardCard(board: DashboardResponse['summaries']['boards'][number], index: number): WidgetCard {
    const stats: WidgetStat[] = [
      { label: 'Open', value: String(board.openTaskCount), raw: board.openTaskCount },
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
    if (board.needsAttentionCount) alerts.push(`${board.needsAttentionCount} need attention`);
    if (board.overdueOneOnOneCount) alerts.push(`${board.overdueOneOnOneCount} 1:1s overdue`);
    if (board.overdueTaskCount) alerts.push(`${board.overdueTaskCount} overdue`);

    return {
      key: 'board',
      id: `board:${board.key}`,
      title: board.name,
      subtitle: board.kind === 'employer' ? 'Talent Partner' : undefined,
      href: `/boards/${board.key}`,
      icon: board.kind === 'employer' ? 'users' : board.kind === 'client_project' ? 'briefcase' : 'rocket',
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
          tone: personal.next && personal.next.daysUntil <= 7 ? 'good' : 'neutral',
        },
        { label: 'Ideas', value: String(personal.ideaCount), raw: personal.ideaCount },
        {
          label: 'Committed',
          value: formatCentsCompact(personal.upcomingCommittedCents, currency),
          raw: personal.upcomingCommittedCents,
        },
      ],
      alert: personal.plannedCount === 0 ? 'Nothing booked — plan something' : undefined,
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
  private nutritionCard(nutrition: DashboardResponse['summaries']['nutrition']): WidgetCard {
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
      subtitle: cheatNote ?? (nutrition.entryCount > 0 ? `${nutrition.entryCount} logged today` : 'nothing logged yet'),
      href: '/nutrition',
      icon: 'utensils',
      accent: 'lime',
      tone,
      stats: [
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
          value: proteinLeftG == null ? '—' : `${Math.max(0, proteinLeftG)} g`,
          raw: proteinLeftG,
          tone: proteinLeftG != null && proteinLeftG <= 0 ? 'good' : 'neutral',
          estimated: nutrition.targetsAvailable,
        },
      ],
      progress:
        targetKcal && targetKcal > 0 ? Math.min(1, nutrition.eatenKcal / targetKcal) : undefined,
      alert: nutrition.targetsAvailable
        ? undefined
        : 'No targets yet — add your height, age and weight',
      quickAction: { kind: 'log-food', label: 'Log food' },
      order: 25,
    };
  }

  private attention(input: {
    loans: DashboardResponse['summaries']['loans'];
    cashflow: DashboardResponse['summaries']['cashflow'];
    stocks: DashboardResponse['summaries']['stocks'];
    boardSummaries: DashboardResponse['summaries']['boards'];
    personal: DashboardResponse['summaries']['personal'];
    today: string;
  }): DashboardResponse['attention'] {
    const out: DashboardResponse['attention'] = [];

    if (input.cashflow.nextIncomeDate) {
      const days = diffDays(input.today, input.cashflow.nextIncomeDate);
      if (days >= 0 && days <= SALARY_SOON_DAYS) {
        out.push({
          tone: 'good',
          message: `Salary lands ${relativeDays(input.today, input.cashflow.nextIncomeDate)} — review the plan before it does.`,
          href: '/cashflow',
        });
      }
    }

    if (input.cashflow.freeTodayCents < 0) {
      out.push({
        tone: 'bad',
        message: 'Committed spending exceeds your balance before the next salary.',
        href: '/cashflow',
      });
    }

    if (input.loans.focus && !input.loans.focus.worstCasePayoffDate && input.loans.totalRemainingCents > 0) {
      out.push({
        tone: 'warn',
        message: `No guaranteed repayment plan for ${input.loans.focus.lender} — the debt has no end date.`,
        href: `/loans`,
      });
    }

    if (input.stocks.positionCount > 0 && input.stocks.quotesStale) {
      out.push({
        tone: 'warn',
        message: 'Share prices are stale. Refresh them so the target figures mean something.',
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

    if (input.personal.next && input.personal.next.daysUntil <= 7) {
      out.push({
        tone: 'good',
        message: `${input.personal.next.title} is ${relativeDays(input.today, input.personal.next.date)}.`,
        href: '/personal',
      });
    }

    return out;
  }
}
