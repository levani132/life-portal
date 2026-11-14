import 'dotenv/config';
import mongoose from 'mongoose';
import { legacyMachineCase, type LegacyMachineCase } from '@life-portal/shared-domain';
import { loadConfig } from '../config/configuration';

/**
 * Read-only report on private machines after #14, against whatever `MONGODB_URI` points at.
 *
 * Since #14 an exercise names its equipment and nothing creates or attaches machines. Nothing was
 * migrated, because every figure was already keyed on `exerciseId`: past workouts keep their
 * `machineId` and frozen machine name as history. This lists, per account, what still refers to
 * a machine and whether that is a `same_exercise` row (nothing to decide) or a
 * `free_weight_on_machine` row, which stays unranked as before and is the one kind worth a human
 * look. It never writes.
 *
 * Usage:  npm run training:machines-audit
 */
interface Row {
  _id: unknown;
  userId: string;
  sessionId: string;
  machineId: string;
  snapshot: { name: string; equipmentType: string; machineName?: string; machineBrand?: string };
}

async function main(): Promise<void> {
  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Failed to connect to MongoDB');

  const rows = await db
    .collection<Row>('workout_exercises')
    .find({ machineId: { $exists: true } }, { projection: { userId: 1, sessionId: 1, machineId: 1, snapshot: 1 } })
    .toArray();
  const machines = await db.collection('training_machines').countDocuments();
  const referenced = new Set(rows.map((row) => row.machineId));

  const byUser = new Map<string, Record<LegacyMachineCase, Row[]>>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? { same_exercise: [], free_weight_on_machine: [] };
    entry[legacyMachineCase(row.snapshot.equipmentType)].push(row);
    byUser.set(row.userId, entry);
  }

  const out = (line: string) => process.stdout.write(`${line}\n`);
  out(`\nMachines: ${machines} in training_machines, ${referenced.size} referenced by ${rows.length} workout exercises.`);
  for (const [userId, cases] of byUser) {
    out(`\nAccount ${userId}`);
    out(`  same_exercise: ${cases.same_exercise.length} (nothing to decide)`);
    out(`  free_weight_on_machine: ${cases.free_weight_on_machine.length} (kept as is, unranked as before)`);
    for (const row of cases.free_weight_on_machine) {
      const machine = [row.snapshot.machineName, row.snapshot.machineBrand].filter(Boolean).join(' · ');
      out(`    session ${row.sessionId}: ${row.snapshot.name} on ${machine || row.machineId}`);
    }
  }
  out('');
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`\nMachine audit failed: ${error instanceof Error ? error.message : String(error)}\n\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
