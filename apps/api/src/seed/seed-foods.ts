import 'dotenv/config';
import mongoose from 'mongoose';
import { loadConfig } from '../config/configuration';
import { seedFoods, SEED_FOODS } from './foods';

/**
 * Seeds **only** the food list, against whatever `MONGODB_URI` points at.
 *
 * Separate from `npm run seed` on purpose: that one sets up the whole starting state (owner, loan,
 * ESPP plan, boards), which is not something to re-run casually against a live database. This
 * touches the `foods` collection and nothing else, and it upserts on name + brand, so running it
 * twice corrects the numbers rather than duplicating them.
 *
 * Usage:  npm run seed:foods
 */
const EMAIL = process.env['SEED_EMAIL'] ?? 'levan.beroshvili@ext.innolink.ai';

async function main(): Promise<void> {
  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Failed to connect to MongoDB');

  const user = await db.collection('users').findOne({ email: EMAIL });
  if (!user) {
    throw new Error(`No user with email ${EMAIL}. Run \`npm run seed\` first, or set SEED_EMAIL.`);
  }
  const userId = String(user['_id']);

  process.stdout.write(`\nSeeding ${SEED_FOODS.length} foods for ${EMAIL}\n`);
  const total = await seedFoods(db, userId);
  process.stdout.write(`  done — ${total} foods in the database for this owner\n\n`);

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`\nFood seed failed: ${error instanceof Error ? error.message : String(error)}\n\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
