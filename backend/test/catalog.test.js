const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-catalog-test-'))
process.env.DATA_DIR = directory
process.env.AUTH_DEV_MODE = 'true'
process.env.NODE_ENV = 'test'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.CLIENT_ORIGIN = process.env.FRONTEND_URL
process.env.DISCORD_SALES_WEBHOOK_URL = ''
process.env.DISCORD_SPIN_WEBHOOK_URL = ''
let engine
if (process.env.TEST_POSTGRES === 'true') {
  const { PGlite } = require('@electric-sql/pglite')
  engine = new PGlite()
  let queue = Promise.resolve()
  const query = async (sql, values) => values ? engine.query(sql, values) : (await engine.exec(sql)).at(-1)
  class Pool {
    query(sql, values) { return query(sql, values) }
    async connect() {
      let release
      const previous = queue
      queue = new Promise(resolve => { release = resolve })
      await previous
      return { query, release }
    }
  }
  require('pg').Pool = Pool
  process.env.DATABASE_URL = 'postgres://localhost/test'
} else process.env.DATABASE_URL = ''

const store = require('../store')
const catalog = require('../catalog-store')
const { normalizeWheel, drawPrize } = require('../catalog')
const { app, wheels } = require('../server')

function noSecrets(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!['probability', 'cost', 'amountPrivate', 'wheelSnapshot', 'draft', 'history', 'prize_details'].includes(key), `Leaked ${key}`)
    noSecrets(item)
  }
}

test('catalog lifecycle, permissions, SQL migration and code snapshots', async t => {
  await store.initializeStore()
  // A real pre-migration sale: no snapshot column exists in the SQL schema yet.
  if (engine) await engine.query("INSERT INTO sales (code,wheel_id,wheel_name,amount,operator_id,operator_name) VALUES ('OLD1','10000','Old wheel',10000,'test','test')")
  else {
    const { state, save } = store.catalogStorage()
    state.sales.push({ id: 1, code: 'OLD1', wheel: '10000', wheelName: 'Old wheel', amount: 10000, status: 'sold', operatorId: 'test', operatorName: 'test' })
    state.counters.sale = 1; save()
  }
  await catalog.initializeCatalog(wheels)
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (url, { body, cookie, origin = process.env.FRONTEND_URL } = {}) => {
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const owner = (await request('/api/auth/dev', { body: { discordId: '829152894632460329' } })).cookie
  const operator = (await request('/api/auth/dev', { body: { discordId: '123456789012345678', role: 'operator' } })).cookie
  const direction = (await request('/api/auth/dev', { body: { discordId: '223456789012345678', role: 'admin' } })).cookie
  let current = await catalog.getCatalog('10000')
  const change = (action, extra = {}, cookie = owner) => request(`/api/admin/wheels/10000/${action}`, { cookie, body: { revision: current.revision, ...extra } })
  let oldCode, newCode
  try {
    await t.test('only owner can read or write private catalog, including CSRF rejection', async () => {
      assert.equal((await request('/api/admin/wheels')).status, 401)
      for (const cookie of [operator, direction]) {
        assert.equal((await request('/api/admin/wheels', { cookie })).status, 403)
        assert.equal((await change('draft', { configuration: current.published }, cookie)).status, 403)
      }
      assert.equal((await request('/api/admin/wheels', { cookie: owner })).status, 200)
      assert.equal((await request('/api/admin/wheels/10000/draft', { cookie: owner, origin: 'https://untrusted.example', body: { revision: 1, configuration: current.published } })).status, 403)
      assert.equal((await request('/api/auth/me', { cookie: direction })).data.user.canManageWheels, false)
    })
    await t.test('public wheel list and existing legacy code have no private fields', async () => {
      const response = await request('/api/wheels')
      assert.equal(response.data.wheels.length, 7); noSecrets(response.data)
      const legacy = await request('/api/codes/verify', { body: { code: 'OLD1' } })
      assert.equal(legacy.data.configuration.prizes.length, 6); noSecrets(legacy.data)
      const sale = await request('/api/sales', { cookie: operator, body: { wheel: '10000' } })
      assert.equal(sale.status, 201); noSecrets(sale.data); oldCode = sale.data.sales[0].code
    })
    await t.test('invalid total can be drafted but not published, original stays public', async () => {
      const draft = structuredClone(current.published); draft.prizes[0].probability = 34
      const result = await change('draft', { configuration: draft }); assert.equal(result.status, 200); current = result.data.wheel
      assert.equal((await change('publish')).status, 400)
      assert.equal((await catalog.getCatalog('10000')).published.prizes[0].probability, 35)
      for (const value of [-1, 100.001, null, '']) {
        const invalid = structuredClone(draft); invalid.prizes[0].probability = value
        assert.throws(() => normalizeWheel(invalid), undefined, `Accepted invalid probability ${value}`)
      }
      const duplicate = structuredClone(draft); duplicate.prizes[1].id = duplicate.prizes[0].id
      assert.throws(() => normalizeWheel(duplicate))
    })
    await t.test('publish new prize catalog; old codes keep original configuration', async () => {
      const configuration = { name: current.published.name, price: 10000, prizes: [
        { id: 'new-cash', label: 'New cash prize', emoji: '💎', type: 'cash', probability: 100, amount: 4321, cost: 1234 },
        { id: 'zero', label: 'Zero weight', emoji: '❌', type: 'none', probability: 0, amount: 0, cost: 0 },
      ] }
      current = (await change('draft', { configuration })).data.wheel
      const result = await change('publish'); assert.equal(result.status, 200); current = result.data.wheel
      assert.equal(current.version, 2)
      for (const code of [oldCode, 'OLD1']) {
        const verify = await request('/api/codes/verify', { body: { code } })
        assert.equal(verify.data.configuration.prizes[0].id, 'nothing'); noSecrets(verify.data)
      }
      const response = await request('/api/sales', { cookie: operator, body: { wheel: '10000' } })
      newCode = response.data.sales[0].code
      const verify = await request('/api/codes/verify', { body: { code: newCode } })
      assert.equal(verify.data.configuration.prizes[0].id, 'new-cash'); noSecrets(verify.data)
    })
    await t.test('draw ignores zero weights, duplicate spin blocked, costs frozen privately', async () => {
      const results = await Promise.all([1, 2].map(() => request('/api/codes/spin', { body: { code: newCode, gameId: 'TEST' } })))
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
      const success = results.find(r => r.status === 200)
      assert.equal(success.data.prize.id, 'new-cash'); noSecrets(success.data)
      const saved = await store.getSaleByCode(newCode)
      assert.equal(saved.prize.cost, 1234); assert.equal(saved.prize.amount, 4321)
      noSecrets((await request('/api/sales', { cookie: direction })).data)
      noSecrets((await request('/api/sales', { cookie: operator })).data)
    })
    await t.test('direction can reverse a used spin and analytics exclude its revenue', async () => {
      const query = '/api/analytics?from=2020-01-01T00%3A00%3A00.000Z&to=2100-01-01T00%3A00%3A00.000Z&groupBy=day'
      const before = (await request(query, { cookie: direction })).data.totals
      const denied = await request(`/api/sales/${(await store.getSaleByCode(newCode)).id}/cancel`, {
        cookie: operator,
        body: { reason: 'Operator must not reverse spins' },
      })
      assert.equal(denied.status, 403)

      const savedBefore = await store.getSaleByCode(newCode)
      const reversed = await request(`/api/sales/${savedBefore.id}/cancel`, {
        cookie: direction,
        body: { reason: 'Prize delivery test failed' },
      })
      assert.equal(reversed.status, 200)
      assert.equal(reversed.data.previousStatus, 'used')
      assert.equal(reversed.data.sale.status, 'cancelled')
      assert.equal(reversed.data.sale.playerId, 'TEST')
      assert.equal(reversed.data.sale.prize.id, 'new-cash')
      assert.deepEqual(reversed.data.discordLogs, { sales: false, spin: false })
      noSecrets(reversed.data)

      const after = (await request(query, { cookie: direction })).data.totals
      assert.equal(after.revenue, before.revenue - savedBefore.amount)
      assert.equal(after.sales, before.sales - 1)
      assert.equal(after.used, before.used - 1)
      assert.equal(after.cancelled, before.cancelled + 1)
      assert.equal((await request(`/api/sales/${savedBefore.id}/cancel`, { cookie: direction, body: { reason: 'Again' } })).status, 409)
    })
    await t.test('stale update rejected, history recovery stays draft and survives initialization', async () => {
      const responses = await Promise.all([1, 2].map(() => change('draft', { configuration: current.published })))
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
      current = responses.find(r => r.status === 200).data.wheel
      current = (await change('restore', { version: 1 })).data.wheel
      assert.equal(current.draft.prizes[0].id, 'nothing')
      assert.equal(current.published.prizes[0].id, 'new-cash')
      if (!engine) await store.initializeStore()
      await catalog.initializeCatalog(wheels)
      current = await catalog.getCatalog('10000')
      assert.equal(current.published.prizes[0].id, 'new-cash')
      assert.equal(current.draft.prizes[0].id, 'nothing')
      assert.ok(current.history.some(h => h.actorId === '829152894632460329'))
      assert.equal((await store.getSaleByCode(newCode)).prize.cost, 1234)
      current = (await change('publish')).data.wheel
      assert.equal(current.version, 3)
      assert.equal((await store.getSaleByCode(newCode)).wheelSnapshot.prizes[0].id, 'new-cash')
    })
    await t.test('all random interval boundaries follow exact configured weights', () => {
      const crypto = require('crypto'); const original = crypto.randomInt
      const prizes = [{ id: 'a', probability: 0 }, { id: 'b', probability: .1 }, { id: 'c', probability: 99.9 }]
      try {
        for (const [value, expected] of [[0, 'b'], [9, 'b'], [10, 'c'], [9999, 'c']]) {
          crypto.randomInt = () => value
          assert.equal(drawPrize(prizes).id, expected)
        }
      } finally { crypto.randomInt = original }
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
    if (engine) await engine.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
