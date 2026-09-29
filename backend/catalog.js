const crypto = require('crypto')

function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function normalizeWheel(input, publish = false) {
  if (!input || typeof input !== 'object') throw invalid('Configurazione non valida.')
  const name = String(input.name || '').trim()
  const price = Number(input.price)
  if (!name || name.length > 100 || !Number.isSafeInteger(price) || price < 1) throw invalid('Nome o prezzo ruota non valido.')
  if (!Array.isArray(input.prizes) || input.prizes.length < 2 || input.prizes.length > 16) throw invalid('Inserisci da 2 a 16 premi.')
  const ids = new Set()
  const prizes = input.prizes.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid('Premio non valido.')
    const id = String(item.id || '')
    const label = String(item.label || '').trim()
    const emoji = String(item.emoji || '').trim()
    const type = item.type || 'other'
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw invalid('Identificativo premio duplicato o non valido.')
    ids.add(id)
    if (!label || label.length > 120 || !emoji || emoji.length > 32 || /[<>\r\n]/.test(emoji)) throw invalid('Ogni premio richiede un nome e una emoji validi.')
    if (!['none', 'cash', 'vehicle', 'material', 'other', 'free_spin'].includes(type)) throw invalid('Tipo premio non valido.')
    const probability = Number(item.probability)
    if (item.probability === null || item.probability === undefined || item.probability === '' || !Number.isFinite(probability) || probability < 0 || probability > 100 || Math.abs(probability * 100 - Math.round(probability * 100)) > 1e-7) throw invalid('Percentuali da 0 a 100, con massimo due decimali.')
    const number = (value, field) => {
      if (value === null || value === undefined || value === '') return null
      if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) throw invalid(`${field}: usa un importo intero positivo o zero.`)
      return Number(value)
    }
    return { id, label, emoji, type, probability, amount: number(item.amount, 'Valore premio'), cost: number(item.cost, 'Costo attività') }
  })
  const total = prizes.reduce((sum, prize) => sum + Math.round(prize.probability * 100), 0)
  if (publish && total !== 10000) throw invalid('Per pubblicare, il totale delle probabilità deve essere esattamente 100%.')
  if (publish && prizes.filter(p => p.type !== 'free_spin').every(p => p.probability === 0)) throw invalid('Serve almeno un premio finale con probabilità positiva.')
  return { name, price, prizes }
}

function publicPrize(prize) {
  return prize ? { id: prize.id, label: prize.label, emoji: prize.emoji } : null
}

function publicWheel(id, wheel) {
  return { id, name: wheel.name, price: wheel.price, prizes: wheel.prizes.map(publicPrize) }
}

function publicSale(sale) {
  const { wheelSnapshot, ...result } = sale
  return { ...result, prize: publicPrize(result.prize) }
}

function drawPrize(prizes) {
  const weights = prizes.map(p => Math.round(p.probability * 100))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total !== 10000) throw invalid('Configurazione probabilità non valida.', 500)
  let value = crypto.randomInt(total)
  for (let i = 0; i < prizes.length; i++) {
    value -= weights[i]
    if (value < 0) return prizes[i]
  }
  throw invalid('Estrazione non riuscita.', 500)
}

function seedWheel(wheel) {
  return normalizeWheel({ ...wheel, prizes: wheel.prizes.map(p => {
    const cash = /^cash-(\d+)$/.exec(p.id)
    return { ...p, type: cash ? 'cash' : p.id === 'nothing' ? 'none' : p.id.startsWith('auto-') ? 'vehicle' : 'material', amount: cash ? Number(cash[1]) : null, cost: cash ? Number(cash[1]) : p.id === 'nothing' ? 0 : null }
  }) }, true)
}

module.exports = { normalizeWheel, publicPrize, publicWheel, publicSale, drawPrize, seedWheel, invalid }
