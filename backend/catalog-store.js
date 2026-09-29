const store = require('./store')
const { normalizeWheel, seedWheel, invalid } = require('./catalog')

async function initializeCatalog(wheels) {
  const pool = store.catalogStorage().pool
  if (pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS wheel_catalog (id TEXT PRIMARY KEY, document JSONB NOT NULL);
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS wheel_snapshot JSONB;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS prize_details JSONB;
      ALTER TABLE spins ADD COLUMN IF NOT EXISTS prize_details JSONB;`)
  }
  for (const [id, wheel] of Object.entries(wheels)) {
    const published = seedWheel(wheel)
    const document = { id, revision: 1, version: 1, published, draft: null,
      history: [{ version: 1, action: 'import', actorId: 'system', actorName: 'Importazione iniziale', at: new Date().toISOString(), configuration: published }] }
    if (pool) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('INSERT INTO wheel_catalog (id, document) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING', [id, JSON.stringify(document)])
        // Existing codes get the original catalog once, before any publication is accepted.
        await client.query('UPDATE sales SET wheel_snapshot = $2::jsonb WHERE wheel_id = $1 AND wheel_snapshot IS NULL', [id, JSON.stringify(published)])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    } else {
      const { state, save } = store.catalogStorage()
      state.catalog ||= {}
      state.catalog[id] ||= document
      for (const sale of state.sales) if (sale.wheel === id && !sale.wheelSnapshot) sale.wheelSnapshot = structuredClone(published)
      save()
    }
  }
}

async function listCatalog() {
  const { pool, state } = store.catalogStorage()
  if (!pool) return structuredClone(Object.values(state.catalog || {}))
  return (await pool.query('SELECT document FROM wheel_catalog ORDER BY id::bigint')).rows.map(row => row.document)
}

async function getCatalog(id) {
  const { pool, state } = store.catalogStorage()
  if (!pool) return structuredClone(state.catalog?.[id] || null)
  return (await pool.query('SELECT document FROM wheel_catalog WHERE id = $1', [id])).rows[0]?.document || null
}

async function changeCatalog(id, { action, revision, configuration, version }, actor) {
  const { pool, state, save } = store.catalogStorage()
  const client = pool ? await pool.connect() : null
  try {
    if (client) await client.query('BEGIN')
    const current = client
      ? (await client.query('SELECT document FROM wheel_catalog WHERE id = $1 FOR UPDATE', [id])).rows[0]?.document
      : structuredClone(state.catalog?.[id])
    if (!current) throw invalid('Ruota non trovata.', 404)
    if (revision !== current.revision) throw invalid('La configurazione è cambiata. Ricarica prima di salvare.', 409)
    if (action === 'draft') current.draft = normalizeWheel(configuration)
    else if (action === 'restore') {
      const old = current.history.find(entry => entry.version === version && ['publish', 'import'].includes(entry.action))
      if (!old) throw invalid('Versione non trovata.', 404)
      current.draft = structuredClone(old.configuration)
    } else if (action === 'publish') {
      if (!current.draft) throw invalid('Salva prima una bozza.')
      current.published = normalizeWheel(current.draft, true)
      current.version++
      current.draft = null
    } else throw invalid('Azione non valida.')
    current.revision++
    current.history.unshift({ action, version: current.version, revision: current.revision, actorId: actor.discordId, actorName: actor.displayName, at: new Date().toISOString(), configuration: structuredClone(current.draft || current.published) })
    if (client) {
      await client.query('UPDATE wheel_catalog SET document = $2::jsonb WHERE id = $1', [id, JSON.stringify(current)])
      await client.query('COMMIT')
    } else { state.catalog[id] = current; save() }
    return current
  } catch (error) { if (client) await client.query('ROLLBACK'); throw error } finally { client?.release() }
}

module.exports = { initializeCatalog, listCatalog, getCatalog, changeCatalog }
