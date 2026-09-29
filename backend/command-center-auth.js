const crypto = require('node:crypto')

// Short-lived, one-use server-to-server exchange. No identity or session token
// is exposed in the browser callback URL.
function createCommandCenterAuth({ app, secret, publicUrl }) {
  const pending = new Map()
  function equal(a,b) {
    const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||''))
    return x.length===y.length && crypto.timingSafeEqual(x,y)
  }
  app.post('/api/command-center/exchange', (req,res) => {
    if (!secret || !equal(req.headers['x-lsc-sso-key'],secret)) return res.status(401).json({error:'Unauthorized'})
    const code=String(req.body.code||''); const item=pending.get(code)
    pending.delete(code)
    if (!item || item.expires<Date.now()) return res.status(401).json({error:'Exchange expired'})
    return res.json(item.payload)
  })
  return {
    enabled: Boolean(secret && publicUrl),
    complete(res,payload) {
      for(const [code,item] of pending) if(item.expires<Date.now()) pending.delete(code)
      if(pending.size>1000) return res.status(503).send('Riprova tra un minuto.')
      const code=crypto.randomBytes(32).toString('base64url')
      pending.set(code,{expires:Date.now()+60000,payload})
      res.setHeader('Referrer-Policy','no-referrer')
      return res.redirect(`${publicUrl}/api/auth/sso?code=${encodeURIComponent(code)}`)
    },
  }
}
module.exports={createCommandCenterAuth}
