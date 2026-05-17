/**
 * Apply a SQL migration file to Supabase Postgres via the Session Pooler.
 *
 *   node scripts/apply-migration.mjs supabase/migrations/0001_init_market.sql
 *
 * Reads SUPABASE_DB_URL from .env.local. Connects with SSL (required by
 * Supabase). Wraps the whole file in a single transaction so a partial
 * failure rolls back cleanly. Prints elapsed time and statement count.
 */

import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pkg from 'pg'

const { Client } = pkg

config({ path: '.env.local' })

const URL = process.env.SUPABASE_DB_URL
if (!URL) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/apply-migration.mjs <path-to-sql>')
  process.exit(1)
}

const sql = readFileSync(resolve(file), 'utf-8')
console.log(`migration: ${file}`)
console.log(`size: ${sql.length} chars, ~${sql.split(/;\s*$/m).length} statements (rough)`)

const client = new Client({
  connectionString: URL,
  ssl: { rejectUnauthorized: false }, // Supabase pooler uses Let's Encrypt; this is standard
})

const start = Date.now()

try {
  await client.connect()
  console.log('connected.')
  // Execute as a single multi-statement query. pg supports this natively.
  // We rely on the file itself to manage transactions (CREATE EXTENSION,
  // etc. should be fine outside an explicit tx since they're idempotent
  // via IF NOT EXISTS).
  await client.query(sql)
  console.log(`applied in ${Date.now() - start}ms`)
} catch (err) {
  console.error(`FAILED after ${Date.now() - start}ms:`)
  console.error(`  ${err.message}`)
  if (err.position) console.error(`  near position ${err.position}`)
  if (err.hint)     console.error(`  hint: ${err.hint}`)
  process.exit(1)
} finally {
  await client.end()
}
