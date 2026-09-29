import React, { useEffect, useState } from 'react'
import './WheelManager.css'

const emojis = ['🎁', '💵', '💰', '🪙', '🚗', '🏎️', '🚘', '🏆', '👑', '💎', '⭐', '🍔', '🥤', '🍕', '📦', '🧰', '🔧', '🎨', '🔫', '🎟️', '🔄', '❌', '🔥', '🍀', '⚡', '🎉', '🛞', '⛽', '🏍️', '🛠️', '🎯', '🎲']
const types = [['none', 'Nessun premio'], ['cash', 'Denaro'], ['vehicle', 'Veicolo'], ['material', 'Materiale'], ['other', 'Altro'], ['free_spin', 'Giro gratuito']]
const colors = ['#2a241b', '#9d752c', '#40331f', '#775624', '#33281d', '#ad8c47']
const money = n => n == null ? 'Da definire' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export default function WheelManager({ api, onPublished, onDirtyChange }) {
  const [catalog, setCatalog] = useState([])
  const [selected, setSelected] = useState('')
  const [form, setForm] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [picker, setPicker] = useState(null)
  const entry = catalog.find(w => w.id === selected)
  const total = form?.prizes.reduce((n, p) => n + Math.round(Number(p.probability || 0) * 100), 0) / 100 || 0

  function choose(item) {
    setSelected(item.id)
    setForm(structuredClone(item.draft || item.published))
    setDirty(false)
    setPicker(null)
  }
  async function load() {
    setBusy(true)
    try { const data = await api('/api/admin/wheels'); setCatalog(data.wheels); if (data.wheels[0]) choose(data.wheels.find(w => w.id === selected) || data.wheels[0]) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const prevent = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])

  function editPrize(index, patch) {
    setForm(f => ({ ...f, prizes: f.prizes.map((p, i) => i === index ? { ...p, ...patch } : p) }))
    setDirty(true); setNotice('')
  }
  function move(index, delta) {
    setForm(f => { const prizes = [...f.prizes]; [prizes[index], prizes[index + delta]] = [prizes[index + delta], prizes[index]]; return { ...f, prizes } })
    setDirty(true); setPicker(null)
  }
  async function change(action, version) {
    if (action === 'publish' && !window.confirm('Pubblicare questa bozza? I codici già venduti conserveranno i premi originali.')) return
    if (action === 'restore' && dirty && !window.confirm('Sostituire le modifiche non salvate con questa versione?')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const data = await api(`/api/admin/wheels/${selected}/${action}`, { method: 'POST', body: JSON.stringify({ revision: entry.revision, configuration: form, version }) })
      setCatalog(items => items.map(w => w.id === selected ? data.wheel : w))
      choose(data.wheel)
      setNotice(action === 'publish' ? 'Configurazione pubblicata. Disponibile per le nuove vendite.' : action === 'restore' ? 'Versione recuperata in bozza. Puoi modificarla prima di pubblicare.' : 'Bozza salvata. La ruota pubblica non è cambiata.')
      if (action === 'publish') await onPublished()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (!form) return <div className="ops-content wm"><h2>Gestione ruote e premi</h2>{error ? <p role="alert">{error} <button onClick={load}>Riprova</button></p> : <p>Caricamento configurazioni…</p>}</div>
  const count = form.prizes.length
  const gradient = form.prizes.map((_, i) => `${colors[i % colors.length]} ${i * 100 / count}% ${(i + 1) * 100 / count}%`).join(',')
  return <div className="ops-content wm">
    <header className="wm-heading"><div><span className="wm-eyebrow">RISERVATO AL PROPRIETARIO</span><h1>Ruote e premi</h1><p>Prepara i premi. Controlla l’anteprima. Pubblica quando sei pronto.</p></div><span className="wm-badge">Versione pubblica {entry.version}</span></header>
    <div className="wm-toolbar"><label>Ruota<select disabled={busy} value={selected} onChange={e => { if (!dirty || window.confirm('Lasciare le modifiche non salvate?')) choose(catalog.find(w => w.id === e.target.value)) }}>{catalog.map(w => <option key={w.id} value={w.id}>{w.published.name}</option>)}</select></label><div className="wm-actions"><button disabled={busy} onClick={() => { if (!dirty || window.confirm('Scartare le modifiche locali e ricaricare?')) load() }}>Ricarica</button><button disabled={busy} onClick={() => change('draft')}>Salva bozza</button><button className="ops-primary" disabled={busy || dirty || !entry.draft || total !== 100} onClick={() => change('publish')}>{busy ? 'Attendi…' : 'Pubblica bozza'}</button></div></div>
    {error && <p className="wm-error" role="alert">{error}</p>}{notice && <p className="wm-notice" role="status">{notice}</p>}
    <div className="wm-layout"><section className="wm-editor"><div className="wm-summary"><strong>{dirty ? 'Modifiche da salvare' : entry.draft ? 'Bozza salvata' : 'Configurazione pubblicata'}</strong><span className={total === 100 ? 'wm-valid' : 'wm-invalid'}>Totale {total.toLocaleString('it-IT', { maximumFractionDigits: 2 })}% / 100%</span></div>
      <p className="wm-help">Le percentuali e i costi sono visibili solo a te. Salva la bozza prima di pubblicare; il totale deve essere 100%.</p>
      <fieldset disabled={busy} className="wm-fields">
        <div className="wm-wheel-fields"><label>Nome ruota<input maxLength={100} value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); setDirty(true) }} /></label><label>Prezzo codice ($)<input type="number" min="1" step="1" value={form.price} onChange={e => { setForm({ ...form, price: e.target.value }); setDirty(true) }} /></label></div>
        {form.prizes.map((p, i) => <article className="wm-prize" key={p.id}>
          <div className="wm-prize-heading"><span>PREMIO {String(i + 1).padStart(2, '0')}</span><div><button aria-label={`Sposta in alto premio ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button aria-label={`Sposta in basso premio ${i + 1}`} disabled={i === count - 1} onClick={() => move(i, 1)}>↓</button><button disabled={count <= 2} onClick={() => { setForm(f => ({ ...f, prizes: f.prizes.filter((_, n) => n !== i) })); setDirty(true); setPicker(null) }}>Rimuovi</button></div></div>
          <div className="wm-name-row"><button className="wm-emoji" aria-label={`Scegli emoji premio ${i + 1}`} aria-expanded={picker === i} onClick={() => setPicker(picker === i ? null : i)}>{p.emoji}</button><label>Nome premio<input maxLength={120} value={p.label} onChange={e => editPrize(i, { label: e.target.value })} /></label></div>
          {picker === i && <div className="wm-picker"><div className="wm-emoji-grid">{emojis.map(emoji => <button key={emoji} aria-label={`Usa ${emoji}`} onClick={() => { editPrize(i, { emoji }); setPicker(null) }}>{emoji}</button>)}</div><label>Oppure incolla un’altra emoji<input maxLength={32} value={p.emoji} onChange={e => editPrize(i, { emoji: e.target.value })} /></label></div>}
          <div className="wm-prize-fields"><label>Tipo<select value={p.type} onChange={e => editPrize(i, { type: e.target.value })}>{types.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label>Probabilità (%)<input type="number" min="0" max="100" step="0.01" value={p.probability} onChange={e => editPrize(i, { probability: e.target.value })} /></label><label>Valore premio ($)<input type="number" min="0" step="1" placeholder="Facoltativo" value={p.amount ?? ''} onChange={e => editPrize(i, { amount: e.target.value })} /></label><label>Costo attività ($)<input type="number" min="0" step="1" placeholder="Da definire" value={p.cost ?? ''} onChange={e => editPrize(i, { cost: e.target.value })} /></label></div>
        </article>)}
        <button className="wm-add" disabled={count >= 16} onClick={() => { setForm(f => ({ ...f, prizes: [...f.prizes, { id: crypto.randomUUID(), label: 'Nuovo premio', emoji: '🎁', type: 'other', probability: 0, amount: null, cost: null }] })); setDirty(true) }}>＋ Aggiungi premio <small>{count}/16</small></button>
      </fieldset>
    </section><aside className="wm-preview"><span className="wm-eyebrow">ANTEPRIMA PREMI</span><h2>{form.name}</h2><div className="wm-disc" style={{ background: `conic-gradient(${gradient})` }}>{form.prizes.map((p, i) => <span key={p.id} style={{ transform: `rotate(${(i + .5) * 360 / count}deg) translateY(-108px) rotate(-${(i + .5) * 360 / count}deg)` }}>{p.emoji}</span>)}<b>ARMERIA PALETO</b></div><p>Gli spicchi mantengono la stessa dimensione.</p><ul>{form.prizes.map(p => <li key={p.id}><span>{p.emoji} {p.label}</span><b>{p.probability || 0}%</b></li>)}</ul><div className="wm-cost"><span>Costo medio previsto per giro</span><strong>{money(form.prizes.reduce((sum, p) => sum + Number(p.cost || 0) * Number(p.probability || 0) / 100, 0))}</strong><small>{form.prizes.some(p => p.cost == null || p.cost === '') ? 'Parziale: alcuni costi sono da definire.' : 'Calcolato sui costi e sulle probabilità impostate.'}</small></div></aside></div>
    <section className="wm-history"><h2>Storico configurazioni</h2><p>Il recupero crea una bozza: i codici già venduti e le vincite precedenti restano invariati.</p>{entry.history.map((h, i) => <div className="wm-history-row" key={`${h.revision || 1}-${i}`}><span><strong>{h.action === 'publish' ? 'Pubblicazione' : h.action === 'restore' ? 'Recupero in bozza' : h.action === 'draft' ? 'Salvataggio bozza' : 'Importazione iniziale'} · v{h.version}</strong><small>{new Date(h.at).toLocaleString('it-IT')} · {h.actorName}</small></span>{['publish', 'import'].includes(h.action) && <button disabled={busy} onClick={() => change('restore', h.version)}>Recupera in bozza</button>}</div>)}</section>
  </div>
}
