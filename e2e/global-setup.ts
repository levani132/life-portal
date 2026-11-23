import { MongoClient } from 'mongodb';

/** A fresh `lp-e2e` database for every run, so tests never meet each other's leftovers. */
export default async function globalSetup(): Promise<void> {
  const client = new MongoClient(`${(process.env['E2E_MONGODB_URI'] ?? '').replace(/\/+$/, '')}`);
  await client.connect();
  await client.db('lp-e2e').dropDatabase();
  await client.close();
}
