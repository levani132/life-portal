import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { loadConfig } from '../config/configuration';
import { seedFoods } from './foods';
import { upsert } from './upsert';

/**
 * Seeds a fresh database with the real starting state.
 *
 * Idempotent: run it as many times as you like. It keys everything off the owner's email and
 * off stable natural keys (loan lender, board slug), updating rather than duplicating.
 *
 * Usage:  npm run seed
 *         SEED_EMAIL=you@example.com SEED_PASSWORD='...' npm run seed
 */

const EMAIL = process.env['SEED_EMAIL'] ?? 'levan.beroshvili@ext.innolink.ai';
const PASSWORD = process.env['SEED_PASSWORD'] ?? 'change-me-after-first-login';
const NAME = process.env['SEED_NAME'] ?? 'Levan';

/** The friend loan: $17,000 borrowed, $10,500 still outstanding. */
const LOAN_PRINCIPAL_CENTS = 1_700_000;
const LOAN_OUTSTANDING_CENTS = 1_050_000;
const LOAN_ALREADY_REPAID_CENTS = LOAN_PRINCIPAL_CENTS - LOAN_OUTSTANDING_CENTS; // $6,500
const LOAN_START_DATE = '2025-09-01';
const MONTHLY_REPAYMENT_CENTS = 100_000; // $1,000 from each salary
const SALARY_DAY = 7;

/** EPAM ESPP: $2,880 per six-month period at 15% off the lower boundary price. */
const ESPP_CONTRIBUTION_CENTS = 288_000;
const ESPP_DISCOUNT = 0.15;

const today = new Date().toISOString().slice(0, 10);

function log(message: string): void {
  process.stdout.write(`  ${message}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Failed to connect to MongoDB');

  process.stdout.write('\nSeeding Life Portal\n\n');

  // ---------------------------------------------------------------- user
  const userId = await upsert(
    db.collection('users'),
    { email: EMAIL },
    {
      email: EMAIL,
      name: NAME,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      roles: ['owner'],
    },
  );
  log(`user ${EMAIL}`);

  await upsert(
    db.collection('user_settings'),
    { userId },
    { userId, displayCurrency: 'GEL', salaryDayOfMonth: SALARY_DAY, capitalGainsTaxRate: 0, fxRates: {} },
  );

  // ---------------------------------------------------------------- cash & salary
  await upsert(
    db.collection('cash_balances'),
    { userId, asOf: today },
    { userId, amountCents: 0, currency: 'USD', asOf: today, note: 'Set your real balance in the app' },
  );

  await upsert(
    db.collection('income_sources'),
    { userId, label: 'EPAM salary' },
    {
      userId,
      label: 'EPAM salary',
      amountCents: 0, // Deliberately zero: enter the real figure in the app.
      currency: 'USD',
      recurrence: { cadence: 'monthly', interval: 1, dayOfMonth: SALARY_DAY, startDate: LOAN_START_DATE },
      active: true,
      note: 'Paid on the 7th. Set the real net amount in the app.',
    },
  );
  log('income source: EPAM salary (amount left at 0 — set it in the app)');

  // ---------------------------------------------------------------- loan
  const loanId = await upsert(
    db.collection('loans'),
    { userId, lender: 'Friend' },
    {
      userId,
      lender: 'Friend',
      label: 'Personal loan from a friend',
      principalCents: LOAN_PRINCIPAL_CENTS,
      currency: 'USD',
      startDate: LOAN_START_DATE,
      interestRate: 0,
      priority: 1,
      status: 'active',
      notes: 'Interest-free. Repaying $1,000 a month from salary, plus anything from sales.',
    },
  );
  log(`loan: $${LOAN_PRINCIPAL_CENTS / 100} principal`);

  // The $6,500 already repaid is recorded as one opening payment rather than invented
  // monthly history, because the real dates are not known. Replace it with the actual
  // payments whenever you have them — the balance folds from these rows.
  await upsert(
    db.collection('loan_payments'),
    { userId, loanId, note: 'Opening balance adjustment' },
    {
      userId,
      loanId,
      amountCents: LOAN_ALREADY_REPAID_CENTS,
      currency: 'USD',
      date: LOAN_START_DATE,
      source: 'other',
      note: 'Opening balance adjustment',
    },
  );
  log(`payment: $${LOAN_ALREADY_REPAID_CENTS / 100} already repaid → $${LOAN_OUTSTANDING_CENTS / 100} outstanding`);

  // The expense owns the monthly amount; the plan references it. Editing either screen edits
  // the one row (constitution principle IV).
  const repaymentExpenseId = await upsert(
    db.collection('expenses'),
    { userId, linkedLoanId: loanId },
    {
      userId,
      label: 'Loan repayment to friend',
      amountCents: MONTHLY_REPAYMENT_CENTS,
      currency: 'USD',
      category: 'loan',
      kind: 'recurring',
      recurrence: { cadence: 'monthly', interval: 1, dayOfMonth: SALARY_DAY, startDate: LOAN_START_DATE },
      active: true,
      linkedLoanId: loanId,
      note: 'Funded by salary. Change the amount here or on the loan — it is one row.',
    },
  );
  log(`expense: $${MONTHLY_REPAYMENT_CENTS / 100}/month repayment, linked to the loan`);

  await upsert(
    db.collection('repayment_plans'),
    { userId, loanId, kind: 'recurring' },
    {
      userId,
      loanId,
      kind: 'recurring',
      label: 'From monthly salary',
      amountCents: MONTHLY_REPAYMENT_CENTS,
      currency: 'USD',
      cadence: 'monthly',
      dayOfMonth: SALARY_DAY,
      startDate: LOAN_START_DATE,
      linkedExpenseId: repaymentExpenseId,
      guaranteed: true,
      enabled: true,
      note: 'The only guaranteed repayment, so it drives the worst-case payoff date.',
    },
  );

  // These two plans carry no amount: they resolve from the items and stocks widgets on every
  // read, so they stay correct as holdings change (constitution principle III).
  await upsert(
    db.collection('repayment_plans'),
    { userId, loanId, kind: 'items' },
    {
      userId,
      loanId,
      kind: 'items',
      label: 'Proceeds from items sold',
      currency: 'USD',
      allocationRatio: 1,
      guaranteed: false,
      enabled: true,
      note: 'Amount comes from items earmarked for this loan.',
    },
  );
  await upsert(
    db.collection('repayment_plans'),
    { userId, loanId, kind: 'stocks' },
    {
      userId,
      loanId,
      kind: 'stocks',
      label: 'Proceeds from shares sold',
      currency: 'USD',
      allocationRatio: 1,
      guaranteed: false,
      enabled: true,
      note: 'Amount comes from lots earmarked for this loan, at their target price.',
    },
  );
  log('plans: salary (guaranteed), items, stocks');

  // ---------------------------------------------------------------- espp
  await upsert(
    db.collection('espp_plans'),
    { userId, symbol: 'EPAM' },
    {
      userId,
      symbol: 'EPAM',
      contributionPerPeriodCents: ESPP_CONTRIBUTION_CENTS,
      currency: 'USD',
      discountPct: ESPP_DISCOUNT,
      periodBoundaries: [
        { month: 5, day: 1 },
        { month: 11, day: 1 },
      ],
      active: true,
      notes: '$2,880 per six months at 15% off the lower of the 1 May and 1 Nov closes.',
    },
  );
  await upsert(
    db.collection('stock_targets'),
    { userId, symbol: 'EPAM' },
    { userId, symbol: 'EPAM', horizonMonths: 12, rationale: 'Set your own target, or use the suggestion.' },
  );
  log('ESPP plan: EPAM, $2,880 / 6 months at 15% off');

  // ---------------------------------------------------------------- boards
  const boards = [
    {
      key: 'epam',
      name: 'EPAM',
      kind: 'employer',
      accent: 'violet',
      features: ['tasks', 'notes', 'people', 'contributions', 'wins'],
      description: 'Talent Partner duties: my people, and the work that earns perks and promotion.',
      order: 0,
    },
    {
      key: 'client-project',
      name: 'Client project',
      kind: 'client_project',
      accent: 'indigo',
      features: ['tasks', 'notes', 'wins'],
      description: 'The client I am staffed on. Notes, and evidence for performance reviews.',
      order: 1,
    },
    {
      key: 'soulart',
      name: 'SoulArt',
      kind: 'side_project',
      accent: 'teal',
      features: ['tasks', 'notes'],
      description: 'SoulArt backlog.',
      order: 2,
    },
    {
      key: 'shopit',
      name: 'ShopIt',
      kind: 'side_project',
      accent: 'cyan',
      features: ['tasks', 'notes'],
      description: 'ShopIt backlog.',
      order: 3,
    },
  ];

  for (const board of boards) {
    await upsert(db.collection('boards'), { userId, key: board.key }, { userId, ...board, archived: false });
  }
  log(`boards: ${boards.map((b) => b.key).join(', ')}`);

  const foodCount = await seedFoods(db, userId);
  log(`foods: ${foodCount} in the database`);

  await mongoose.disconnect();

  process.stdout.write('\nDone.\n\n');
  process.stdout.write('Next steps:\n');
  process.stdout.write(`  1. Sign in as ${EMAIL}\n`);
  if (PASSWORD === 'change-me-after-first-login') {
    process.stdout.write('     Password: change-me-after-first-login  ← change this immediately\n');
  }
  process.stdout.write('  2. Set your real cash balance and salary amount on the Free money page.\n');
  process.stdout.write('  3. Add your items to sell and your share lots.\n\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}\n\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
