const crypto = require('crypto')
function authorize(header, secret) {
  if (!secret || secret.length < 32) return false
  const expected = Buffer.from('Bearer ' + secret)
  const actual = Buffer.from(header || '')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}
function exportSale(sale) {
  const prize = sale.prize
  const stored = prize && (sale.wheelSnapshot?.prizes || []).find(p => p.id === prize.id)
  const raw = prize?.cost ?? stored?.cost
  const pending = sale.status === 'used' && raw == null && prize?.type !== 'none'
  return {id:String(sale.id),number:sale.code,amount:sale.amount,status:sale.status,
    occurredAt:new Date(sale.createdAt).toISOString(),description:sale.wheelName,
    prizeCost:raw == null ? 0 : Number(raw),prizeCostPending:pending}
}
function install(app, store) {
  app.get('/api/integrations/gestionale', async (req,res,next) => {
    if(!authorize(req.headers.authorization,process.env.GESTIONALE_SYNC_TOKEN))return res.status(401).json({error:'Accesso non autorizzato'})
    res.set('Cache-Control','no-store')
    const from = String(req.query.from||''),to = String(req.query.to||'')
    if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>3660*86400000)return res.status(400).json({error:'Intervallo non valido'})
    try {
      const sales = await store.listSales({from:new Date(from).toISOString(),to:new Date(to).toISOString(),limit:100001})
      if(sales.length>100000)return res.status(413).json({error:'Ridurre il periodo richiesto'})
      res.json({version:1,sales:sales.map(exportSale)})
    }catch(error){next(error)}
  })
}
module.exports = {install,authorize,exportSale}
