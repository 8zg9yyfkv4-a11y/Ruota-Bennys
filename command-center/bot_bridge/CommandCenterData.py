"""Authenticated, read-only access to the running bot's original records."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from aiohttp import web
from discord.ext import commands

BASE = Path(__file__).resolve().parent.parent
LOG = logging.getLogger(__name__)
GUILD = 1514541784628203581
OWNER = 1514542225533698140
DIRECTION = 1514542233842487426
EMPLOYEE = 1514542241107148963
GRADES = [("tirocinante",1532939006122262629),("meccanico",1514542237898379334),
          ("meccanico_esperto",1514542236933554256),("capo_officina",1514542235884982434),
          ("supervisore",1514542232042999878),("vice_direttore",1514542231133097994),
          ("direttore",1514542230285844490),("gestore",1514542229405040640),("proprietario",OWNER)]
MODULES = {
    "turni": ["work_shifts","work_breaks","manual_time_adjustments","time_clock_events"],
    "fatture": ["invoices","invoice_items","invoice_revisions"],
    "deposito": ["inventory_items","inventory_movements","inventory_requests"],
    "personale": ["employees","employment_periods","employment_events"],
    "documenti": ["employee_documents"],
    "ferie": ["employee_vacations","vacation_events"],
    "richiami": ["disciplinary_actions","disciplinary_events"],
    "stipendi": ["weekly_payroll_entries","weekly_periods"],
    "contabilita": ["accounting_entries","cash_snapshots","daily_invoice_reports","daily_cash_baselines"],
    "listino": ["invoice_catalog"],
    "tickets": ["tickets"],
    "log": ["operations_audit"],
    "ruota": ["wheel_import_issues","wheel_refresh_queue"],
}
PERSONAL = {"turni","fatture","documenti","ferie","richiami","stipendi","tickets"}
SHARED = {"inventory_items","invoice_catalog","weekly_periods"}
RELATIONS = {"work_breaks":("shift_id","work_shifts"),"invoice_items":("invoice_id","invoices"),
             "invoice_revisions":("invoice_id","invoices")}


def connect(path):
    conn = sqlite3.connect(Path(path).resolve().as_uri()+"?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def normalize(row):
    # Discord snowflakes must never be rounded by JavaScript.
    return {k: str(v) if isinstance(v,int) and (abs(v)>9007199254740991) else v
            for k,v in dict(row).items() if k not in {"local_path","image_path","image_sha256"}}


def week_bounds(now):
    local = now.astimezone(ZoneInfo("Europe/Rome"))
    start = (local-timedelta(days=(local.weekday()-4)%7)).replace(hour=19,minute=0,second=0,microsecond=0)
    if start > local: start -= timedelta(days=7)
    return start.astimezone(timezone.utc), (start+timedelta(days=7)).astimezone(timezone.utc)


def read_records(path, key, user, offset=0, limit=100, selected=None):
    privileged = user["is_direction"]
    with closing(connect(path)) as conn:
        conn.execute("BEGIN")
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        if key == "control_room":
            names = sorted(tables)
            counts = {t:conn.execute('SELECT COUNT(*) FROM "'+t.replace('"','""')+'"').fetchone()[0] for t in names}
            covered = set(sum(MODULES.values(),[]))
            return {"inventory":counts,"unmapped_tables":sorted(tables-covered),"integrity":conn.execute("PRAGMA quick_check").fetchone()[0],
                    "storage":"Database originale del bot; nessuna copia contabile nel sito", "datasets":[]}
        names = MODULES.get(key, [])
        if key == "archivio":
            if selected not in tables: raise ValueError("Archivio inesistente")
            names = [selected]
        employee_names={str(r['discord_id']):r['rp_name'] for r in conn.execute('SELECT discord_id,rp_name FROM employees')} if 'employees' in tables else {}
        datasets=[]
        for table in names:
            if table not in tables:
                datasets.append({"table":table,"available":False,"total":None,"rows":[]}); continue
            quoted='"'+table.replace('"','""')+'"'
            columns=[r[1] for r in conn.execute(f"PRAGMA table_info({quoted})")]
            where=""; args=[]
            if not privileged and table not in SHARED:
                if "discord_id" in columns: where=' WHERE discord_id=?'; args=[user["id"]]
                elif table=="tickets": where=' WHERE owner_id=?'; args=[user["id"]]
                elif table in RELATIONS:
                    foreign,parent=RELATIONS[table]
                    where=f' WHERE {foreign} IN (SELECT id FROM {parent} WHERE discord_id=?)'; args=[user["id"]]
                elif "actor_id" in columns: where=' WHERE actor_id=?'; args=[user["id"]]
                else: continue  # Fail closed for unknown ownership.
            total=conn.execute(f'SELECT COUNT(*) FROM {quoted}{where}',args).fetchone()[0]
            order = '"'+columns[0]+'"'
            if "created_at" in columns: order='created_at'
            rows=[normalize(r) for r in conn.execute(f'SELECT * FROM {quoted}{where} ORDER BY {order} DESC LIMIT ? OFFSET ?',[*args,limit,offset])]
            for row in rows:
                if 'discord_id' in row and 'rp_name' not in row: row['rp_name']=employee_names.get(str(row['discord_id']),str(row['discord_id']))
            datasets.append({"table":table,"available":True,"total":total,"offset":offset,"limit":limit,"rows":rows})
        return {"datasets":datasets}


def dashboard(path,user):
    now=datetime.now(timezone.utc); start,end=week_bounds(now)
    with closing(connect(path)) as conn:
        conn.execute("BEGIN")
        scope="" if user["is_direction"] else " AND discord_id=?"
        args=[] if user["is_direction"] else [user["id"]]
        rows=conn.execute("SELECT * FROM invoices WHERE status='valid' AND julianday(issued_at)>=julianday(?) AND julianday(issued_at)<julianday(?)"+scope,[start.isoformat(),end.isoformat(),*args]).fetchall()
        gross=sum(r["gross_amount"] for r in rows); blip=sum(r["blip_amount"] for r in rows); prizes=sum(r["wheel_prize_cost"] for r in rows)
        pending=sum(bool(json.loads(r["details_json"] or '{}').get('prize_cost_pending')) for r in rows)
        staff=[normalize(r) for r in conn.execute("SELECT w.*,e.rp_name FROM work_shifts w LEFT JOIN employees e ON e.discord_id=w.discord_id WHERE w.ended_at IS NULL AND w.status!='cancelled'"+("" if user["is_direction"] else " AND w.discord_id=?"),args)]
        return {"gross_week":gross,"net_week":gross-blip-prizes,"blip_week":blip,"prize_cost_week":prizes,
                "invoices_week":len(rows),"active_staff":len(staff),"pending_prize_costs":pending,
                "week_start":start.isoformat(),"week_end":end.isoformat(),"scope":"azienda" if user["is_direction"] else "personale",
                "live_staff":staff}


class CommandCenterData(commands.Cog):
    def __init__(self,bot):
        self.bot=bot; self.runner=None
        config_path=BASE/".command-center.json"
        settings=json.loads(config_path.read_text()) if config_path.exists() else {}
        self.key=os.getenv("COMMAND_CENTER_BRIDGE_KEY",settings.get("key",""))
        self.port=int(os.getenv("SERVER_PORT",settings.get("port",9552)))
        self.path=BASE/"data"/"lsc_bot.sqlite3"

    async def cog_load(self):
        if len(self.key)<32:
            LOG.warning("Command Center: chiave non configurata, bridge disabilitato"); return
        await asyncio.to_thread(self.backup_before_integration)
        app=web.Application(client_max_size=1024)
        app.router.add_get('/lsc/health',self.health)
        app.router.add_get('/lsc/identity/{user_id}',self.identity)
        app.router.add_get('/lsc/data/{key}/{user_id}',self.data)
        self.runner=web.AppRunner(app); await self.runner.setup()
        await web.TCPSite(self.runner,'0.0.0.0',self.port).start()
        LOG.info("Command Center read-only bridge v2 listening on %s",self.port)

    def backup_before_integration(self):
        target=BASE/'Backups'/'command-center-before-integration.sqlite3'
        if target.exists(): return
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary=target.with_suffix('.partial')
        with closing(connect(self.path)) as source, closing(sqlite3.connect(temporary)) as dest:
            source.backup(dest)
            if dest.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
                raise RuntimeError('Backup integrazione non valido')
        temporary.replace(target)
        LOG.info('Command Center: backup consistente verificato, %s bytes',target.stat().st_size)

    async def cog_unload(self):
        if self.runner: await self.runner.cleanup()

    async def health(self,request):
        return web.json_response({"ok":self.bot.is_ready(),"service":"lsc-readonly-bridge","version":2})

    def authenticate(self,request):
        stamp=request.headers.get('X-ARMERIA PALETO-Time','')
        try:
            if abs(time.time()-int(stamp))>60: raise ValueError()
        except ValueError: raise web.HTTPUnauthorized()
        signature=hmac.new(self.key.encode(),f"{stamp}\nGET\n{request.path_qs}".encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature,request.headers.get('X-ARMERIA PALETO-Signature','')): raise web.HTTPUnauthorized()

    async def member(self,user_id):
        guild=self.bot.get_guild(GUILD)
        if guild is None: raise web.HTTPServiceUnavailable()
        try: member=await guild.fetch_member(int(user_id))
        except Exception: raise web.HTTPForbidden()
        roles={r.id for r in member.roles}; owner=member.id==guild.owner_id or OWNER in roles
        direction=owner or DIRECTION in roles
        if not (owner or EMPLOYEE in roles): raise web.HTTPForbidden()
        grade=next((name for name,rid in reversed(GRADES) if rid in roles),"meccanico")
        if owner: grade="proprietario"
        modules=["dashboard","turni","fatture","deposito","classifica","ruota","documenti","ferie","richiami","stipendi","listino","tickets","profilo","guida"]
        if direction: modules += ["personale","contabilita","log","discord"]
        if owner: modules += ["control_room","archivio"]
        return {"id":str(member.id),"username":member.display_name,"role":grade,"role_label":grade.replace('_',' ').title(),
                "role_ids":[str(r) for r in roles],"modules":modules,"is_owner":owner,"is_direction":direction,"demo":False}

    async def identity(self,request):
        self.authenticate(request)
        return web.json_response(await self.member(request.match_info['user_id']),headers={'Cache-Control':'no-store'})

    async def data(self,request):
        self.authenticate(request)
        user=await self.member(request.match_info['user_id']); key=request.match_info['key']
        if key not in user['modules']: raise web.HTTPForbidden()
        try:
            offset=max(0,int(request.query.get('offset','0'))); limit=min(200,max(1,int(request.query.get('limit','100'))))
        except ValueError: raise web.HTTPBadRequest()
        try:
            if key=='dashboard': result=await asyncio.to_thread(dashboard,self.path,user)
            elif key in {'classifica','stipendi'}:
                import cartellino_database as payroll
                start,end=week_bounds(datetime.now(timezone.utc))
                entries=await asyncio.to_thread(payroll.period_summary,start,end,path=self.path)
                if key=='classifica':
                    fields={'rp_name','ranking_position','gross_revenue','invoice_count','work_seconds','ranking_prize'}
                    entries=[{k:v for k,v in normalize(e).items() if k in fields} for e in entries]
                    result={'datasets':[]}
                else:
                    entries=[normalize(e) for e in entries if user['is_direction'] or str(e['discord_id'])==user['id']]
                    result=await asyncio.to_thread(read_records,self.path,key,user,offset,limit)
                result['datasets'].insert(0,{'table':'classifica' if key=='classifica' else 'stipendi_correnti','available':True,'total':len(entries),'rows':entries})
            else: result=await asyncio.to_thread(read_records,self.path,key,user,offset,limit,request.query.get('table'))
        except (sqlite3.Error,ValueError):
            LOG.exception('Command Center read failed for %s',key); raise web.HTTPServiceUnavailable(text='Archivio temporaneamente non disponibile')
        result.update(source='bot_live',updated_at=datetime.now(timezone.utc).isoformat(),read_only=True)
        return web.json_response(result,headers={'Cache-Control':'no-store'})


async def setup(bot):
    try:
        await bot.add_cog(CommandCenterData(bot))
    except Exception:
        LOG.exception('Command Center bridge disabled after startup error; bot continues normally')
