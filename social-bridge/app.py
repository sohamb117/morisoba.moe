"""Private session adapters. Credentials arrive only from the authenticated Worker."""
import asyncio
import logging
import re
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from twikit import Client as XClient
from x_compat import CurrentTransaction
from instagram_web import request as instagram_web_request

# Third-party exceptions can contain request headers; never emit them.
logging.disable(logging.CRITICAL)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

def person(u):
    return {'id': str(getattr(u, 'id', getattr(u, 'pk', ''))),
            'name': getattr(u, 'name', None) or getattr(u, 'full_name', None) or getattr(u, 'username', ''),
            'handle': getattr(u, 'screen_name', None) or getattr(u, 'username', '')}

def ig_media(m):
    images = m.get('carousel_media') or [m]
    return {'id': str(m.get('id', m.get('pk', ''))), 'text': (m.get('caption') or {}).get('text', ''),
            'author': (m.get('user') or {}).get('username', ''),
            'url': 'https://www.instagram.com/p/' + str(m.get('code', '')) + '/',
            'images': [i['image_versions2']['candidates'][0]['url'] for i in images if i.get('image_versions2', {}).get('candidates')][:10]}

async def x_request(route, auth, args):
    client = XClient('en-US', timeout=20)
    client.client_transaction = CurrentTransaction()
    client.set_cookies(auth.get('cookies') or {'auth_token': auth['auth_token'], 'ct0': auth['ct0']})
    if auth.get('user'): client._user_id = auth['user']
    try:
        cursor = args.get('cursor') or None
        if route == 'connection':
            u = await client.user()
            auth = {'user': u.id, 'cookies': client.get_cookies()}
            result = {'account': '@' + u.screen_name}
        elif route == 'feed':
            method = client.get_latest_timeline if args.get('mode') == 'following' else client.get_timeline
            tweets = await method(count=20, cursor=cursor)
            result = {'items': [{'id': t.id, 'text': t.full_text, 'author': '@' + t.user.screen_name,
                                'url': 'https://x.com/' + t.user.screen_name + '/status/' + t.id,
                                'images': [m['media_url_https'] for m in (t.media or []) if m.get('media_url_https')][:4]}
                               for t in tweets], 'cursor': tweets.next_cursor or ''}
        elif route == 'following':
            users = await client.get_user_following(auth['user'], count=50, cursor=cursor)
            result = {'items': [person(u) for u in users], 'cursor': users.next_cursor or ''}
        elif route == 'conversations':
            data, _ = await client.get('https://x.com/i/api/1.1/dm/inbox_initial_state.json',
                                       params={'include_conversation_info': 'true'}, headers=client._base_headers)
            inbox = data.get('inbox_initial_state', {})
            users = inbox.get('users', {})
            result = {'items': [{'id': cid, 'name': c.get('name') or ', '.join(
                users.get(str(p.get('user_id')), {}).get('name', str(p.get('user_id')))
                for p in c.get('participants', []) if str(p.get('user_id')) != auth['user']) or cid}
                for cid, c in inbox.get('conversations', {}).items()], 'cursor': ''}
        elif route == 'messages':
            channel = args['channel']
            if args.get('write'):
                await client.v11.dm_new(channel, args['text'], None, None)
                result = {'ok': True}
            else:
                data = (await client._get_dm_history(channel, cursor)).get('conversation_timeline', {})
                users = data.get('users', {})
                entries = [e['message']['message_data'] for e in data.get('entries', []) if e.get('message', {}).get('message_data')]
                result = {'items': sorted([{'id': m['id'], 'text': m.get('text', ''),
                    'author': users.get(m.get('sender_id'), {}).get('name', m.get('sender_id', '')),
                    'createdAt': int(m.get('time', 0)), 'images': []} for m in entries], key=lambda m: m['createdAt']),
                    'cursor': data.get('min_entry_id', '') if data.get('status') != 'AT_END' else ''}
        else: raise ValueError('route')
        auth['cookies'] = client.get_cookies()
        return result, auth
    finally:
        await client.http.aclose()

@app.get('/health')
async def health(): return {'ok': True}

@app.post('/request')
async def request(req: Request):
    # Cloud Run IAM validates the caller identity before this handler runs.
    if int(req.headers.get('content-length', '0')) > 100000:
        return JSONResponse({'error': 'Request too large'}, status_code=413)
    body = bytearray()
    async for chunk in req.stream():
        body.extend(chunk)
        if len(body) > 100000: return JSONResponse({'error': 'Request too large'}, status_code=413)
    import json
    write = False
    data = {}
    try:
        data = json.loads(body)
        provider, route, auth, args = data['provider'], data['route'], data['auth'], data.get('args', {})
        write = bool(args.get('write'))
        if provider not in ('x', 'instagram') or route not in ('connection', 'feed', 'following', 'conversations', 'messages'): raise ValueError('route')
        if len(args.get('cursor', '')) > 2000: raise ValueError('cursor')
        if route == 'messages' and not re.fullmatch(r'[0-9-]{1,80}', args.get('channel', '')): raise ValueError('channel')
        if write and (route != 'messages' or not isinstance(args.get('text'), str) or not 1 <= len(args['text'].strip()) <= 4000): raise ValueError('message')
        if provider == 'x':
            result, state = await x_request(route, auth, args)
        else:
            result, state = await asyncio.to_thread(instagram_web_request, route, auth, args, ig_media)
        return JSONResponse({'result': result, 'auth': state}, headers={'Cache-Control': 'no-store'})
    except Exception as e:
        name = type(e).__name__
        import traceback
        frames = traceback.extract_tb(e.__traceback__)
        print(json.dumps({'event':'social_error','provider':data.get('provider') if isinstance(data,dict) else None,'route':data.get('route') if isinstance(data,dict) else None,'error_type':name,'frames':[{'file':f.filename.rsplit('/',1)[-1],'line':f.lineno,'function':f.name} for f in frames[-5:]]}),flush=True)
        if write:
            error = 'Send result unknown. Check the original app before retrying.'
        elif any(s in name.lower() for s in ['login', 'unauthorized', 'challenge', 'checkpoint', 'forbidden', 'badrequest', 'permission', 'sessionrejected']):
            error = 'Session rejected. Open the original app, complete any account checks, then reconnect.'
        elif any(s in name.lower() for s in ['ratelimit', 'toomany', 'pleasewait']):
            error = 'Service rate limit. Try again later.'
        else:
            error = 'Service request failed (' + name + ').'
        return JSONResponse({'error': error, 'error_status': 502}, headers={'Cache-Control': 'no-store'})
