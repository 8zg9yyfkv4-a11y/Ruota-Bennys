# ARMERIA PALETO Gestionale unificato

Il gestionale ospita la ruota in `/ruota/` e la console operatori in `/ruota/admin`. Il sito legge gli archivi originali del bot tramite il modulo autenticato `CommandCenterData.py`: non importa una copia locale e non crea una seconda contabilità.

## Funzioni

- Login Discord tramite il provider già configurato per la ruota, scambio monouso valido 60 secondi e sessione server-side.
- Ruoli verificati dal bot a ogni richiesta; dipendenti limitati ai propri archivi riservati. Direzione richiede il ruolo Direzione del bot, non soltanto il nome del grado.
- Fatture/revisioni, presenze/pause, deposito, personale, documenti, ferie, provvedimenti, stipendi, classifica, listino/convenzioni, contabilità/cassa/report, ticket e audit.
- Inventario e archivio completo riservati al proprietario, inclusi archivi tecnici senza una sezione dedicata; paginazione con conteggi completi.
- Totali fatture valide: lordo meno blip e costi premi, con segnalazione dei costi premio pendenti. Settimana venerdì 19:00 Europe/Rome.
- Gli stipendi correnti usano la funzione del bot. Il totale contiene già il bonus classifica.
- Operazioni del bot tramite i pannelli Discord indicati; la ruota mantiene le proprie operazioni web. Nessun pulsante simula un pagamento o una registrazione.

## Collegamento Wispbyte

Copiare `bot_bridge/CommandCenterData.py` in `Cogs/`, aggiungere `Cogs.CommandCenterData` a Main.py e creare `.command-center.json` nella root del bot con `key` (segreto lungo almeno 32 caratteri) e `port` (porta assegnata dal provider). Il file è escluso da Git.

Il modulo crea prima una copia SQLite consistente in `Backups/command-center-before-integration.sqlite3` e verifica `integrity_check`. Espone solo letture firmate HMAC attraverso il dominio HTTPS del bot. Una firma errata, scaduta, oppure un ruolo non autorizzato blocca la lettura. La configurazione e i file originali restano nel bot.

## Render

Gestionale: `BOT_BRIDGE_URL`, `BRIDGE_API_KEY`, `COMMAND_CENTER_SSO_KEY`, `SESSION_SECRET`, `PUBLIC_BASE_URL`. Ruota backend: `COMMAND_CENTER_SSO_KEY` e `COMMAND_CENTER_URL`.

Il nuovo login usa la callback Discord esistente; non richiede la copia del client secret nel gestionale. La modalità demo è disattivata. I dati non vengono persistiti sul filesystem effimero Render. Dopo un riavvio del gestionale è necessario accedere nuovamente.

## Build e test

```powershell
# Dalla root del repository
python -m pytest command-center/tests -q
node --test backend/command-center-auth.test.js
# Da backend/
npm test
# Da frontend/: bundle incluso nella release del gestionale
$env:VITE_API_URL='/wheel-api'
npm run build -- --base=/ruota/ --outDir=../command-center/wheel
```

Le verifiche della ruota usano archivi di test JSON e PostgreSQL/PGlite. Nessuna vendita o estrazione economica deve essere eseguita per test nel server ufficiale.

## Limiti operativi

La disponibilità dei dati dipende dal bot e dal suo dominio HTTPS: un'interruzione viene mostrata come indisponibilità, senza dati demo di ripiego. L'importazione delle vendite della ruota rimane quella già implementata dal bot; le anomalie storiche e i costi premio sconosciuti richiedono riconciliazione e non vengono inventati. I file allegati rimangono archiviati nei percorsi originali del bot/Discord.
