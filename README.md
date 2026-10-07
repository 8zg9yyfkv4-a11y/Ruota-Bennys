# Ruota Benny's

Sito della Ruota della Fortuna di Benny's, con pannello operatori e controllo accessi via Discord.

- `frontend/` — sito React/Vite (ruota pubblica in `/`, pannello in `/admin`).
- `backend/` — API Node/Express con PostgreSQL (vedi `backend/.env.example`).

## Accesso al pannello

Il login usa Discord. Il bot Discord (`DISCORD_BOT_TOKEN`) verifica sul server (`DISCORD_GUILD_ID`) che l'utente abbia il ruolo Direzione (`DISCORD_DIRECTION_ROLE_ID`) oppure sia il proprietario (`DISCORD_OWNER_ID`). Gli operatori aggiunti dalla Direzione possono entrare solo come operatori.

## Sviluppo

```bash
cd backend && npm install && npm test && npm start
cd frontend && npm install && npm run dev
```
