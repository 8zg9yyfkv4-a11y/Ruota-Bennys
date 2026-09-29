const $=(q,el=document)=>el.querySelector(q);
const $$=(q,el=document)=>[...el.querySelectorAll(q)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'$'+Number(v??0).toLocaleString('it-IT');
const initials=v=>String(v||'ARMERIA PALETO').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const state={user:null,active:null,timer:null,offset:0,table:null,serial:0,abort:null,bootstrapped:false};
const MODULES={
 dashboard:{label:'Panoramica',icon:'⌂',group:'COMMAND'},turni:{label:'Turni e presenze',icon:'◷',group:'OPERATIVO'},
 fatture:{label:'Fatture',icon:'▤',group:'OPERATIVO'},deposito:{label:'Deposito',icon:'▣',group:'OPERATIVO'},
 classifica:{label:'Classifica',icon:'♜',group:'OPERATIVO'},ruota:{label:'Ruota della Fortuna',icon:'◉',group:'OPERATIVO'},
 listino:{label:'Listino e convenzioni',icon:'≡',group:'OPERATIVO'},personale:{label:'Personale',icon:'♙',group:'AZIENDA'},
 documenti:{label:'Documenti',icon:'▤',group:'AZIENDA'},ferie:{label:'Ferie',icon:'◇',group:'AZIENDA'},
 richiami:{label:'Provvedimenti',icon:'!',group:'AZIENDA'},stipendi:{label:'Stipendi',icon:'$',group:'AZIENDA'},
 contabilita:{label:'Contabilità e cassa',icon:'◇',group:'AZIENDA'},tickets:{label:'Ticket',icon:'▣',group:'AZIENDA'},
 log:{label:'Registro operazioni',icon:'⌁',group:'SISTEMA'},discord:{label:'Discord e bot',icon:'◈',group:'SISTEMA'},
 control_room:{label:'Controllo dati',icon:'✦',group:'SISTEMA'},archivio:{label:'Archivio completo',icon:'▤',group:'SISTEMA'},
 profilo:{label:'Il mio profilo',icon:'◎',group:'ACCOUNT'},guida:{label:'Come funziona',icon:'?',group:'ACCOUNT'}
};
const CHANNELS={turni:'1514542431826083840',fatture:'1514542441628434452',deposito:'1514542445965213816',
 classifica:'1514542400888901703',ferie:'1514542447991062628',richiami:'1514542530266533898',
 stipendi:'1520179576582701266',tickets:'1514542374989205575'};
const DESCRIPTIONS={turni:'Turni, pause e correzioni registrati dal bot.',fatture:'Fatture originali, righe e revisioni. Le vendite della ruota mantengono il riferimento RUOTA.',
 deposito:'Scorte effettive, movimenti e richieste di materiale.',classifica:'Classifica corrente calcolata con le stesse regole del bot.',
 listino:'Prezzi e voci del catalogo effettivamente usato per le fatture.',personale:'Anagrafica, assunzioni e storico dei cambi di grado.',
 documenti:'Versioni, approvazioni e scadenze dei documenti.',ferie:'Richieste, decisioni e storico ferie.',richiami:'Provvedimenti registrati e relativo storico.',
 stipendi:'Stima della settimana corrente e pagamenti registrati. Il totale da pagare comprende già i bonus.',
 contabilita:'Movimenti contabili, rilevazioni cassa e report giornalieri. Il fondo iniziale rimane separato dal profitto.',tickets:'Ticket e stato delle richieste.',
 log:'Operazioni effettivamente registrate dal bot.'};
const TABLE_LABELS={work_shifts:'Turni',work_breaks:'Pause',manual_time_adjustments:'Correzioni ore',time_clock_events:'Storico presenze',
 invoices:'Fatture',invoice_items:'Voci fattura',invoice_revisions:'Revisioni fatture',inventory_items:'Scorte',inventory_movements:'Movimenti deposito',
 inventory_requests:'Richieste deposito',employees:'Dipendenti',employment_periods:'Periodi di impiego',employment_events:'Storico personale',
 employee_documents:'Documenti',employee_vacations:'Ferie',vacation_events:'Storico ferie',disciplinary_actions:'Provvedimenti',disciplinary_events:'Storico provvedimenti',
 weekly_payroll_entries:'Stipendi archiviati',weekly_periods:'Settimane contabili',stipendi_correnti:'Stima settimana corrente — bonus inclusi',
 accounting_entries:'Movimenti contabili',cash_snapshots:'Rilevazioni cassa',daily_invoice_reports:'Report giornalieri',daily_cash_baselines:'Fondo iniziale',
 invoice_catalog:'Listino',tickets:'Ticket',operations_audit:'Registro operazioni',classifica:'Classifica corrente',wheel_import_issues:'Anomalie importazione ruota',
 wheel_refresh_queue:'Fatture ruota in aggiornamento'};
const LABELS={id:'ID',discord_id:'ID dipendente',rp_name:'Dipendente',current_grade_label:'Grado',grade_label:'Grado',active:'Attivo',
 started_at:'Inizio',ended_at:'Fine',status:'Stato',invoice_number:'Numero fattura',revision:'Revisione',gross_amount:'Lordo',blip_amount:'Costo blip',
 wheel_prize_cost:'Costo premio',wheel_prize:'Premio',issued_at:'Emissione',external_reference:'Riferimento',label:'Descrizione',quantity:'Quantità',
 item_code:'Articolo',quantity_delta:'Variazione',quantity_after:'Disponibilità finale',created_at:'Registrazione',updated_at:'Aggiornamento',
 reason:'Motivo',payable_amount:'Totale da pagare (bonus inclusi)',paid_amount:'Importo pagato',paid:'Pagato',paid_at:'Data pagamento',
 gross_revenue:'Fatturato',ranking_prize:'Bonus classifica (già incluso)',ranking_position:'Posizione',work_seconds:'Tempo lavorato',invoice_count:'Fatture',
 starts_at:'Inizio settimana',ends_at:'Fine settimana',period_id:'Settimana ID',net_amount:'Netto',prize_cost_amount:'Costo premi',blip_cost_amount:'Costo blip',
 actual_balance:'Cassa rilevata',expected_balance:'Cassa attesa',difference_amount:'Differenza',start_date:'Dal',return_date:'Rientro',
 submitted_at:'Invio',expires_at:'Scadenza',original_filename:'Documento',action_type:'Tipo',issued_at:'Data',action:'Operazione',
 subject:'Oggetto',category_label:'Categoria',owner_display_name:'Richiedente',customer_price:'Prezzo cliente',category:'Categoria',
 minimum_grade_key:'Grado minimo',details_json:'Dettagli',payload:'Report',code:'Codice',amount:'Importo',effective_at:'Decorrenza',
 eligibility_reason:'Criterio stipendio',rate_configured:'Tariffa configurata',base_payable_amount:'Stipendio prima del bonus'};
const COLUMNS={work_shifts:['id','rp_name','grade_label','started_at','ended_at','status'],invoices:['invoice_number','rp_name','gross_amount','blip_amount','wheel_prize_cost','status','issued_at'],
 inventory_items:['label','quantity','minimum_quantity'],inventory_movements:['id','item_code','quantity_delta','quantity_after','created_at'],
 employees:['rp_name','current_grade_label','active','hired_at'],employee_documents:['id','rp_name','original_filename','status','expires_at'],
 employee_vacations:['id','rp_name','start_date','return_date','status'],disciplinary_actions:['id','rp_name','action_type','status','expires_at'],
 weekly_payroll_entries:['period_id','rp_name','payable_amount','paid','paid_amount'],stipendi_correnti:['rp_name','work_seconds','gross_revenue','payable_amount','eligibility_reason'],
 classifica:['ranking_position','rp_name','gross_revenue','invoice_count','ranking_prize'],invoice_catalog:['code','category','label','customer_price','minimum_grade_key'],
 tickets:['id','owner_display_name','category_label','subject','status'],accounting_entries:['id','entry_type','gross_amount','blip_cost_amount','prize_cost_amount','net_amount'],
 daily_invoice_reports:['ends_at','payload'],cash_snapshots:['id','actual_balance','expected_balance','difference_amount','recorded_at']};
const AMOUNTS=new Set(['gross_amount','blip_amount','wheel_prize_cost','payable_amount','paid_amount','gross_revenue','ranking_prize','net_amount','prize_cost_amount','blip_cost_amount','actual_balance','expected_balance','difference_amount','customer_price','amount','base_payable_amount']);
async function api(url,options={}){const {signal,...request}=options;const r=await fetch(url,{...request,signal:signal||state.abort?.signal,headers:{'Content-Type':'application/json',...request.headers}});let data;try{data=await r.json()}catch{data={}}if(!r.ok)throw Object.assign(new Error(data.detail||'Servizio non disponibile'),{status:r.status});return data}
function pageHead(eyebrow,title,desc,actions=''){return `<div class="page-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1><p>${esc(desc)}</p></div><div class="head-actions">${actions}</div></div>`}
function card(title,body){return `<section class="card panel"><div class="panel-head"><h3>${esc(title)}</h3></div>${body}</section>`}
function empty(msg){return `<div class="empty">${esc(msg)}</div>`}
function formatValue(key,v){if(v===null||v===undefined)return '—';if(AMOUNTS.has(key))return money(v);if(key==='work_seconds')return `${Math.floor(v/3600)}h ${Math.floor(v%3600/60)}m`;if(['active','paid','rate_configured'].includes(key))return v?'Sì':'No';if(typeof v==='object')return JSON.stringify(v);return String(v)}
function stamp(data){return `<p class="data-stamp">● Database originale del bot · Lettura ${esc(new Date(data.updated_at).toLocaleString('it-IT'))} · ${state.user.is_direction?'Ambito direzione':'Dati personali e sezioni condivise'}</p>`}
function detail(row){return `<details><summary>Dettagli</summary><dl>${Object.entries(row).map(([k,v])=>`<dt>${esc(LABELS[k]||k.replaceAll('_',' '))}</dt><dd>${esc(formatValue(k,v))}</dd>`).join('')}</dl></details>`}
const DATASET_KEYS={employees:'discord_id',employment_periods:'id',employment_events:'id',work_shifts:'id',work_breaks:'id',time_clock_events:'id',manual_time_adjustments:'id',invoices:'invoice_number',invoice_items:'id',invoice_revisions:'id',inventory_items:'item_code',inventory_movements:'id',inventory_requests:'id',employee_documents:'id',employee_vacations:'id',vacation_events:'id',disciplinary_actions:'id',disciplinary_events:'id',weekly_payroll_entries:'id',weekly_periods:'id',accounting_entries:'id',cash_snapshots:'id',daily_invoice_reports:'id',daily_cash_baselines:'id',tickets:'id',operations_audit:'id',wheel_import_issues:'id',wheel_refresh_queue:'id'};
function uniqueRows(ds){const key=DATASET_KEYS[ds.table];const seen=new Set();return (ds.rows||[]).filter(row=>{const value=key&&row[key]!==undefined?row[key]:JSON.stringify(row);const marker=String(value);if(seen.has(marker))return false;seen.add(marker);return true})}
function datasetTable(ds){if(!ds.available)return card(TABLE_LABELS[ds.table]||ds.table,empty('Archivio non disponibile: da verificare nel bot.'));
 const rows=uniqueRows(ds),cols=COLUMNS[ds.table]||Object.keys(rows[0]||{}).slice(0,6);
 return `<section class="card table-card"><div class="table-tools"><h3>${esc(TABLE_LABELS[ds.table]||ds.table)}</h3><span>${ds.total} record${rows.length<ds.total?' · pagina da '+((ds.offset||0)+1):''}</span><input class="search table-search" placeholder="Filtra questa pagina" aria-label="Filtra ${esc(TABLE_LABELS[ds.table]||ds.table)}"></div>${rows.length?`<div class="table-scroll"><table><thead><tr>${cols.map(k=>`<th>${esc(LABELS[k]||k.replaceAll('_',' '))}</th>`).join('')}<th>Dettagli</th></tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(k=>`<td>${esc(formatValue(k,r[k]))}</td>`).join('')}<td>${detail(r)}</td></tr>`).join('')}</tbody></table></div>`:empty('Nessun record in questa pagina.')}</section>`}
function setActive(key){state.active=key;$$('[data-module]').forEach(x=>x.classList.toggle('active',x.dataset.module===key));$('#page-title').textContent=MODULES[key]?.label||key}
async function navigate(key,offset=0){if(!state.user?.modules.includes(key))return;const serial=++state.serial;if(state.abort)state.abort.abort();state.abort=new AbortController();const request=state.abort;state.offset=offset;setActive(key);closeDrawer();$('#content').innerHTML=empty('Lettura degli archivi originali…');try{const html=await renderModule(key);if(serial!==state.serial||request!==state.abort)return;$('#content').innerHTML=html;attachTableSearch()}catch(e){if(e.name==='AbortError'||request!==state.abort||serial!==state.serial)return;if(serial===state.serial)$('#content').innerHTML=pageHead('ARMERIA PALETO',MODULES[key]?.label||key,'')+card('Dati non disponibili',empty(e.message)+`<button class="btn" data-refresh>Riprova</button>`);}}
async function renderModule(key){
 if(key==='dashboard'){const d=await api('/api/dashboard');return pageHead('ARMERIA PALETO GESTIONALE',`Ciao, ${state.user.username}.`,d.scope==='azienda'?'Panoramica aziendale':'Il tuo riepilogo personale',`<button class="btn" data-refresh>Aggiorna</button>`)+stamp(d)+`<p>Settimana: ${esc(new Date(d.week_start).toLocaleString('it-IT'))} → ${esc(new Date(d.week_end).toLocaleString('it-IT'))}</p><div class="kpi-grid">${[['Fatturato',money(d.gross_week)],['Netto dopo blip e premi',money(d.net_week)],['Fatture valide',d.invoices_week],['In servizio',d.active_staff]].map(([l,v])=>`<section class="card kpi"><span class="kpi-label">${esc(l)}</span><div class="kpi-value">${esc(v)}</div></section>`).join('')}</div>${d.pending_prize_costs?card('Importi da completare',empty(`${d.pending_prize_costs} fatture hanno un costo premio ancora da definire. Il netto è provvisorio.`)):''}`+card('Come viene calcolato il netto',`<p>Lordo ${money(d.gross_week)} − costo blip ${money(d.blip_week)} − costo premi ${money(d.prize_cost_week)}. I bonus stipendio sono già compresi nei totali da pagare.</p>`)+card('Presenze',d.live_staff.length?d.live_staff.map(r=>`<p>${esc(r.rp_name||r.discord_id)} · ${esc(r.status)} · Inizio ${esc(new Date(r.started_at).toLocaleString('it-IT'))}</p>`).join(''):empty('Nessun turno aperto nel tuo ambito.'));}
 if(key==='ruota'){const d=await api('/api/modules/ruota?offset='+state.offset);return pageHead('DATI RUOTA','Ruota della Fortuna','Consultazione dei dati importati dal bot. La ruota resta un servizio separato e qui non viene incorporata.')+stamp(d)+d.datasets.map(datasetTable).join('')+pagination(d);}
 if(key==='guida')return pageHead('GUIDA','Un solo punto di accesso','Il gestionale mostra esclusivamente dati di consultazione.')+card('Dati originali',`<p>Il sito legge gli archivi originali del bot e non crea una seconda contabilità.</p><p>Fatture, presenze, deposito, ferie, provvedimenti, stipendi e ruota vengono mostrati nelle rispettive sezioni.</p>`)+card('Ruota e contabilità',`<p>La ruota rimane un servizio separato. Qui vengono mostrati soltanto i dati importati e i riferimenti collegati alle fatture.</p><p>Un costo premio sconosciuto resta indicato come da completare: non viene considerato zero.</p>`)+card('Stipendi e periodi',`<p>La settimana va da venerdì alle 19:00 al venerdì successivo alle 19:00, ora italiana. Il totale stipendio comprende già i bonus.</p><p>Il profitto è lordo meno blip e premi della ruota; il fondo cassa iniziale è separato.</p>`)+card('Aggiornamento',`<p>La data di lettura compare in ogni sezione. Il sito non esegue operazioni sul bot e non mostra dati dimostrativi.</p>`);
 if(key==='profilo')return pageHead('ACCOUNT','Il mio profilo','Permessi verificati con il server Discord.')+card(state.user.username,`<p>${esc(state.user.role_label)} · ID ${esc(state.user.id)}</p><p>${state.user.modules.map(m=>esc(MODULES[m]?.label||m)).join(' · ')}</p>`);
 if(key==='discord'){const d=await api('/api/me');return pageHead('SISTEMA','Discord e bot','Collegamento verificato sul bot in esecuzione.')+card('Identità verificata',`<p>${esc(d.username)} · ${esc(d.role_label)}</p><p>I dati operativi sono letti direttamente dal bot. Nessun test economico viene eseguito da questa pagina.</p>`);}
 if(key==='control_room'||key==='archivio'){
  const d=await api('/api/modules/control_room');
  if(key==='control_room')return pageHead('PROPRIETARIO','Controllo dati','Inventario completo degli archivi presenti nel database del bot.',`<button class="btn" data-refresh>Aggiorna</button>`)+stamp(d)+card('Integrità database',`<p>${esc(d.integrity)} · ${Object.keys(d.inventory).length} archivi</p><p>${esc(d.storage)}</p>`)+card('Tutti gli archivi',`<div class="archive-grid">${Object.entries(d.inventory).map(([t,n])=>`<button class="btn" data-archive="${esc(t)}">${esc(TABLE_LABELS[t]||t)} · ${n}</button>`).join('')}</div>`)+card('Archivi tecnici',`<p>${d.unmapped_tables.length} archivi non hanno una sezione dedicata; sono comunque consultabili nell'Archivio completo.</p>`);
  const selected=state.table||Object.keys(d.inventory)[0];state.table=selected;
  const data=await api('/api/modules/archivio?table='+encodeURIComponent(selected)+'&offset='+state.offset);
  return pageHead('PROPRIETARIO','Archivio completo','Consultazione di ogni tabella originale, senza modifiche o cancellazioni.')+stamp(data)+`<label>Archivio <select id="archive-select">${Object.keys(d.inventory).map(t=>`<option value="${esc(t)}" ${t===selected?'selected':''}>${esc(TABLE_LABELS[t]||t)} (${d.inventory[t]})</option>`).join('')}</select></label>`+data.datasets.map(datasetTable).join('')+pagination(data);
 }
 const d=await api('/api/modules/'+key+'?offset='+state.offset);
 const actions='<button class="btn" data-refresh>Aggiorna dati</button>';
 return pageHead('ARMERIA PALETO',MODULES[key].label,DESCRIPTIONS[key]||'',actions)+stamp(d)+d.datasets.map(datasetTable).join('')+pagination(d);
}
function pagination(d){const max=Math.max(0,...d.datasets.map(x=>x.total||0));return max>100||state.offset?`<div class="head-actions"><button class="btn" data-page="${Math.max(0,state.offset-100)}" ${state.offset===0?'disabled':''}>Precedenti</button><span>Record da ${state.offset+1}</span><button class="btn" data-page="${state.offset+100}" ${state.offset+100>=max?'disabled':''}>Successivi</button></div>`:''}
function attachTableSearch(){$$('.table-search').forEach(x=>x.addEventListener('input',()=>{$$('tbody tr',x.closest('.table-card')).forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(x.value.toLowerCase()))}))}
function attachCardGlow(){}
function startLiveTimers(){}
function closeDrawer(){$('#sidebar')?.classList.remove('open');$('#drawer-backdrop')?.classList.add('hidden')}
async function bootstrap(){
 if(state.bootstrapped)return;state.bootstrapped=true;
 document.addEventListener('click',e=>{const a=e.target.closest('[data-module]'),r=e.target.closest('[data-refresh]'),p=e.target.closest('[data-page]'),t=e.target.closest('[data-archive]');if(a)navigate(a.dataset.module);else if(r)navigate(state.active,state.offset);else if(p)navigate(state.active,Number(p.dataset.page));else if(t){state.table=t.dataset.archive;navigate('archivio')}});
 document.addEventListener('change',e=>{if(e.target.id==='archive-select'){state.table=e.target.value;navigate('archivio')}});
 $('#logout-btn')?.addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST'});location.reload()});
 $('#mobile-menu')?.addEventListener('click',()=>{$('#sidebar').classList.toggle('open');$('#drawer-backdrop').classList.toggle('hidden')});
 $('#drawer-backdrop')?.addEventListener('click',closeDrawer);$('#profile-btn')?.addEventListener('click',()=>navigate('profilo'));
 try{state.user=await api('/api/me');state.user.modules=[...new Set(state.user.modules||[])].filter(m=>m!=='discord');$('#login-screen').classList.add('hidden');$('#app').classList.remove('hidden');$('#top-name').textContent=state.user.username;$('#top-role').textContent=state.user.role_label;$('#top-avatar').textContent=initials(state.user.username);
 $('#nav').innerHTML=['COMMAND','OPERATIVO','AZIENDA','SISTEMA','ACCOUNT'].map(g=>`<div class="nav-group"><span class="nav-group-label">${g}</span>${state.user.modules.filter(m=>MODULES[m]?.group===g).map(m=>`<button class="nav-item" data-module="${m}"><span class="nav-icon">${MODULES[m].icon}</span><span>${MODULES[m].label}</span></button>`).join('')}</div>`).join('');
 $('#mobile-nav').innerHTML=['dashboard','fatture','ruota','guida','profilo'].filter(m=>state.user.modules.includes(m)).map(m=>`<button data-module="${m}"><i>${MODULES[m].icon}</i><span>${MODULES[m].label}</span></button>`).join('');navigate('dashboard');
 }catch(e){$('#app').classList.add('hidden');$('#login-screen').classList.remove('hidden');$('#demo-box').classList.add('hidden');$('#login-status').textContent=e.status===401?'Accedi con Discord per consultare i dati del bot.':e.message;}
}
document.addEventListener('DOMContentLoaded',bootstrap);
