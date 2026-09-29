import WheelManager from './WheelManager'
import React, { useEffect, useMemo, useState } from 'react'

const money = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const dateTime = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'short',
  timeStyle: 'short',
})

async function readJson(response) {
  const body = await response.text()
  if (!body) return {}
  try { return JSON.parse(body) } catch { return {} }
}

function inputDate(date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function presetRange(preset) {
  const now = new Date()
  const end = inputDate(now)
  const start = new Date(now)
  let groupBy = 'day'

  if (preset === 'today') {
    return { from: end, to: end, groupBy: 'day' }
  }
  if (preset === 'week') {
    const day = start.getDay() || 7
    start.setDate(start.getDate() - day + 1)
  } else if (preset === 'month') {
    start.setDate(1)
  } else if (preset === 'year') {
    start.setMonth(0, 1)
    groupBy = 'month'
  }
  return { from: inputDate(start), to: end, groupBy }
}

function rangeToQuery(range) {
  const from = new Date(`${range.from}T00:00:00`)
  const inclusiveEnd = new Date(`${range.to}T00:00:00`)
  inclusiveEnd.setDate(inclusiveEnd.getDate() + 1)
  return new URLSearchParams({
    from: from.toISOString(),
    to: inclusiveEnd.toISOString(),
    groupBy: range.groupBy,
  }).toString()
}

function statusLabel(status) {
  if (status === 'used') return 'Utilizzato'
  if (status === 'cancelled') return 'Annullato'
  return 'Disponibile'
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M19.5 5.34A17.3 17.3 0 0 0 15.22 4l-.52 1.05a15.8 15.8 0 0 0-5.4 0L8.78 4A17.5 17.5 0 0 0 4.5 5.35C1.8 9.37 1.07 13.3 1.44 17.18a17.6 17.6 0 0 0 5.25 2.65l1.27-1.73a11.3 11.3 0 0 1-1.99-.96l.49-.38c3.83 1.78 7.98 1.78 11.77 0l.5.38c-.64.38-1.3.7-2 .96l1.27 1.73a17.5 17.5 0 0 0 5.25-2.65c.45-4.49-.77-8.38-3.75-11.84ZM8.86 14.8c-1.15 0-2.1-1.06-2.1-2.35s.92-2.35 2.1-2.35c1.18 0 2.12 1.06 2.1 2.35 0 1.3-.93 2.35-2.1 2.35Zm6.28 0c-1.15 0-2.1-1.06-2.1-2.35s.92-2.35 2.1-2.35c1.18 0 2.12 1.06 2.1 2.35 0 1.3-.92 2.35-2.1 2.35Z" />
    </svg>
  )
}

const wheelBase = import.meta.env.BASE_URL.replace(/\/$/, '')

export default function OperationsPanel({ apiUrl }) {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [tab, commitTab] = useState('sale')
  const [wheelDirty, setWheelDirty] = useState(false)
  function setTab(next) {
    if (tab === 'wheels' && next !== tab && wheelDirty && !window.confirm('Lasciare le modifiche ai premi non salvate?')) return
    commitTab(next)
  }
  const [wheels, setWheels] = useState([])
  const [wheel, setWheel] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [creating, setCreating] = useState(false)
  const [generated, setGenerated] = useState([])
  const [sales, setSales] = useState([])
  const [salesLoading, setSalesLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [operators, setOperators] = useState([])
  const [operatorId, setOperatorId] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [operatorBusy, setOperatorBusy] = useState(false)
  const [rangePreset, setRangePreset] = useState('month')
  const [range, setRange] = useState(() => presetRange('month'))
  const [analytics, setAnalytics] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)

  const isAdmin = user?.role === 'admin'

  async function api(path, options = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: options.body
        ? { 'Content-Type': 'application/json', ...(options.headers || {}) }
        : options.headers,
    })
    const data = await readJson(response)
    if (!response.ok) {
      const requestError = new Error(data.message || 'Operazione non riuscita.')
      requestError.status = response.status
      throw requestError
    }
    return data
  }

  useEffect(() => {
    const auth = new URLSearchParams(window.location.search).get('auth')
    if (auth) {
      window.history.replaceState({}, '', '/admin')
      const messages = {
        forbidden: 'Questo account Discord non è ancora abilitato come operatore.',
        cancelled: 'Accesso Discord annullato.',
        invalid_state: 'Sessione di accesso non valida. Riprova.',
        error: 'Discord non ha completato l’accesso. Riprova.',
      }
      if (messages[auth]) setError(messages[auth])
    }

    api('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    if (!user) return
    api('/api/wheels')
      .then((data) => {
        setWheels(data.wheels || [])
        setWheel((current) => current || String(data.wheels?.[0]?.id || ''))
      })
      .catch((requestError) => setError(requestError.message))
    loadSales()
  }, [user])

  useEffect(() => {
    if (!isAdmin) return
    loadOperators()
    loadAnalytics(range)
  }, [isAdmin])

  async function loadSales() {
    setSalesLoading(true)
    try {
      const data = await api('/api/sales?limit=1000')
      setSales(data.sales || [])
    } catch (requestError) {
      if (requestError.status === 401) setUser(null)
      else setError(requestError.message)
    } finally {
      setSalesLoading(false)
    }
  }

  async function loadOperators() {
    try {
      const data = await api('/api/operators')
      setOperators(data.operators || [])
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function loadAnalytics(nextRange = range) {
    if (!isAdmin) return
    if (!nextRange.from || !nextRange.to || nextRange.from > nextRange.to) {
      setError('Seleziona un intervallo di date valido.')
      return
    }
    setAnalyticsLoading(true)
    setError('')
    try {
      const data = await api(`/api/analytics?${rangeToQuery(nextRange)}`)
      setAnalytics(data)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setAnalyticsLoading(false)
    }
  }

  function selectPreset(preset) {
    const nextRange = presetRange(preset)
    setRangePreset(preset)
    setRange(nextRange)
    loadAnalytics(nextRange)
  }

  async function createSale(event) {
    event.preventDefault()
    setCreating(true)
    setError('')
    setNotice('')
    try {
      const data = await api('/api/sales', {
        method: 'POST',
        body: JSON.stringify({ wheel, quantity: Number(quantity) }),
      })
      setGenerated(data.sales || [])
      setNotice(data.discordLogged
        ? 'Codice Generato'
        : 'Vendita salvata. Il log Discord non è stato consegnato.')
      await loadSales()
      if (isAdmin) await loadAnalytics(range)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setCreating(false)
    }
  }

  async function cancelSale(sale) {
    const wasUsed = sale.status === 'used'
    const promptText = wasUsed
      ? `Motivo annullamento giro ${sale.code}:\n\nIl premio resterà nello storico, ma l'importo verrà rimosso da fatturato e statistiche.`
      : `Motivo annullamento vendita ${sale.code}:\n\nL'importo verrà rimosso da fatturato e statistiche.`
    const reason = window.prompt(promptText, wasUsed ? 'Errore nella consegna del premio' : 'Annullata da Direzione')
    if (reason === null) return
    setError('')
    setNotice('')
    try {
      const data = await api(`/api/sales/${sale.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      const logWarning = data.discordLogged ? '' : ' Uno o più log Discord non sono stati consegnati.'
      setNotice(wasUsed
        ? `Giro ${sale.code} annullato e importo rimosso dalle statistiche.${logWarning}`
        : `Vendita ${sale.code} annullata e importo rimosso dalle statistiche.${logWarning}`)
      await loadSales()
      await loadAnalytics(range)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function addOperator(event) {
    event.preventDefault()
    setOperatorBusy(true)
    setError('')
    try {
      await api('/api/operators', {
        method: 'POST',
        body: JSON.stringify({ discordId: operatorId.trim(), displayName: operatorName.trim() }),
      })
      setOperatorId('')
      setOperatorName('')
      setNotice('Dipendente abilitato. Ora può accedere con Discord.')
      await loadOperators()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setOperatorBusy(false)
    }
  }

  async function toggleOperator(operator) {
    setError('')
    try {
      await api(`/api/operators/${operator.discordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !operator.active }),
      })
      await loadOperators()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* session already gone */ }
    setUser(null)
    setTab('sale')
  }

  async function copyGenerated() {
    const text = generated.map((sale) => sale.code).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Codici copiati negli appunti.')
    } catch {
      setError('Non riesco a copiare automaticamente i codici.')
    }
  }

  const filteredSales = useMemo(() => {
    const query = search.trim().toLowerCase()
    return sales.filter((sale) => {
      if (status && sale.status !== status) return false
      if (!query) return true
      return `${sale.code} ${sale.wheelName} ${sale.operatorName} ${sale.playerId || ''} ${sale.prize?.label || ''}`
        .toLowerCase().includes(query)
    })
  }, [sales, search, status])

  if (checking) {
    return (
      <main className="ops-shell ops-centered">
        <div className="ops-login-card">
          <img src="/armeria.png" alt="Los Santos Custom" />
          <div className="ops-loader" />
          <p>Verifica della sessione operatore…</p>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="ops-shell ops-centered">
        <div className="ops-orb ops-orb-one" />
        <div className="ops-orb ops-orb-two" />
        <section className="ops-login-card">
          <div className="ops-live-pill"><i /> AREA OPERATORI ARMERIA</div>
          <img src="/armeria.png" alt="Los Santos Custom" />
          <span className="ops-kicker">CONTROL ROOM</span>
          <h1>Ruota della <em>Fortuna</em></h1>
          <p>Accedi con il tuo account Discord. Il sistema riconosce automaticamente Proprietario, Direzione e operatori autorizzati.</p>
          {error && <div className="ops-alert is-error">{error}</div>}
          <a className="ops-discord-button" href={`${apiUrl}/api/auth/discord`}>
            <DiscordMark /> Continua con Discord
          </a>
          <a className="ops-back-link" href={`${wheelBase}/`}>← Torna alla ruota</a>
          <small>Nessuna password ARMERIA viene salvata.</small>
        </section>
      </main>
    )
  }

  return (
    <main className="ops-shell">
      <div className="ops-orb ops-orb-one" />
      <div className="ops-orb ops-orb-two" />
      <aside className="ops-sidebar">
        <a className="ops-brand" href={`${wheelBase}/admin`}>
          <img src="/armeria.png" alt="" />
          <span><strong>Armeria</strong><small>Pannello Di Controllo</small></span>
        </a>
        <nav>
          <button className={tab === 'sale' ? 'active' : ''} onClick={() => setTab('sale')}><span>＋</span> Nuova vendita</button>
          <button className={tab === 'sales' ? 'active' : ''} onClick={() => setTab('sales')}><span>▤</span> {isAdmin ? 'Tutte le vendite' : 'Le mie vendite'}</button>
          {isAdmin && <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}><span>⌁</span> Dashboard</button>}
          {user?.canManageWheels && <button className={tab === 'wheels' ? 'active' : ''} onClick={() => setTab('wheels')}>Ruote e premi</button>}
          {isAdmin && <button className={tab === 'operators' ? 'active' : ''} onClick={() => setTab('operators')}><span>♙</span> Operatori</button>}
        </nav>
        <div className="ops-side-footer">
          <a href={`${wheelBase}/`}>Apri ruota pubblica ↗</a>
          <span><i /> Sistema online</span>
        </div>
      </aside>

      <section className="ops-workspace">
        <header className="ops-topbar">
          <button className="ops-mobile-brand" onClick={() => setTab('sale')}><img src="/armeria.png" alt="ARMERIA" /></button>
          <div>
            <span className="ops-eyebrow">ARMERIA PALETO</span>
            <h1>{tab === 'sale' ? 'Nuova vendita' : tab === 'sales' ? 'Registro vendite' : tab === 'dashboard' ? 'Andamento attività' : tab === 'wheels' ? 'Ruote e premi' : 'Gestione operatori'}</h1>
          </div>
          <div className="ops-account">
            {user.avatar ? <img src={user.avatar} alt="" /> : <span className="ops-avatar-fallback">{user.displayName?.slice(0, 1)}</span>}
            <div><strong>{user.displayName}</strong><small>{isAdmin ? 'Direzione' : 'Dipendente'}</small></div>
            <button onClick={logout} title="Esci">↪</button>
          </div>
        </header>

        <nav className="ops-mobile-nav">
          <button className={tab === 'sale' ? 'active' : ''} onClick={() => setTab('sale')}>Vendita</button>
          <button className={tab === 'sales' ? 'active' : ''} onClick={() => setTab('sales')}>Registro</button>
          {isAdmin && <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>}
          {user?.canManageWheels && <button className={tab === 'wheels' ? 'active' : ''} onClick={() => setTab('wheels')}>Ruote e premi</button>}
          {isAdmin && <button className={tab === 'operators' ? 'active' : ''} onClick={() => setTab('operators')}>Operatori</button>}
        </nav>

        {(error || notice) && (
          <div className={`ops-alert ${error ? 'is-error' : 'is-success'}`}>
            <span>{error || notice}</span>
            <button onClick={() => { setError(''); setNotice('') }}>×</button>
          </div>
        )}

        {tab === 'sale' && (
          <div className="ops-content ops-sale-layout">
            <section className="ops-panel ops-sale-panel">
              <div className="ops-panel-heading">
                <span className="ops-panel-icon">🎟</span>
                <div><span>EMISSIONE CODICE</span><h2>Registra la vendita</h2></div>
              </div>
              <form className="ops-sale-form" onSubmit={createSale}>
                <label>RUOTA VENDUTA
                  <select value={wheel} onChange={(event) => setWheel(event.target.value)} disabled={!wheels.length || creating}>
                    {wheels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label>QUANTITÀ
                  <div className="ops-stepper">
                    <button type="button" onClick={() => setQuantity((value) => Math.max(1, Number(value) - 1))}>−</button>
                    <input type="number" min="1" max="20" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                    <button type="button" onClick={() => setQuantity((value) => Math.min(20, Number(value) + 1))}>＋</button>
                  </div>
                </label>
                <div className="ops-total">
                  <span>TOTALE REGISTRATO</span>
                  <strong>{money.format((wheels.find((item) => String(item.id) === String(wheel))?.price || 0) * (Number(quantity) || 0))}</strong>
                </div>
                <button className="ops-primary" type="submit" disabled={creating || !wheel}>
                  {creating ? <><i className="ops-loader" /> Registrazione…</> : <>Genera Codice <span>→</span></>}
                </button>
              </form>
            </section>

            <aside className="ops-panel ops-generated-panel">
              <div className="ops-panel-heading">
                <span className="ops-panel-icon">⚡</span>
                <div><span>ULTIMA EMISSIONE</span><h2>Codici generati</h2></div>
              </div>
              {generated.length ? (
                <>
                  <div className="ops-code-stack">
                    {generated.map((sale) => <button key={sale.id} onClick={() => navigator.clipboard?.writeText(sale.code)} title="Copia codice">{sale.code}</button>)}
                  </div>
                  <p className="ops-generated-meta">{generated[0].wheelName}<br />Associati a {user.displayName}</p>
                  <button className="ops-secondary" onClick={copyGenerated}>Copia tutti i codici</button>
                </>
              ) : (
                <div className="ops-empty-state"><span>⌁</span><strong>Nessun codice appena generato</strong><p>Conferma una vendita per visualizzarlo qui.</p></div>
              )}
            </aside>
          </div>
        )}

        {tab === 'sales' && (
          <div className="ops-content">
            <section className="ops-panel">
              <div className="ops-toolbar">
                <div className="ops-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca codice, operatore, ID o premio…" /></div>
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">Tutti gli stati</option><option value="sold">Disponibili</option><option value="used">Utilizzati</option><option value="cancelled">Annullati</option>
                </select>
                <button className="ops-refresh" onClick={loadSales}>↻ Aggiorna</button>
              </div>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Codice</th><th>Ruota</th>{isAdmin && <th>Dipendente</th>}<th>Importo</th><th>Stato</th><th>Data</th><th>Risultato</th>{isAdmin && <th />}</tr></thead>
                  <tbody>
                    {filteredSales.map((sale) => (
                      <tr key={sale.id}>
                        <td data-label="Codice"><button className="ops-code-chip" onClick={() => navigator.clipboard?.writeText(sale.code)}>{sale.code}</button></td>
                        <td data-label="Ruota"><strong>{sale.wheelName.replace(/^RUOTA\s+/i, '')}</strong></td>
                        {isAdmin && <td data-label="Dipendente"><span className="ops-person">{sale.operatorName}<small>{sale.operatorId}</small></span></td>}
                        <td data-label="Importo">{money.format(sale.amount)}</td>
                        <td data-label="Stato"><span className={`ops-status is-${sale.status}`}><i />{statusLabel(sale.status)}</span></td>
                        <td data-label="Data">{dateTime.format(new Date(sale.createdAt))}</td>
                        <td data-label="Risultato">{sale.prize ? `${sale.prize.emoji || ''} ${sale.prize.label}` : sale.playerId ? `ID ${sale.playerId}` : '—'}</td>
                        {isAdmin && <td>{['sold', 'used'].includes(sale.status) && <button className="ops-danger-link" onClick={() => cancelSale(sale)}>{sale.status === 'used' ? 'Storna giro' : 'Annulla'}</button>}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredSales.length && <div className="ops-empty-row">{salesLoading ? 'Caricamento vendite…' : 'Nessuna vendita trovata.'}</div>}
              </div>
            </section>
          </div>
        )}

        {tab === 'dashboard' && isAdmin && (
          <div className="ops-content">
            <section className="ops-range-bar">
              <div className="ops-presets">
                {[['today', 'Giorno'], ['week', 'Settimana'], ['month', 'Mese'], ['year', 'Anno'], ['custom', 'Personalizzato']].map(([value, label]) => (
                  <button key={value} className={rangePreset === value ? 'active' : ''} onClick={() => value === 'custom' ? setRangePreset(value) : selectPreset(value)}>{label}</button>
                ))}
              </div>
              {rangePreset === 'custom' && <div className="ops-custom-range"><input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} /><span>→</span><input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} /><select value={range.groupBy} onChange={(event) => setRange((current) => ({ ...current, groupBy: event.target.value }))}><option value="day">Giorni</option><option value="week">Settimane</option><option value="month">Mesi</option><option value="year">Anni</option></select><button onClick={() => loadAnalytics(range)}>Applica</button></div>}
            </section>

            <section className="ops-stats-grid">
              <article><span>GUADAGNO TOTALE</span><strong>{money.format(analytics?.totals?.revenue || 0)}</strong><small>Vendite valide nel periodo</small></article>
              <article><span>VENDITE</span><strong>{analytics?.totals?.sales || 0}</strong><small>{analytics?.totals?.used || 0} codici utilizzati</small></article>
              <article><span>MEDIA PER VENDITA</span><strong>{money.format(analytics?.totals?.average || 0)}</strong><small>{analytics?.totals?.cancelled || 0} annullate escluse</small></article>
              <article className="is-highlight"><span>MIGLIOR OPERATORE</span><strong>{analytics?.topOperator?.operatorName || '—'}</strong><small>{analytics?.topOperator ? `${money.format(analytics.topOperator.revenue)} • ${analytics.topOperator.sales} vendite` : 'Nessuna vendita nel periodo'}</small></article>
            </section>

            <section className="ops-dashboard-grid">
              <article className="ops-panel ops-chart-panel">
                <div className="ops-panel-heading"><span className="ops-panel-icon">⌁</span><div><span>GUADAGNI</span><h2>Andamento nel periodo</h2></div></div>
                {analyticsLoading ? <div className="ops-empty-state"><i className="ops-loader" /></div> : (
                  <div className="ops-chart">
                    {(analytics?.series || []).map((point) => {
                      const max = Math.max(1, ...(analytics?.series || []).map((item) => item.revenue))
                      return <div className="ops-bar" key={point.label}><span className="ops-bar-value">{money.format(point.revenue)}</span><div style={{ height: `${Math.max(5, (point.revenue / max) * 100)}%` }} /><small>{point.label}</small></div>
                    })}
                    {!analytics?.series?.length && <div className="ops-empty-row">Nessuna vendita nel periodo.</div>}
                  </div>
                )}
              </article>
              <article className="ops-panel ops-ranking-panel">
                <div className="ops-panel-heading"><span className="ops-panel-icon">♛</span><div><span>CLASSIFICA</span><h2>Vendite per operatore</h2></div></div>
                <div className="ops-ranking">
                  {(analytics?.operators || []).map((operator, index) => (
                    <div key={operator.operatorId}><span>{index + 1}</span><div><strong>{operator.operatorName}</strong><small>{operator.sales} vendite</small></div><b>{money.format(operator.revenue)}</b></div>
                  ))}
                  {!analytics?.operators?.length && <div className="ops-empty-row">Nessun dato disponibile.</div>}
                </div>
              </article>
            </section>
          </div>
        )}

        {tab === 'wheels' && user?.canManageWheels && <WheelManager onDirtyChange={setWheelDirty} api={api} onPublished={() => api('/api/wheels').then(data => setWheels(data.wheels))} />}

        {tab === 'operators' && isAdmin && (
          <div className="ops-content ops-operator-layout">
            <section className="ops-panel">
              <div className="ops-panel-heading"><span className="ops-panel-icon">＋</span><div><span>NUOVO ACCESSO</span><h2>Abilita un operatore</h2></div></div>
              <form className="ops-operator-form" onSubmit={addOperator}>
                <label>ID DISCORD<input value={operatorId} onChange={(event) => setOperatorId(event.target.value.replace(/\D/g, '').slice(0, 22))} placeholder="123456789012345678" required /></label>
                <label>NOME DI RIFERIMENTO<input value={operatorName} onChange={(event) => setOperatorName(event.target.value.slice(0, 64))} placeholder="Nome Dipendente" required /></label>
                <button className="ops-primary" disabled={operatorBusy}>{operatorBusy ? 'Salvataggio…' : 'Abilita accesso Discord'}</button>
              </form>
              <p className="ops-help">Al primo accesso Discord, nome e avatar verranno aggiornati automaticamente. Proprietario e Direzione non devono essere aggiunti.</p>
            </section>
            <section className="ops-panel">
              <div className="ops-panel-heading"><span className="ops-panel-icon">♙</span><div><span>TEAM</span><h2>Account autorizzati</h2></div></div>
              <div className="ops-operator-list">
                {operators.map((operator) => (
                  <div key={operator.discordId}>
                    {operator.avatar ? <img src={operator.avatar} alt="" /> : <span>{operator.displayName?.slice(0, 1)}</span>}
                    <div><strong>{operator.displayName}</strong><small>{operator.discordId} • {operator.role === 'admin' ? 'Direzione' : 'Dipendente'}</small></div>
                    <button className={operator.active ? 'is-on' : 'is-off'} disabled={operator.role === 'admin'} onClick={() => toggleOperator(operator)}>{operator.active ? 'Attivo' : 'Disattivato'}</button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  )
}
