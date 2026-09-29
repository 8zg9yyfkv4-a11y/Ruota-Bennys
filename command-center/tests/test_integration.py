import asyncio
import hashlib
import hmac
import importlib.util
import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from aiohttp import web
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
data=load('cc_data',ROOT/'bot_bridge'/'CommandCenterData.py')
api=load('cc_api',ROOT/'backend'/'main.py')

@pytest.fixture
def database(tmp_path):
    p=tmp_path/'bot.sqlite3'
    with sqlite3.connect(p) as c:
        c.executescript('''
        CREATE TABLE invoices(id INTEGER,discord_id INTEGER,gross_amount INTEGER,blip_amount INTEGER,wheel_prize_cost INTEGER,issued_at TEXT,status TEXT,details_json TEXT);
        CREATE TABLE invoice_items(id INTEGER,invoice_id INTEGER,label TEXT);
        CREATE TABLE employees(discord_id INTEGER,rp_name TEXT);
        CREATE TABLE work_shifts(id INTEGER,discord_id INTEGER,started_at TEXT,ended_at TEXT,status TEXT);
        CREATE TABLE inventory_items(id INTEGER,label TEXT,quantity INTEGER);
        CREATE TABLE confidential_future_table(id INTEGER,secret TEXT);
        INSERT INTO employees VALUES(111,'Uno'),(222,'Due');
        INSERT INTO invoice_items VALUES(1,1,'Personale'),(2,2,'Altro');
        INSERT INTO inventory_items VALUES(1,'Kit',4);
        INSERT INTO confidential_future_table VALUES(1,'Solo proprietario');
        ''')
        now=datetime.now(timezone.utc).isoformat()
        c.executemany('INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?)',[(1,111,100,10,20,now,'valid','{}'),(2,222,300,30,50,now,'valid','{"prize_cost_pending":true}'),(3,111,999,0,0,now,'void','{}')])
    return p

def user(direction=False): return {'id':'111','is_direction':direction,'is_owner':direction}

def test_personal_rows_and_children_are_isolated(database):
    result=data.read_records(database,'fatture',user())['datasets']
    assert {r['discord_id'] for r in result[0]['rows']}=={111}
    assert [r['label'] for r in result[1]['rows']]==['Personale']
    assert result[2]['available'] is False  # Missing archive must not look empty.

def test_direction_can_read_all_and_pagination(database):
    result=data.read_records(database,'fatture',user(True),offset=1,limit=1)['datasets'][0]
    assert result['total']==3 and len(result['rows'])==1

def test_dashboard_uses_valid_invoices_and_subtracts_costs(database):
    personal=data.dashboard(database,user()); company=data.dashboard(database,user(True))
    assert (personal['gross_week'],personal['net_week'],personal['invoices_week'])==(100,70,1)
    assert (company['gross_week'],company['net_week'],company['pending_prize_costs'])==(400,290,1)

@pytest.mark.parametrize('date,expected',[('2026-09-11T16:59:59+00:00','2026-09-04T17:00:00+00:00'),('2026-09-11T17:00:00+00:00','2026-09-11T17:00:00+00:00'),('2026-10-30T18:00:00+00:00','2026-10-30T18:00:00+00:00')])
def test_friday_boundary_and_dst(date,expected):
    assert data.week_bounds(datetime.fromisoformat(date))[0].isoformat()==expected

def test_inventory_covers_new_tables_and_no_writes(database):
    before=hashlib.sha256(database.read_bytes()).hexdigest()
    result=data.read_records(database,'control_room',user(True))
    assert result['inventory']['confidential_future_table']==1
    assert 'confidential_future_table' in result['unmapped_tables']
    assert result['integrity']=='ok'
    assert hashlib.sha256(database.read_bytes()).hexdigest()==before

def test_missing_database_not_created(tmp_path):
    path=tmp_path/'missing.db'
    with pytest.raises(sqlite3.Error): data.read_records(path,'fatture',user())
    assert not path.exists()

def test_snowflakes_remain_exact():
    assert data.normalize({'discord_id':1514541784628203581})['discord_id']=='1514541784628203581'

def test_hmac_and_expiry():
    cog=object.__new__(data.CommandCenterData); cog.key='a'*40
    stamp=str(int(time.time())); path='/lsc/data/fatture/111?offset=0'
    sig=hmac.new(cog.key.encode(),f'{stamp}\nGET\n{path}'.encode(),hashlib.sha256).hexdigest()
    request=SimpleNamespace(path_qs=path,headers={'X-ARMERIA PALETO-Time':stamp,'X-ARMERIA PALETO-Signature':sig})
    cog.authenticate(request)
    request.path_qs='/lsc/data/fatture/222'
    with pytest.raises(web.HTTPUnauthorized): cog.authenticate(request)
    request.headers['X-ARMERIA PALETO-Time']='0'
    with pytest.raises(web.HTTPUnauthorized): cog.authenticate(request)

def test_roles_use_live_membership_and_not_grade_for_direction():
    roles=[SimpleNamespace(id=data.EMPLOYEE),SimpleNamespace(id=1514542230285844490)]
    member=SimpleNamespace(id=111,roles=roles,display_name='Uno')
    class Guild:
        owner_id=999
        async def fetch_member(self,uid): return member
    cog=object.__new__(data.CommandCenterData); cog.bot=SimpleNamespace(get_guild=lambda _:Guild())
    result=asyncio.run(cog.member('111'))
    assert not result['is_direction'] and 'contabilita' not in result['modules']
    roles.clear()
    with pytest.raises(web.HTTPForbidden): asyncio.run(cog.member('111'))

@pytest.mark.parametrize('path',['/api/me','/api/dashboard','/api/modules/fatture','/api/modules/archivio?table=employees','/wheel-api/api/auth/me'])
def test_anonymous_cannot_read_data(path):
    with TestClient(api.app) as client: assert client.get(path).status_code==401

def test_demo_and_legacy_snapshots_disabled():
    with TestClient(api.app) as client:
        assert client.get('/api/auth/demo?role=proprietario').status_code==404
        assert client.get('/api/snapshot/dashboard').status_code==410
        assert client.get('/api/auth/sso?code=fake').status_code==400

def test_csrf_and_unknown_api_fail_closed():
    with TestClient(api.app) as client:
        assert client.post('/api/auth/logout',headers={'Origin':'https://evil.example'}).status_code==403
        assert client.get('/api/does-not-exist').status_code==404
        assert client.get('/wheel-api/api/command-center/exchange').status_code==404

def test_public_health_has_no_data_or_secrets():
    with TestClient(api.app) as client:
        result=client.get('/api/health')
        assert result.json()['demo_mode'] is False
        assert result.headers['cache-control']=='no-store'
        assert 'gross_week' not in result.json()
