from __future__ import annotations
import hashlib
import hmac
import os
import secrets
import time
from pathlib import Path
from urllib.parse import urlencode
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

BASE_DIR=Path(__file__).resolve().parent.parent
STATIC_DIR=BASE_DIR/'static'
WHEEL_DIR=BASE_DIR/'wheel'
PUBLIC_BASE_URL=os.getenv('PUBLIC_BASE_URL','http://localhost:8000').rstrip('/')
BRIDGE_URL=os.getenv('BOT_BRIDGE_URL','').rstrip('/')
BRIDGE_KEY=os.getenv('BRIDGE_API_KEY','')
WHEEL_API=os.getenv('WHEEL_API_URL','https://ruota-della-fortuna-api.onrender.com').rstrip('/')
SSO_KEY=os.getenv('COMMAND_CENTER_SSO_KEY','')
SESSION_SECRET=os.getenv('SESSION_SECRET') or secrets.token_urlsafe(48)
# Only login sessions are ephemeral; accounting records remain in the bot DB.
SESSIONS={}
app=FastAPI(title='ARMERIA PALETO Gestionale',version='2.0.0')
app.add_middleware(SessionMiddleware,secret_key=SESSION_SECRET,session_cookie='lsc_cc_v2',
 same_site='lax',https_only=PUBLIC_BASE_URL.startswith('https://'),max_age=43200)

@app.middleware('http')
async def security(request,call_next):
    if request.method not in {'GET','HEAD','OPTIONS'} and request.headers.get('origin')!=PUBLIC_BASE_URL:
        return Response('Origine non autorizzata',status_code=403)
    response=await call_next(request)
    response.headers['Cache-Control']='no-store' if request.url.path.startswith(('/api/','/wheel-api/')) else 'no-cache'
    response.headers['Referrer-Policy']='no-referrer'
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['X-Frame-Options']='SAMEORIGIN'
    return response

async def bridge(path):
    if not BRIDGE_URL or len(BRIDGE_KEY)<32: raise HTTPException(503,'Collegamento al bot non ancora configurato')
    stamp=str(int(time.time()))
    signature=hmac.new(BRIDGE_KEY.encode(),f'{stamp}\nGET\n{path}'.encode(),hashlib.sha256).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            result=await client.get(BRIDGE_URL+path,headers={'X-ARMERIA PALETO-Time':stamp,'X-ARMERIA PALETO-Signature':signature})
        if result.status_code==403: raise HTTPException(403,'Ruolo o appartenenza al server non autorizzati')
        if result.status_code!=200: raise HTTPException(503,'Database del bot momentaneamente non raggiungibile. Nessun dato è stato modificato.')
        return result.json()
    except (httpx.HTTPError,ValueError): raise HTTPException(503,'Collegamento al bot non disponibile. I dati rimangono nel database originale.')

def session(request):
    sid=request.session.get('sid'); value=SESSIONS.get(sid)
    if not value or value['expires']<time.time():
        if sid: SESSIONS.pop(sid,None)
        raise HTTPException(401,'Accedi con Discord')
    return value

async def current_user(request):
    # Recheck actual Discord membership and roles, never trust cached privileges.
    return await bridge('/lsc/identity/'+session(request)['id'])

@app.get('/api/health')
async def health():
    return {'ok':True,'service':'lsc-command-center','version':'2.0.0','demo_mode':False,
      'discord_oauth_configured':bool(SSO_KEY),'bridge_configured':bool(BRIDGE_KEY and BRIDGE_URL),
      'discord_bot_configured':bool(BRIDGE_URL),'data_source':'bot_original_database'}

@app.get('/api/auth/status')
async def auth_status(request:Request):
    try: session(request); authenticated=True
    except HTTPException: authenticated=False
    return {'authenticated':authenticated,'oauth_available':bool(SSO_KEY),'demo_available':False}

@app.get('/api/auth/login')
async def login(request:Request):
    if not SSO_KEY: raise HTTPException(503,'Accesso Discord in configurazione')
    request.session.clear()
    state=secrets.token_urlsafe(32); request.session['sso_state']=state
    return RedirectResponse(WHEEL_API+'/api/auth/discord?'+urlencode({'app':'command-center','cc_state':state}))

@app.get('/api/auth/sso')
async def sso(request:Request,code:str):
    expected=request.session.pop('sso_state',None)
    if not expected or len(code)>128: raise HTTPException(400,'Sessione di accesso non valida')
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            reply=await client.post(WHEEL_API+'/api/command-center/exchange',headers={'X-ARMERIA PALETO-SSO-Key':SSO_KEY},json={'code':code})
        if reply.status_code!=200: raise HTTPException(401,'Accesso scaduto, ripeti il login')
        identity=reply.json()
        if not secrets.compare_digest(str(identity.get('state','')),expected): raise HTTPException(400,'Stato di accesso non valido')
        user_id=str(identity['id'])
        if not user_id.isdecimal(): raise HTTPException(400,'Identità non valida')
        await bridge('/lsc/identity/'+user_id)
    except httpx.HTTPError: raise HTTPException(503,'Servizio di accesso temporaneamente non disponibile')
    for sid,value in list(SESSIONS.items()):
        if value['expires']<time.time(): SESSIONS.pop(sid,None)
    sid=secrets.token_urlsafe(32)
    SESSIONS[sid]={'id':user_id,'wheel_token':identity.get('wheel_token'),'expires':time.time()+43200}
    request.session.clear(); request.session['sid']=sid
    return RedirectResponse('/')

@app.get('/api/auth/demo')
async def no_demo(): raise HTTPException(404,'La demo è disattivata: usa il tuo account Discord')

@app.post('/api/auth/logout')
async def logout(request:Request):
    SESSIONS.pop(request.session.get('sid'),None); request.session.clear()
    return {'ok':True}

@app.get('/api/me')
async def me(request:Request): return {'authenticated':True,**await current_user(request)}

@app.get('/api/dashboard')
async def dashboard(request:Request): return await bridge('/lsc/data/dashboard/'+session(request)['id'])

@app.get('/api/modules/{key}')
async def module(request:Request,key:str,offset:int=0,limit:int=100,table:str|None=None):
    if not key.replace('_','').isalnum(): raise HTTPException(404)
    query={'offset':max(0,offset),'limit':min(200,max(1,limit))}
    if table: query['table']=table
    return await bridge('/lsc/data/'+key+'/'+session(request)['id']+'?'+urlencode(query))

@app.get('/api/snapshot/{key}')
async def disabled_snapshot(key:str): raise HTTPException(410,'Usa le sezioni autorizzate del gestionale')

@app.post('/api/actions')
async def disabled_action(request:Request):
    session(request)
    raise HTTPException(501,'Usa il pannello Discord indicato nella sezione; nessuna modifica è stata registrata.')

@app.api_route('/wheel-api/{path:path}',methods=['GET','POST','PATCH'])
async def wheel_proxy(request:Request,path:str):
    if '..' in path or not path.startswith('api/') or path.startswith('api/command-center/'): raise HTTPException(404)
    if path=='api/auth/discord': return RedirectResponse('/api/auth/login')
    public=(request.method=='GET' and path in {'api/wheels','api/status'}) or (request.method=='POST' and path in {'api/codes/verify','api/codes/spin'})
    headers={'Content-Type':'application/json','Origin':PUBLIC_BASE_URL}
    if not public:
        user=await current_user(request)
        if 'ruota' not in user['modules']: raise HTTPException(403)
        token=session(request).get('wheel_token')
        if not token: raise HTTPException(403,'Account non abilitato come operatore della ruota')
        headers['Cookie']='lsc_session='+token
    body=await request.body()
    if len(body)>40960: raise HTTPException(413)
    try:
        async with httpx.AsyncClient(timeout=35) as client:
            result=await client.request(request.method,WHEEL_API+'/'+path,params=request.query_params,content=body,headers=headers)
        return Response(result.content,status_code=result.status_code,media_type=result.headers.get('content-type','application/json'))
    except httpx.HTTPError: raise HTTPException(503,'Ruota momentaneamente non disponibile')

if STATIC_DIR.exists(): app.mount('/assets',StaticFiles(directory=STATIC_DIR),name='assets')
if (WHEEL_DIR/'assets').exists(): app.mount('/ruota/assets',StaticFiles(directory=WHEEL_DIR/'assets'),name='wheel-assets')

@app.get('/ruota')
async def wheel_redirect(): return RedirectResponse('/ruota/')

@app.get('/ruota/{path:path}')
async def wheel_page(path:str):
    if not (WHEEL_DIR/'index.html').exists(): raise HTTPException(503,'Ruota in aggiornamento')
    return FileResponse(WHEEL_DIR/'index.html')

@app.get('/{path:path}')
async def home(path:str):
    if path.startswith(('api/','wheel-api/')): raise HTTPException(404)
    return FileResponse(STATIC_DIR/'index.html')
