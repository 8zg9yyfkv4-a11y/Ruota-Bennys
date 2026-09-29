const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim()
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data')
const STATE_FILE = path.join(DATA_DIR, 'app-state.json')

let pool = null
let localState = null

function nowIso() {
  return new Date().toISOString()
}

function defaultState() {
  return {
    operators: [],
    sessions: [],
    sales: [],
    spins: [],
    audit: [],
    counters: { sale: 0, spin: 0, audit: 0 },
  }
}

function readLocalState() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  if (!fs.existsSync(STATE_FILE)) {
    localState = defaultState()
    saveLocalState()
    return
  }

  try {
    localState = { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
    localState.counters = { ...defaultState().counters, ...(localState.counters || {}) }
  } catch (error) {
    throw new Error(`Database locale non leggibile: ${error.message}`)
  }
}

function saveLocalState() {
  const temp = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, JSON.stringify(localState, null, 2), 'utf8')
  fs.renameSync(temp, STATE_FILE)
}

function mapOperator(row) {
  if (!row) return null
  return {
    discordId: String(row.discord_id),
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    role: row.role,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  }
}

function mapSale(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    code: row.code,
    wheel: row.wheel_id,
    wheelName: row.wheel_name,
    wheelSnapshot: row.wheel_snapshot,
    amount: Number(row.amount),
    status: row.status,
    operatorId: String(row.operator_id),
    operatorName: row.operator_name,
    createdAt: row.created_at,
    usedAt: row.used_at,
    playerId: row.player_id,
    prize: row.prize_details || (row.prize_id
      ? {
          id: row.prize_id,
          label: row.prize_label,
          emoji: row.prize_emoji,
          probability: Number(row.prize_probability),
        }
      : null),
    freeSpins: Number(row.free_spins || 0),
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by ? String(row.cancelled_by) : null,
    cancelReason: row.cancel_reason,
    previousStatus: row.previous_status || null,
    salesLogOk: Boolean(row.sales_log_ok),
    spinLogOk: Boolean(row.spin_log_ok),
  }
}

async function initializeStore() {
  if (!DATABASE_URL) {
    readLocalState()
    return { mode: 'json' }
  }

  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL)
      ? false
      : { rejectUnauthorized: false },
    max: 8,
  })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operators (
      discord_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL,
      user_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id BIGSERIAL PRIMARY KEY,
      code VARCHAR(4) UNIQUE NOT NULL,
      wheel_id TEXT NOT NULL,
      wheel_name TEXT NOT NULL,
      amount BIGINT NOT NULL CHECK (amount >= 0),
      status TEXT NOT NULL DEFAULT 'sold' CHECK (status IN ('sold', 'used', 'cancelled')),
      operator_id TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ,
      player_id TEXT,
      prize_id TEXT,
      prize_label TEXT,
      prize_emoji TEXT,
      prize_probability NUMERIC,
      free_spins INTEGER NOT NULL DEFAULT 0,
      cancelled_at TIMESTAMPTZ,
      cancelled_by TEXT,
      cancel_reason TEXT,
      sales_log_ok BOOLEAN NOT NULL DEFAULT FALSE,
      spin_log_ok BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_operator_id ON sales(operator_id);
    CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

    CREATE TABLE IF NOT EXISTS spins (
      id BIGSERIAL PRIMARY KEY,
      sale_id BIGINT NOT NULL REFERENCES sales(id),
      code VARCHAR(4) NOT NULL,
      player_id TEXT NOT NULL,
      wheel_id TEXT NOT NULL,
      wheel_name TEXT NOT NULL,
      prize_id TEXT NOT NULL,
      prize_label TEXT NOT NULL,
      prize_emoji TEXT,
      prize_probability NUMERIC NOT NULL,
      operator_id TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      is_free_spin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    DELETE FROM sessions WHERE expires_at <= NOW();
  `)

  return { mode: 'postgres' }
}

async function getHealth() {
  if (!pool) return { mode: 'json', ok: Boolean(localState) }
  const result = await pool.query('SELECT NOW() AS now')
  return { mode: 'postgres', ok: true, now: result.rows[0].now }
}

async function getOperator(discordId) {
  const id = String(discordId)
  if (!pool) return localState.operators.find((item) => item.discordId === id) || null
  const result = await pool.query('SELECT * FROM operators WHERE discord_id = $1', [id])
  return mapOperator(result.rows[0])
}

async function upsertOperator({ discordId, username, displayName, avatar, role, active = true, login = false }) {
  const timestamp = nowIso()
  const id = String(discordId)
  if (!pool) {
    let item = localState.operators.find((entry) => entry.discordId === id)
    if (item) {
      Object.assign(item, {
        username: username || item.username,
        displayName: displayName || item.displayName,
        avatar: avatar === undefined ? item.avatar : avatar,
        role: role || item.role,
        active: Boolean(active),
        updatedAt: timestamp,
        lastLoginAt: login ? timestamp : item.lastLoginAt,
      })
    } else {
      item = {
        discordId: id,
        username: username || id,
        displayName: displayName || username || id,
        avatar: avatar || null,
        role: role || 'operator',
        active: Boolean(active),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLoginAt: login ? timestamp : null,
      }
      localState.operators.push(item)
    }
    saveLocalState()
    return item
  }

  const result = await pool.query(
    `INSERT INTO operators
      (discord_id, username, display_name, avatar, role, active, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN NOW() ELSE NULL END)
     ON CONFLICT (discord_id) DO UPDATE SET
       username = EXCLUDED.username,
       display_name = EXCLUDED.display_name,
       avatar = EXCLUDED.avatar,
       role = EXCLUDED.role,
       active = EXCLUDED.active,
       updated_at = NOW(),
       last_login_at = CASE WHEN $7 THEN NOW() ELSE operators.last_login_at END
     RETURNING *`,
    [id, username || id, displayName || username || id, avatar || null, role || 'operator', Boolean(active), Boolean(login)]
  )
  return mapOperator(result.rows[0])
}

async function listOperators() {
  if (!pool) {
    return [...localState.operators].sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)))
  }
  const result = await pool.query('SELECT * FROM operators ORDER BY role, display_name')
  return result.rows.map(mapOperator)
}

async function setOperatorActive(discordId, active) {
  const id = String(discordId)
  if (!pool) {
    const item = localState.operators.find((entry) => entry.discordId === id)
    if (!item) return null
    item.active = Boolean(active)
    item.updatedAt = nowIso()
    saveLocalState()
    return item
  }
  const result = await pool.query(
    'UPDATE operators SET active = $2, updated_at = NOW() WHERE discord_id = $1 RETURNING *',
    [id, Boolean(active)]
  )
  return mapOperator(result.rows[0])
}

async function createSession({ tokenHash, discordId, user, expiresAt }) {
  if (!pool) {
    localState.sessions = localState.sessions.filter((item) => item.expiresAt > nowIso() && item.discordId !== String(discordId))
    localState.sessions.push({ tokenHash, discordId: String(discordId), user, expiresAt, createdAt: nowIso() })
    saveLocalState()
    return
  }
  await pool.query('DELETE FROM sessions WHERE expires_at <= NOW() OR discord_id = $1', [String(discordId)])
  await pool.query(
    'INSERT INTO sessions (token_hash, discord_id, user_json, expires_at) VALUES ($1, $2, $3::jsonb, $4)',
    [tokenHash, String(discordId), JSON.stringify(user), expiresAt]
  )
}

async function getSession(tokenHash) {
  if (!pool) {
    const item = localState.sessions.find((entry) => entry.tokenHash === tokenHash && entry.expiresAt > nowIso())
    return item ? item.user : null
  }
  const result = await pool.query(
    'SELECT user_json FROM sessions WHERE token_hash = $1 AND expires_at > NOW()',
    [tokenHash]
  )
  return result.rows[0]?.user_json || null
}

async function deleteSession(tokenHash) {
  if (!pool) {
    localState.sessions = localState.sessions.filter((item) => item.tokenHash !== tokenHash)
    saveLocalState()
    return
  }
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
}

async function createSales(items) {
  if (!pool) {
    const created = items.map((item) => {
      const sale = {
        ...item,
        id: ++localState.counters.sale,
        status: 'sold',
        createdAt: nowIso(),
        usedAt: null,
        playerId: null,
        prize: null,
        freeSpins: 0,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        salesLogOk: false,
        spinLogOk: false,
      }
      localState.sales.push(sale)
      return sale
    })
    saveLocalState()
    return created
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const created = []
    for (const item of items) {
      const result = await client.query(
        `INSERT INTO sales
          (code, wheel_id, wheel_name, amount, operator_id, operator_name, wheel_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING *`,
        [item.code, item.wheel, item.wheelName, item.amount, item.operatorId, item.operatorName, JSON.stringify(item.wheelSnapshot)]
      )
      created.push(mapSale(result.rows[0]))
    }
    await client.query('COMMIT')
    return created
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function markSalesLog(ids, ok) {
  const normalized = ids.map(Number)
  if (!pool) {
    localState.sales.forEach((item) => {
      if (normalized.includes(Number(item.id))) item.salesLogOk = Boolean(ok)
    })
    saveLocalState()
    return
  }
  await pool.query('UPDATE sales SET sales_log_ok = $2 WHERE id = ANY($1::bigint[])', [normalized, Boolean(ok)])
}

async function listSales({ operatorId = null, status = null, from = null, to = null, limit = 500 } = {}) {
  if (!pool) {
    return localState.sales
      .filter((item) => !operatorId || item.operatorId === String(operatorId))
      .filter((item) => !status || item.status === status)
      .filter((item) => !from || item.createdAt >= from)
      .filter((item) => !to || item.createdAt < to)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
  }

  const conditions = []
  const values = []
  if (operatorId) {
    values.push(String(operatorId)); conditions.push(`operator_id = $${values.length}`)
  }
  if (status) {
    values.push(status); conditions.push(`status = $${values.length}`)
  }
  if (from) {
    values.push(from); conditions.push(`created_at >= $${values.length}`)
  }
  if (to) {
    values.push(to); conditions.push(`created_at < $${values.length}`)
  }
  values.push(Number(limit))
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query(
    `SELECT * FROM sales ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
    values
  )
  return result.rows.map(mapSale)
}

async function getSaleByCode(code) {
  const clean = String(code).toUpperCase()
  if (!pool) return localState.sales.find((item) => item.code === clean) || null
  const result = await pool.query('SELECT * FROM sales WHERE code = $1', [clean])
  return mapSale(result.rows[0])
}

async function ensureSaleSnapshot(code, snapshot) {
  if (!pool) {
    const sale = localState.sales.find(item => item.code === code)
    if (!sale) return null
    sale.wheelSnapshot ||= structuredClone(snapshot)
    saveLocalState()
    return sale.wheelSnapshot
  }
  const result = await pool.query('UPDATE sales SET wheel_snapshot = COALESCE(wheel_snapshot, $2::jsonb) WHERE code = $1 RETURNING wheel_snapshot', [code, JSON.stringify(snapshot)])
  return result.rows[0]?.wheel_snapshot
}

async function recordSpin({ code, gameId, wheel, prize, isFreeSpin }) {
  const clean = String(code).toUpperCase()
  const timestamp = nowIso()

  if (!pool) {
    const sale = localState.sales.find((item) => item.code === clean)
    if (!sale || sale.status !== 'sold') return null
    sale.playerId = gameId
    sale.freeSpins = Number(sale.freeSpins || 0) + (isFreeSpin ? 1 : 0)
    if (!isFreeSpin) {
      sale.status = 'used'
      sale.prize = prize
      sale.usedAt = timestamp
    }
    localState.spins.push({
      id: ++localState.counters.spin,
      saleId: sale.id,
      code: clean,
      playerId: gameId,
      wheel: sale.wheel,
      wheelName: wheel.name,
      prize,
      operatorId: sale.operatorId,
      operatorName: sale.operatorName,
      isFreeSpin,
      createdAt: timestamp,
    })
    saveLocalState()
    return { sale, spunAt: timestamp }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query('SELECT * FROM sales WHERE code = $1 FOR UPDATE', [clean])
    const sale = mapSale(locked.rows[0])
    if (!sale || sale.status !== 'sold') {
      await client.query('ROLLBACK')
      return null
    }
    const updated = await client.query(
      `UPDATE sales SET
        status = CASE WHEN $2 THEN 'sold' ELSE 'used' END,
        player_id = $3,
        used_at = CASE WHEN $2 THEN NULL ELSE NOW() END,
        prize_id = CASE WHEN $2 THEN NULL ELSE $4 END,
        prize_label = CASE WHEN $2 THEN NULL ELSE $5 END,
        prize_emoji = CASE WHEN $2 THEN NULL ELSE $6 END,
        prize_probability = CASE WHEN $2 THEN NULL ELSE $7::numeric END,
        prize_details = CASE WHEN $2 THEN NULL ELSE $8::jsonb END,
        free_spins = free_spins + CASE WHEN $2 THEN 1 ELSE 0 END
       WHERE id = $1 RETURNING *`,
      [sale.id, Boolean(isFreeSpin), gameId, prize.id, prize.label, prize.emoji || '', Number(prize.probability), JSON.stringify(prize)]
    )
    await client.query(
      `INSERT INTO spins
        (sale_id, code, player_id, wheel_id, wheel_name, prize_id, prize_label, prize_emoji, prize_probability, operator_id, operator_name, is_free_spin, prize_details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [sale.id, clean, gameId, sale.wheel, wheel.name, prize.id, prize.label, prize.emoji || '', Number(prize.probability), sale.operatorId, sale.operatorName, Boolean(isFreeSpin), JSON.stringify(prize)]
    )
    await client.query('COMMIT')
    const saved = mapSale(updated.rows[0])
    return { sale: saved, spunAt: saved.usedAt || timestamp }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function markSpinLog(saleId, ok) {
  if (!pool) {
    const sale = localState.sales.find((item) => Number(item.id) === Number(saleId))
    if (sale) sale.spinLogOk = Boolean(ok)
    saveLocalState()
    return
  }
  await pool.query('UPDATE sales SET spin_log_ok = $2 WHERE id = $1', [Number(saleId), Boolean(ok)])
}

async function cancelSale({ id, actorId, reason }) {
  if (!pool) {
    const sale = localState.sales.find((item) => Number(item.id) === Number(id))
    if (!sale || !['sold', 'used'].includes(sale.status)) return null
    const previousStatus = sale.status
    sale.status = 'cancelled'
    sale.cancelledAt = nowIso()
    sale.cancelledBy = String(actorId)
    sale.cancelReason = reason
    saveLocalState()
    return { ...sale, previousStatus }
  }
  const result = await pool.query(
    `WITH target AS (
       SELECT id, status AS previous_status
       FROM sales
       WHERE id = $1 AND status IN ('sold', 'used')
       FOR UPDATE
     )
     UPDATE sales
     SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2, cancel_reason = $3
     FROM target
     WHERE sales.id = target.id
     RETURNING sales.*, target.previous_status`,
    [Number(id), String(actorId), reason]
  )
  return mapSale(result.rows[0])
}

async function addAudit({ actorId, actorName, action, targetType, targetId = null, details = {} }) {
  if (!pool) {
    localState.audit.push({
      id: ++localState.counters.audit,
      actorId: String(actorId), actorName, action, targetType, targetId, details, createdAt: nowIso(),
    })
    saveLocalState()
    return
  }
  await pool.query(
    `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [String(actorId), actorName, action, targetType, targetId ? String(targetId) : null, JSON.stringify(details)]
  )
}

module.exports = {
  ensureSaleSnapshot,
  catalogStorage: () => ({ pool, state: localState, save: saveLocalState }),
  addAudit,
  cancelSale,
  createSales,
  createSession,
  deleteSession,
  getHealth,
  getOperator,
  getSaleByCode,
  getSession,
  initializeStore,
  listOperators,
  listSales,
  markSalesLog,
  markSpinLog,
  recordSpin,
  setOperatorActive,
  upsertOperator,
}
