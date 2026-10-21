import { Injectable } from '@nestjs/common';
import type {
  FeatureAccess,
  SharedStat,
  SharedWidget,
} from '@life-portal/shared-types';
import {
  formatCentsCompact,
  selectedAvailableModules,
  sharedModuleOrder,
} from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { SettingsService } from '../settings/settings.module';
import { NutritionService } from '../nutrition/nutrition.service';
import { CashflowService } from '../cashflow/cashflow.service';
import { StocksService } from '../stocks/stocks.service';
import { LoansService } from '../loans/loans.service';
import { ItemsService } from '../items/items.module';
import { PersonalService } from '../personal/personal.module';
import { BoardsService } from '../boards/boards.service';
import { FxService } from '../fx/fx.module';

/** Explicit shared projections: never serialise an owner dashboard or its source summaries. */
@Injectable()
export class SharedWidgetsService {
  constructor(
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly nutrition: NutritionService,
    private readonly cashflow: CashflowService,
    private readonly stocks: StocksService,
    private readonly loans: LoansService,
    private readonly items: ItemsService,
    private readonly personal: PersonalService,
    private readonly boards: BoardsService,
    private readonly fx: FxService,
  ) {}
  async forViewer(
    ownerId: string,
    viewerAccess: FeatureAccess,
    friends: boolean,
    today: string,
    limit = 8,
  ): Promise<SharedWidget[]> {
    if (!viewerAccess.social) return [];
    const { ids, settings } = await this.sharingContext(
      ownerId,
      viewerAccess,
      friends,
    );
    const widgets: SharedWidget[] = [];
    // Fetch in display order until the permitted preview is full; an all-private Food card
    // does not consume a slot, and later widgets are not fetched needlessly.
    for (const id of ids) {
      let title = '';
      let stats: SharedStat[] = [];
      let hasDiary = false;
      if (id === 'nutrition') {
        title = 'Food';
        const profile = await this.nutrition.profile(ownerId);
        hasDiary = profile.shareDiary === true;
        stats = await this.nutrition.sharedStats(ownerId, today, profile);
      }
      if (id === 'money') {
        title = 'Money';
        const s = await this.cashflow.summary(ownerId, today);
        stats = [
          {
            label: 'Balance',
            value: formatCentsCompact(s.currentBalanceCents, s.currency),
          },
          {
            label: 'Free today',
            value: formatCentsCompact(s.freeTodayCents, s.currency),
            estimated: true,
          },
          ...(s.nextIncomeAmountCents === undefined
            ? []
            : [
                {
                  label: 'Next income',
                  value: formatCentsCompact(
                    s.nextIncomeAmountCents,
                    s.currency,
                  ),
                },
              ]),
        ];
      }
      if (id === 'loans') {
        title = 'Debts';
        const s = await this.loans.summary(ownerId, today);
        stats = [
          {
            label: 'Remaining',
            value: formatCentsCompact(s.totalRemainingCents, s.currency),
          },
          {
            label: 'Repaid',
            value: formatCentsCompact(s.totalPaidCents, s.currency),
          },
          { label: 'Active loans', value: String(s.activeCount) },
        ];
      }
      if (id === 'stocks' || id === 'items' || id === 'personal') {
        const { currency, fx } = await this.fx.displayFor(ownerId, today);
        if (id === 'stocks') {
          title = 'Stocks';
          const s = await this.stocks.summary(ownerId, today, {
            currency,
            fx,
            taxRate: settings.capitalGainsTaxRate,
          });
          stats = [
            { label: 'Holdings', value: String(s.positionCount) },
            {
              label: 'Cost',
              value: formatCentsCompact(s.totalCostCents, currency),
            },
            ...(s.totalMarketValueCents === undefined
              ? []
              : [
                  {
                    label: 'Market value',
                    value: formatCentsCompact(
                      s.totalMarketValueCents,
                      currency,
                    ),
                    estimated: s.quotesStale,
                  },
                ]),
          ];
        }
        if (id === 'items') {
          title = 'Items to sell';
          const s = await this.items.summary(ownerId, currency, fx);
          stats = [
            { label: 'For sale', value: String(s.openCount) },
            {
              label: 'Expected proceeds',
              value: formatCentsCompact(s.expectedProceedsCents, currency),
              estimated: true,
            },
            { label: 'Sold', value: String(s.soldCount) },
          ];
        }
        if (id === 'personal') {
          title = 'Personal life';
          const s = await this.personal.summary(ownerId, today, currency, fx);
          stats = [
            { label: 'Ideas', value: String(s.ideaCount) },
            { label: 'Planned', value: String(s.plannedCount) },
            { label: 'Done', value: String(s.doneCount) },
          ];
        }
      }
      if (id === 'projects') {
        title = 'Projects';
        const projects = (await this.boards.summaries(ownerId, today)).filter(
          (p) => p.key !== 'epam',
        );
        stats = [
          { label: 'Projects', value: String(projects.length) },
          {
            label: 'Open tasks',
            value: String(projects.reduce((n, p) => n + p.openTaskCount, 0)),
          },
          {
            label: 'Overdue',
            value: String(projects.reduce((n, p) => n + p.overdueTaskCount, 0)),
          },
        ];
      }
      if (stats.length || hasDiary)
        widgets.push({
          module: id,
          title,
          audience: settings.moduleVisibility![id]!,
          stats,
          ...(hasDiary ? { hasDiary: true } : {}),
        });
      if (widgets.length >= limit) break;
    }
    return widgets;
  }
  private async sharingContext(
    ownerId: string,
    viewerAccess: FeatureAccess,
    friends: boolean,
  ) {
    const [identity, settings] = await Promise.all([
      this.access.forUser(ownerId),
      this.settings.get(ownerId),
    ]);
    const ids =
      !identity.access.social || !viewerAccess.social
        ? []
        : sharedModuleOrder({
            selected: selectedAvailableModules(
              settings.selectedModules,
              identity.access,
            ),
            ownerAccess: identity.access,
            viewerAccess,
            visibility: settings.moduleVisibility ?? {},
            order: settings.widgetOrder,
            friends,
          });
    return { ids, settings };
  }
  async diaryForViewer(
    ownerId: string,
    viewerAccess: FeatureAccess,
    friends: boolean,
    day: string,
    today: string,
  ) {
    if (!viewerAccess.social || !viewerAccess.nutrition) return null;
    const { ids } = await this.sharingContext(ownerId, viewerAccess, friends);
    return ids.includes('nutrition')
      ? this.nutrition.sharedDiary(ownerId, day, today)
      : null;
  }
}
