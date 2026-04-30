/**
 * MongoDB Client
 *
 * Manages the connection to the lolev-manager MongoDB database.
 * Connection URI is stored in system_settings via the integration key UI.
 */

import { MongoClient, type Db } from "mongodb";
import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

let cachedClient: MongoClient | null = null;

/** Read the MongoDB URI from system_settings. */
async function getMongoUri(): Promise<string | null> {
  const admin = await createAdminClient();
  const { data } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "mongodb_api_key")
    .maybeSingle();
  return (data?.value as string) ?? null;
}

/** Get a cached MongoClient instance, or create one from the stored URI. */
export async function getMongoClient(): Promise<MongoClient | null> {
  if (cachedClient) return cachedClient;

  const uri = await getMongoUri();
  if (!uri) return null;

  cachedClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  await cachedClient.connect();
  return cachedClient;
}

/** Get the lolev-manager database handle. */
export async function getMongoDb(): Promise<Db | null> {
  const client = await getMongoClient();
  if (!client) return null;
  return client.db("lolev-manager");
}

/** Close the cached connection (call at end of sync). */
export async function closeMongoClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
  }
}

/** Test the MongoDB connection. Returns status and database name. */
export async function testConnection(): Promise<{
  ok: boolean;
  dbName?: string;
  error?: string;
}> {
  let client: MongoClient | null = null;
  try {
    const uri = await getMongoUri();
    if (!uri) return { ok: false, error: "No MongoDB URI configured" };

    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    await client.connect();
    const admin = client.db().admin();
    await admin.ping();
    const dbName = "lolev-manager";

    // Verify the database has collections
    const collections = await client.db(dbName).listCollections().toArray();
    if (collections.length === 0) {
      return { ok: false, error: `Database "${dbName}" has no collections` };
    }

    return { ok: true, dbName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("MongoDB connection test failed: %s", message);
    return { ok: false, error: message };
  } finally {
    if (client) await client.close();
  }
}
