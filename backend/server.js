const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const crypto = require('crypto')

dotenv.config()

const store = require('./store')
const catalog = require('./catalog-store')
const { publicPrize, publicWheel, publicSale, drawPrize, seedWheel } = require('./catalog')

const app = express()
const PORT = Number(process.env.PORT) || 3001
const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
const CLIENT_ORIGINS = String(process.env.CLIENT_ORIGIN || FRONTEND_URL)
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)
if (process.env.COMMAND_CENTER_URL) CLIENT_ORIGINS.push(String(process.env.COMMAND_CENTER_URL).replace(/\/$/, ''))
const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || '').trim()
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim()
const DISCORD_BOT_TOKEN = String(process.env.DISCORD_BOT_TOKEN || '').trim()
const DISCORD_GUILD_ID = String(process.env.DISCORD_GUILD_ID || '1514541784628203581')
const DISCORD_OWNER_ID = String(process.env.DISCORD_OWNER_ID || '829152894632460329')
const DISCORD_DIRECTION_ROLE_ID = String(process.env.DISCORD_DIRECTION_ROLE_ID || '1514542233842487426')
const DISCORD_REDIRECT_URI = String(
  process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/api/auth/discord/callback`
)
const DISCORD_SALES_WEBHOOK_URL = String(process.env.DISCORD_SALES_WEBHOOK_URL || '').trim()
const DISCORD_SPIN_WEBHOOK_URL = String(process.env.DISCORD_SPIN_WEBHOOK_URL || '').trim()
const SESSION_SECRET = String(process.env.SESSION_SECRET || 'dev-only-change-me')
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000
const COOKIE_NAME = 'lsc_session'
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || FRONTEND_URL.startsWith('https://')
const AUTH_DEV_MODE = process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_MODE === 'true'

const wheels = {
  '10000': {
    name: 'RUOTA STARTER $10.000', price: 10000,
    prizes: [
      { id: 'nothing', label: 'Niente', emoji: '❌', probability: 35 },
      { id: 'food-drink-10', label: 'Pacco Cibo + Bevande x10', emoji: '🍔', probability: 25 },
      { id: 'ammo-9mm-50', label: '50 Munizioni 9mm', emoji: '📦', probability: 17 },
      { id: 'kit-3', label: '3 Kit Riparazione', emoji: '🧰', probability: 13 },
      { id: 'cash-5000', label: '$5.000', emoji: '💵', probability: 9.9 },
      { id: 'auto-100k-200k', label: 'Auto fascia $100.000 - $200.000', emoji: '🚗', probability: 0.1 },
    ],
  },
  '20000': {
    name: 'RUOTA BRONZE $20.000', price: 20000,
    prizes: [
      { id: 'nothing', label: 'Niente', emoji: '❌', probability: 30 },
      { id: 'food-drink-20', label: 'Pacco Cibo + Bevande x20', emoji: '🍔', probability: 24 },
      { id: 'ammo-9mm-100', label: '100 Munizioni 9mm', emoji: '📦', probability: 20 },
      { id: 'kit-8', label: '8 Kit Riparazione', emoji: '🧰', probability: 15 },
      { id: 'cash-15000', label: '$15.000', emoji: '💵', probability: 10.9 },
      { id: 'auto-200k-400k', label: 'Auto fascia $200.000 - $400.000', emoji: '🚗', probability: 0.1 },
    ],
  },
  '50000': {
    name: 'RUOTA SILVER $50.000', price: 50000,
    prizes: [
      { id: 'nothing', label: 'Niente', emoji: '❌', probability: 27 },
      { id: 'ammo-9mm-200', label: '200 Munizioni 9mm', emoji: '📦', probability: 25 },
      { id: 'kit-15', label: '15 Kit Riparazione', emoji: '🧰', probability: 23 },
      { id: 'cash-30000', label: '$30.000', emoji: '💵', probability: 24.4 },
      { id: 'pistol-9mm', label: 'Pistola 9mm', emoji: '🔫', probability: 0.5 },
      { id: 'auto-400k-650k', label: 'Auto fascia $400.000 - $650.000', emoji: '🚗', probability: 0.1 },
    ],
  },
  '100000': {
    name: 'RUOTA GOLD $100.000', price: 100000,
    prizes: [
      { id: 'paint-clean-special', label: 'Verniciatura speciale + Pulizia', emoji: '🎨', probability: 30 },
      { id: 'ammo-9mm-300', label: '300 Munizioni 9mm', emoji: '📦', probability: 26 },
      { id: 'kit-25', label: '25 Kit Riparazione', emoji: '🧰', probability: 23 },
      { id: 'cash-60000', label: '$60.000', emoji: '💵', probability: 20.4 },
      { id: 'pistol-9mm', label: 'Pistola 9mm', emoji: '🔫', probability: 0.5 },
      { id: 'auto-650k-950k', label: 'Auto fascia $650.000 - $950.000', emoji: '🏎️', probability: 0.1 },
    ],
  },
  '150000': {
    name: 'RUOTA PLATINUM $150.000', price: 150000,
    prizes: [
      { id: 'ammo-9mm-500', label: '500 Munizioni 9mm', emoji: '📦', probability: 30 },
      { id: 'kit-40', label: '40 Kit Riparazione', emoji: '🧰', probability: 27 },
      { id: 'cash-100000', label: '$100.000', emoji: '💵', probability: 23 },
      { id: 'fullkit-free', label: 'Full Kit Auto gratuito', emoji: '🔧', probability: 19.4 },
      { id: 'pistol-250-ammo', label: 'Pistola 9mm + 250 Munizioni', emoji: '🔫', probability: 0.5 },
      { id: 'auto-950k-1250k', label: 'Auto fascia $950.000 - $1.250.000', emoji: '🏎️', probability: 0.1 },
    ],
  },
  '250000': {
    name: 'RUOTA DIAMOND $250.000', price: 250000,
    prizes: [
      { id: 'ammo-9mm-1000', label: '1.000 Munizioni 9mm', emoji: '📦', probability: 29 },
      { id: 'kit-75', label: '75 Kit Riparazione', emoji: '🧰', probability: 27 },
      { id: 'cash-175000', label: '$175.000', emoji: '💵', probability: 24 },
      { id: 'fullkit-premium', label: 'Full Kit Premium', emoji: '🔧', probability: 19.4 },
      { id: 'pistol-500-ammo', label: 'Pistola 9mm + 500 Munizioni', emoji: '🔫', probability: 0.5 },
      { id: 'auto-1250k-1600k', label: 'Auto fascia $1.250.000 - $1.600.000', emoji: '🚘', probability: 0.1 },
    ],
  },
  '500000': {
    name: 'RUOTA JACKPOT $500.000', price: 500000,
    prizes: [
      { id: 'cash-250000', label: '$250.000', emoji: '💵', probability: 32 },
      { id: 'kit-150', label: '150 Kit Riparazione', emoji: '🧰', probability: 27 },
      { id: 'ammo-9mm-1000', label: '1.000 Munizioni 9mm', emoji: '📦', probability: 22 },
      { id: 'lsc-experience', label: 'FULL ARMERIA PALETO EXPERIENCE', emoji: '👑', probability: 18.4 },
      { id: 'pistol-1000-ammo', label: 'Pistola 9mm + 1.000 Munizioni', emoji: '🔫', probability: 0.5 },
      { id: 'auto-1600k-2000k', label: 'Auto fascia $1.600.000 - $2.000.000', emoji: '🏆', probability: 0.1 },
    ],
  },
}

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || CLIENT_ORIGINS.includes(origin.replace(/\/$/, '')))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}))
app.use(express.json({ limit: '40kb' }))
// Forward rejected route promises to Express 4's error middleware.
for (const method of ['get', 'post', 'patch']) {
  const register = app[method].bind(app)
  app[method] = (path, ...handlers) => handlers.length
    ? register(path, ...handlers.map(handler => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next)))
    : register(path)
}
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })


function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').map((part) => part.trim().split('='))
    .reduce((cookies, [key, ...value]) => {
      if (key) cookies[key] = decodeURIComponent(value.join('='))
      return cookies
    }, {})
}

function sessionCookie(value, maxAge) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${IS_PRODUCTION ? 'None' : 'Lax'}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`,
  ]
  if (IS_PRODUCTION) parts.push('Secure')
  return parts.join('; ')
}

function oauthCookie(value, maxAge) {
  const parts = [
    `lsc_oauth_state=${encodeURIComponent(value)}`,
    'Path=/api/auth/discord',
    'HttpOnly',
    `SameSite=${IS_PRODUCTION ? 'None' : 'Lax'}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`,
  ]
  if (IS_PRODUCTION) parts.push('Secure')
  return parts.join('; ')
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function signState(nonce) {
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(nonce).digest('hex')
  return `${nonce}.${signature}`
}

function verifyState(value) {
  const [nonce, signature] = String(value || '').split('.')
  if (!nonce || !signature) return false
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(nonce).digest('hex')
  const receivedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
}

function safeText(value, max = 256) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, max)
}

function generateCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () => characters[crypto.randomInt(characters.length)]).join('')
}

async function discordRequest(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = {} }
    if (!response.ok) {
      const error = new Error(data.message || `Discord HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

async function sendWebhook(webhookUrl, payload) {
  if (!webhookUrl) return false
  try {
    await discordRequest(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
    })
    return true
  } catch (error) {
    console.error('Webhook Discord non riuscito:', error.message)
    return false
  }
}

async function sendSaleLog(sales, actor) {
  const total = sales.reduce((sum, sale) => sum + sale.amount, 0)
  const codes = sales.map((sale) => `\`${sale.code}\``).join(' • ')
  return sendWebhook(DISCORD_SALES_WEBHOOK_URL, {
    username: 'ARMERIA PALETO • Log Fatture',
    embeds: [{
      title: '🧾 Nuova vendita Ruota della Fortuna', color: 0x1687ff,
      fields: [
        { name: 'Dipendente', value: `${actor.displayName}\n<@${actor.discordId}>`, inline: true },
        { name: 'Ruota', value: sales[0].wheelName, inline: true },
        { name: 'Totale vendita', value: `$${total.toLocaleString('it-IT')}`, inline: true },
        { name: sales.length > 1 ? 'Codici emessi' : 'Codice emesso', value: codes },
      ],
      timestamp: sales[0].createdAt,
      footer: { text: 'ARMERIA PALETO • Vendita registrata nel database' },
    }],
  })
}

async function sendSaleCancellationLog(sale, actor) {
  const wasUsed = sale.previousStatus === 'used'
  return sendWebhook(DISCORD_SALES_WEBHOOK_URL, {
    username: 'ARMERIA PALETO • Log Fatture',
    embeds: [{
      title: wasUsed ? '↩️ Giro stornato dal fatturato' : '⛔ Vendita annullata', color: 0xe5484d,
      fields: [
        { name: 'Codice', value: `\`${sale.code}\``, inline: true },
        { name: 'Importo rimosso', value: `$${sale.amount.toLocaleString('it-IT')}`, inline: true },
        { name: 'Stato precedente', value: wasUsed ? 'Giro già effettuato' : 'Codice disponibile', inline: true },
        { name: 'Annullata da', value: `${actor.displayName}\n<@${actor.discordId}>`, inline: true },
        { name: 'Motivo', value: sale.cancelReason || 'Non specificato' },
      ],
      timestamp: sale.cancelledAt,
      footer: { text: 'ARMERIA PALETO • Importo escluso da fatturato e statistiche' },
    }],
  })
}

async function sendSpinCancellationLog(sale, actor) {
  if (sale.previousStatus !== 'used') return null
  return sendWebhook(DISCORD_SPIN_WEBHOOK_URL, {
    username: 'ARMERIA PALETO • Log Ruota',
    embeds: [{
      title: '↩️ Risultato della ruota annullato', color: 0xe5484d,
      fields: [
        { name: 'ID In Game', value: sale.playerId || 'Non disponibile', inline: true },
        { name: 'Codice', value: `\`${sale.code}\``, inline: true },
        { name: 'Ruota', value: sale.wheelName, inline: false },
        { name: 'Premio annullato', value: sale.prize ? `${sale.prize.emoji || '🎁'} ${sale.prize.label}` : 'Non disponibile', inline: false },
        { name: 'Annullato da', value: `${actor.displayName}\n<@${actor.discordId}>`, inline: true },
        { name: 'Motivo', value: sale.cancelReason || 'Non specificato' },
      ],
      timestamp: sale.cancelledAt,
      footer: { text: 'ARMERIA PALETO • Il risultato originale resta nel database per audit' },
    }],
  })
}

async function sendSpinLog({ sale, gameId, prize, spunAt }) {
  return sendWebhook(DISCORD_SPIN_WEBHOOK_URL, {
    username: 'ARMERIA PALETO • Log Ruota',
    embeds: [{
      title: '🎡 Nuovo giro della ruota', color: 0x20b7ff,
      fields: [
        { name: 'ID In Game', value: gameId, inline: true },
        { name: 'Codice', value: `\`${sale.code}\``, inline: true },
        { name: 'Ruota', value: sale.wheelName, inline: false },
        { name: 'Premio', value: `${prize.emoji || '🎁'} ${prize.label}`, inline: false },
        { name: 'Venduto da', value: `${sale.operatorName}\n<@${sale.operatorId}>`, inline: false },
      ],
      timestamp: spunAt,
      footer: { text: 'ARMERIA PALETO • Risultato salvato nel database' },
    }],
  })
}

async function requireSession(req, res, next) {
  try {
    const token = parseCookies(req)[COOKIE_NAME]
    if (!token) return res.status(401).json({ success: false, message: 'Accedi con Discord per continuare.' })
    const sessionUser = await store.getSession(hashToken(token))
    if (!sessionUser) return res.status(401).json({ success: false, message: 'Sessione scaduta. Accedi di nuovo.' })
    const operator = await store.getOperator(sessionUser.discordId)
    if (!operator?.active) {
      await store.deleteSession(hashToken(token))
      return res.status(401).json({ success: false, message: 'Accesso operatore disattivato.' })
    }
    req.user = publicUser(operator)
    req.sessionToken = token
    return next()
  } catch (error) {
    console.error('Verifica sessione non riuscita:', error.message)
    return res.status(503).json({ success: false, message: 'Sessione temporaneamente non disponibile.' })
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Operazione riservata a Proprietario e Direzione.' })
  }
  return next()
}

function publicUser(operator) {
  return {
    discordId: operator.discordId,
    username: operator.username,
    displayName: operator.displayName,
    avatar: operator.avatar,
    role: operator.role,
    canManageWheels: operator.discordId === DISCORD_OWNER_ID,
  }
}

app.get('/api/status', async (req, res) => {
  try {
    const database = await store.getHealth()
    res.json({
      success: true,
      message: 'ARMERIA PALETO Ruota della Fortuna online',
      database,
      discord: {
        oauthConfigured: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET),
        salesWebhookConfigured: Boolean(DISCORD_SALES_WEBHOOK_URL),
        spinWebhookConfigured: Boolean(DISCORD_SPIN_WEBHOOK_URL),
      },
    })
  } catch {
    res.status(503).json({ success: false, message: 'Database non disponibile.' })
  }
})

const ccAuth = require('./command-center-auth').createCommandCenterAuth({app, secret:process.env.COMMAND_CENTER_SSO_KEY, publicUrl:process.env.COMMAND_CENTER_URL})

app.get('/api/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.status(503).send('Login Discord non ancora configurato su Render.')
  }
  const ccState = req.query.app === 'command-center' && ccAuth.enabled && /^[A-Za-z0-9_-]{32,128}$/.test(String(req.query.cc_state || '')) ? String(req.query.cc_state) : null
  const signedState = signState((ccState ? `cc:${ccState}:` : '') + crypto.randomBytes(24).toString('hex'))
  res.setHeader('Set-Cookie', oauthCookie(signedState, 10 * 60 * 1000))
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state: signedState,
  })
  return res.redirect(`https://discord.com/oauth2/authorize?${params}`)
})

app.get('/api/auth/discord/callback', async (req, res) => {
  const cookies = parseCookies(req)
  const state = String(req.query.state || '')
  const authError = String(req.query.error || '')
  res.setHeader('Set-Cookie', oauthCookie('', 0))
  if (authError) return res.redirect(`${FRONTEND_URL}/admin?auth=cancelled`)
  if (!state || state !== cookies.lsc_oauth_state || !verifyState(state)) {
    return res.redirect(`${FRONTEND_URL}/admin?auth=invalid_state`)
  }

  try {
    const token = await discordRequest('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(req.query.code || ''),
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    })
    const discordUser = await discordRequest('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    const discordId = String(discordUser.id)
    let roles = []
    let guildDisplayName = discordUser.global_name || discordUser.username
    if (DISCORD_BOT_TOKEN) {
      try {
        const member = await discordRequest(
          `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}`,
          { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
        )
        roles = Array.isArray(member.roles) ? member.roles.map(String) : []
        guildDisplayName = member.nick || discordUser.global_name || discordUser.username
      } catch (error) {
        if (discordId !== DISCORD_OWNER_ID) console.warn(`Verifica membro Discord ${discordId} fallita: ${error.message}`)
      }
    }

    const existing = await store.getOperator(discordId)
    const isAdmin = discordId === DISCORD_OWNER_ID || roles.includes(DISCORD_DIRECTION_ROLE_ID)
    const allowed = isAdmin || Boolean(existing?.active && existing.role === 'operator')
    const ccState = state.startsWith('cc:') ? state.split(':')[1] : null
    if (ccState && ccAuth.enabled) {
      // Membership and exact bot permissions are independently checked by the
      // Command Center bridge; this path never grants wheel operator access.
      let wheelToken = null
      if (allowed) {
        const operator = await store.upsertOperator({discordId,username:discordUser.username,displayName:guildDisplayName,
          avatar:discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png` : null,
          role:isAdmin ? 'admin' : 'operator',active:true,login:true})
        wheelToken=crypto.randomBytes(48).toString('base64url')
        await store.createSession({tokenHash:hashToken(wheelToken),discordId,user:publicUser(operator),
          expiresAt:new Date(Date.now()+SESSION_DURATION_MS).toISOString()})
      }
      return ccAuth.complete(res,{id:discordId,state:ccState,wheel_token:wheelToken})
    }
    if (!allowed) return res.redirect(`${FRONTEND_URL}/admin?auth=forbidden`)

    const avatar = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png?size=128`
      : null
    const operator = await store.upsertOperator({
      discordId,
      username: discordUser.username,
      displayName: guildDisplayName,
      avatar,
      role: isAdmin ? 'admin' : 'operator',
      active: true,
      login: true,
    })
    const sessionToken = crypto.randomBytes(48).toString('base64url')
    await store.createSession({
      tokenHash: hashToken(sessionToken),
      discordId,
      user: publicUser(operator),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    })
    res.setHeader('Set-Cookie', sessionCookie(sessionToken, SESSION_DURATION_MS))
    await store.addAudit({ actorId: discordId, actorName: operator.displayName, action: 'login', targetType: 'session' })
    return res.redirect(`${FRONTEND_URL}/admin?auth=success`)
  } catch (error) {
    console.error('Login Discord fallito:', error.message)
    return res.redirect(`${FRONTEND_URL}/admin?auth=error`)
  }
})

if (AUTH_DEV_MODE) {
  app.post('/api/auth/dev', async (req, res) => {
    const discordId = safeText(req.body.discordId || DISCORD_OWNER_ID, 32)
    const role = req.body.role === 'operator' ? 'operator' : 'admin'
    const operator = await store.upsertOperator({
      discordId,
      username: safeText(req.body.username || 'test-user', 64),
      displayName: safeText(req.body.displayName || 'Test User', 64),
      avatar: null, role, active: true, login: true,
    })
    const sessionToken = crypto.randomBytes(48).toString('base64url')
    await store.createSession({
      tokenHash: hashToken(sessionToken), discordId, user: publicUser(operator),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    })
    res.setHeader('Set-Cookie', sessionCookie(sessionToken, SESSION_DURATION_MS))
    res.json({ success: true, user: publicUser(operator) })
  })
}

app.get('/api/auth/me', requireSession, (req, res) => {
  res.json({ success: true, user: req.user })
})

app.post('/api/auth/logout', requireSession, async (req, res) => {
  await store.deleteSession(hashToken(req.sessionToken))
  res.setHeader('Set-Cookie', sessionCookie('', 0))
  res.json({ success: true })
})

app.get('/api/operators', requireSession, requireAdmin, async (req, res) => {
  res.json({ success: true, operators: await store.listOperators() })
})

app.post('/api/operators', requireSession, requireAdmin, async (req, res) => {
  const discordId = safeText(req.body.discordId, 32)
  const displayName = safeText(req.body.displayName || discordId, 64)
  if (!/^\d{16,22}$/.test(discordId)) {
    return res.status(400).json({ success: false, message: 'Inserisci un ID Discord valido.' })
  }
  if (discordId === DISCORD_OWNER_ID) {
    return res.status(400).json({ success: false, message: 'Il Proprietario possiede già i permessi completi.' })
  }
  const existing = await store.getOperator(discordId)
  if (existing?.role === 'admin') {
    return res.status(400).json({ success: false, message: 'Questo membro appartiene già alla Direzione.' })
  }
  const operator = await store.upsertOperator({
    discordId, username: displayName, displayName, avatar: null, role: 'operator', active: true,
  })
  await store.addAudit({
    actorId: req.user.discordId, actorName: req.user.displayName, action: 'operator.create',
    targetType: 'operator', targetId: discordId, details: { displayName },
  })
  res.status(201).json({ success: true, operator })
})

app.patch('/api/operators/:discordId', requireSession, requireAdmin, async (req, res) => {
  const discordId = safeText(req.params.discordId, 32)
  const existing = await store.getOperator(discordId)
  if (discordId === DISCORD_OWNER_ID || discordId === req.user.discordId || existing?.role === 'admin') {
    return res.status(400).json({ success: false, message: 'Non puoi disattivare questo account amministrativo.' })
  }
  const operator = await store.setOperatorActive(discordId, Boolean(req.body.active))
  if (!operator) return res.status(404).json({ success: false, message: 'Dipendente non trovato.' })
  await store.addAudit({
    actorId: req.user.discordId, actorName: req.user.displayName,
    action: operator.active ? 'operator.enable' : 'operator.disable', targetType: 'operator', targetId: discordId,
  })
  res.json({ success: true, operator })
})

app.post('/api/sales', requireSession, async (req, res) => {
  const wheelId = String(req.body.wheel || '')
  const wheel = (await catalog.getCatalog(wheelId))?.published
  const quantity = req.body.quantity === undefined ? 1 : Number(req.body.quantity)
  if (!wheel) return res.status(400).json({ success: false, message: 'Ruota non valida.' })
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    return res.status(400).json({ success: false, message: 'La quantità deve essere compresa tra 1 e 20.' })
  }

  try {
    const items = []
    for (let index = 0; index < quantity; index += 1) {
      let code = generateCode()
      while (items.some(item => item.code === code) || await store.getSaleByCode(code)) code = generateCode()
      items.push({
        code, wheel: wheelId, wheelName: wheel.name, amount: wheel.price, wheelSnapshot: structuredClone(wheel),
        operatorId: req.user.discordId, operatorName: req.user.displayName,
      })
    }
    const sales = await store.createSales(items)
    const discordLogged = await sendSaleLog(sales, req.user)
    await store.markSalesLog(sales.map((sale) => sale.id), discordLogged)
    await store.addAudit({
      actorId: req.user.discordId, actorName: req.user.displayName, action: 'sales.create',
      targetType: 'sale', targetId: sales.map((sale) => sale.id).join(','),
      details: { wheel: wheelId, quantity, total: wheel.price * quantity },
    })
    res.status(201).json({ success: true, sales: sales.map(publicSale), codes: sales.map(publicSale), discordLogged })
  } catch (error) {
    console.error('Creazione vendita fallita:', error.message)
    res.status(500).json({ success: false, message: 'Impossibile registrare la vendita.' })
  }
})

app.get('/api/sales', requireSession, async (req, res) => {
  const requestedOperator = req.user.role === 'admin' ? safeText(req.query.operatorId, 32) || null : req.user.discordId
  const status = ['sold', 'used', 'cancelled'].includes(req.query.status) ? req.query.status : null
  const sales = await store.listSales({
    operatorId: requestedOperator,
    status,
    from: req.query.from || null,
    to: req.query.to || null,
    limit: Math.min(1000, Math.max(1, Number(req.query.limit) || 500)),
  })
  res.json({ success: true, sales: sales.map(publicSale) })
})

app.post('/api/sales/:id/cancel', requireSession, requireAdmin, async (req, res) => {
  const reason = safeText(req.body.reason || 'Annullata da Direzione', 240)
  const sale = await store.cancelSale({ id: req.params.id, actorId: req.user.discordId, reason })
  if (!sale) {
    return res.status(409).json({ success: false, message: 'La vendita non esiste oppure è già annullata.' })
  }
  const [salesLogOk, spinLogOk] = await Promise.all([
    sendSaleCancellationLog(sale, req.user),
    sendSpinCancellationLog(sale, req.user),
  ])
  const discordLogged = salesLogOk && (spinLogOk === null || spinLogOk)
  await store.addAudit({
    actorId: req.user.discordId,
    actorName: req.user.displayName,
    action: sale.previousStatus === 'used' ? 'spin.cancel' : 'sale.cancel',
    targetType: 'sale',
    targetId: sale.id,
    details: {
      code: sale.code,
      reason,
      previousStatus: sale.previousStatus,
      playerId: sale.playerId,
      prize: sale.prize,
      salesLogOk,
      spinLogOk,
    },
  })
  res.json({
    success: true,
    sale: publicSale(sale),
    previousStatus: sale.previousStatus,
    discordLogged,
    discordLogs: { sales: salesLogOk, spin: spinLogOk },
  })
})

async function saleWheel(sale) {
  // Covers codes issued by the previous process during a rolling deployment.
  if (sale.wheelSnapshot) return sale.wheelSnapshot
  if (!wheels[sale.wheel]) throw new Error('Configurazione originale mancante.')
  return store.ensureSaleSnapshot(sale.code, seedWheel(wheels[sale.wheel]))
}

app.post('/api/codes/verify', async (req, res) => {
  const code = safeText(req.body.code, 4).toUpperCase()
  if (!/^[A-Z0-9]{4}$/.test(code)) return res.status(400).json({ success: false, message: 'Inserisci un codice valido.' })
  const sale = await store.getSaleByCode(code)
  if (!sale) return res.status(404).json({ success: false, message: 'Codice non valido.' })
  if (sale.status === 'cancelled') return res.status(410).json({ success: false, message: 'Questo codice è stato annullato.' })
  if (sale.status === 'used') return res.status(409).json({ success: false, message: 'Questo codice è già stato utilizzato.' })
  res.json({ success: true, code: sale.code, wheel: sale.wheel, wheelName: sale.wheelName, configuration: publicWheel(sale.wheel, await saleWheel(sale)) })
})

app.post('/api/codes/spin', async (req, res) => {
  const code = safeText(req.body.code, 4).toUpperCase()
  const gameId = safeText(req.body.gameId, 64)
  if (!gameId) return res.status(400).json({ success: false, message: 'Inserisci un ID In Game valido.' })
  const existing = await store.getSaleByCode(code)
  if (!existing) return res.status(404).json({ success: false, message: 'Codice non valido.' })
  if (existing.status === 'cancelled') return res.status(410).json({ success: false, message: 'Questo codice è stato annullato.' })
  if (existing.status !== 'sold') return res.status(409).json({ success: false, message: 'Questo codice è già stato utilizzato.' })
  const wheel = await saleWheel(existing)
  if (!wheel) return res.status(500).json({ success: false, message: 'Ruota non trovata.' })

  try {
    const prize = drawPrize(wheel.prizes)
    const isFreeSpin = prize.type === 'free_spin' || prize.id === 'free-spin'
    const saved = await store.recordSpin({ code, gameId, wheel, prize, isFreeSpin })
    if (!saved) return res.status(409).json({ success: false, message: 'Il codice è appena stato utilizzato.' })
    const discordLogged = await sendSpinLog({ sale: saved.sale, gameId, prize, spunAt: saved.spunAt })
    await store.markSpinLog(saved.sale.id, discordLogged)
    res.json({ success: true, code, wheel: wheel.name, prize: publicPrize(prize), freeSpin: isFreeSpin, discordLogged })
  } catch (error) {
    console.error('Registrazione giro fallita:', error.message)
    res.status(500).json({ success: false, message: 'Impossibile registrare il risultato del giro.' })
  }
})

function italyDateParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) }
}

function groupKey(value, groupBy) {
  const parts = italyDateParts(value)
  if (groupBy === 'year') return String(parts.year)
  if (groupBy === 'month') return `${parts.year}-${String(parts.month).padStart(2, '0')}`
  if (groupBy === 'week') {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
    const day = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() - day + 1)
    return date.toISOString().slice(0, 10)
  }
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

require('./gestion-export').install(app, store)

app.get('/api/analytics', requireSession, requireAdmin, async (req, res) => {
  const groupBy = ['day', 'week', 'month', 'year'].includes(req.query.groupBy) ? req.query.groupBy : 'day'
  const now = new Date()
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const from = req.query.from || defaultFrom
  const to = req.query.to || new Date(now.getTime() + 1000).toISOString()
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
    return res.status(400).json({ success: false, message: 'Intervallo di date non valido.' })
  }
  const sales = await store.listSales({ from, to, limit: 100000 })
  const valid = sales.filter((sale) => sale.status !== 'cancelled')
  const operatorMap = new Map()
  const seriesMap = new Map()
  for (const sale of valid) {
    const operator = operatorMap.get(sale.operatorId) || {
      operatorId: sale.operatorId, operatorName: sale.operatorName, sales: 0, revenue: 0,
    }
    operator.sales += 1
    operator.revenue += sale.amount
    operatorMap.set(sale.operatorId, operator)
    const key = groupKey(sale.createdAt, groupBy)
    const point = seriesMap.get(key) || { label: key, sales: 0, revenue: 0 }
    point.sales += 1
    point.revenue += sale.amount
    seriesMap.set(key, point)
  }
  const operators = [...operatorMap.values()].sort((a, b) => b.revenue - a.revenue || b.sales - a.sales)
  const totalRevenue = valid.reduce((sum, sale) => sum + sale.amount, 0)
  res.json({
    success: true,
    range: { from, to, groupBy },
    totals: {
      revenue: totalRevenue,
      sales: valid.length,
      used: valid.filter((sale) => sale.status === 'used').length,
      average: valid.length ? Math.round(totalRevenue / valid.length) : 0,
      cancelled: sales.filter((sale) => sale.status === 'cancelled').length,
    },
    topOperator: operators[0] || null,
    operators,
    series: [...seriesMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
  })
})

function requireOwner(req, res, next) {
  if (req.user?.discordId !== DISCORD_OWNER_ID) return res.status(403).json({ success: false, message: 'Gestione ruote riservata al Proprietario.' })
  if (req.method !== 'GET' && !CLIENT_ORIGINS.includes(String(req.headers.origin || '').replace(/\/$/, ''))) return res.status(403).json({ success: false, message: 'Origine richiesta non autorizzata.' })
  next()
}
app.get('/api/admin/wheels', requireSession, requireOwner, async (req, res) => {
  res.json({ success: true, wheels: await catalog.listCatalog() })
})
app.post('/api/admin/wheels/:id/:action', requireSession, requireOwner, async (req, res) => {
  const wheel = await catalog.changeCatalog(req.params.id, { ...req.body, action: req.params.action }, req.user)
  res.json({ success: true, wheel })
})
app.get('/api/wheels', async (req, res) => {
  const entries = await catalog.listCatalog()
  res.json({ success: true, wheels: entries.map(entry => publicWheel(entry.id, entry.published)) })
})

app.use((error, req, res, next) => {
  if (!error.status || error.status >= 500) console.error('Errore API:', error)
  if (res.headersSent) return next(error)
  return res.status(error.status || 500).json({ success: false, message: error.status && error.status < 500 ? error.message : 'Errore interno del server.' })
})

async function startServer() {
  const database = await store.initializeStore()
  await catalog.initializeCatalog(wheels)
  return app.listen(PORT, () => {
    console.log(`ARMERIA PALETO Ruota online sulla porta ${PORT}`)
    console.log(`Database: ${database.mode}`)
    console.log(`Discord OAuth: ${DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET ? 'configurato' : 'da configurare'}`)
    console.log(`Webhook fatture: ${DISCORD_SALES_WEBHOOK_URL ? 'configurato' : 'da configurare'}`)
    console.log(`Webhook ruota: ${DISCORD_SPIN_WEBHOOK_URL ? 'configurato' : 'da configurare'}`)
  })
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Avvio server non riuscito:', error)
    process.exit(1)
  })
}

module.exports = { app, startServer, wheels }
