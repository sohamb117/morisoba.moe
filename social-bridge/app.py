"""Private session adapters. Credentials arrive only from the authenticated Worker."""
import asyncio
import logging
import re
from urllib.parse import unquote
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from twikit import Client as XClient
from instagrapi import Client as InstagramClient
from instagrapi.extractors import extract_direct_thread

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

def ig_message(m, users):
    media = getattr(m, 'media_share', None)
    return {'id': str(m.id), 'text': m.text or ('[Shared media]' if media else '[' + str(m.item_type) + ']'),
            'author': users.get(str(m.user_id), str(m.user_id)), 'createdAt': m.timestamp.isoformat(),
            'images': [str(media.thumbnail_url)] if media and media.thumbnail_url else []}

async def x_request(route, auth, args):
    client = XClient('en-US', timeout=20)
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

def instagram_request(route, auth, args):
    client = InstagramClient(session_retry_total=0)
    def reject_challenge(*args, **kwargs):
        raise PermissionError('Account check required')
    client.challenge_resolve = reject_challenge
    def single_request(endpoint, data=None, **kwargs):
        headers = dict(kwargs.pop('headers', None) or {})
        if client.authorization: headers['Authorization'] = client.authorization
        return client._send_private_request(endpoint, data=data, headers=headers, **kwargs)
    client.private_request = single_request
    client.request_timeout = 1
    client.public_request_retries_count = 1
    client.delay_range = [0, 0]
    # Stable device/session data is encrypted with the connection after initial login.
    if auth.get('settings'):
        client.set_settings(auth['settings'])
        client.username = auth.get('username', '')
    elif route == 'connection':
        client.login_by_sessionid(unquote(auth['sessionid']))
    else:
        raise ValueError('session')
    cursor = args.get('cursor') or None
    if route == 'connection':
        account = client.account_info()
        client.username = account.username
        result = {'account': '@' + account.username}
    elif route == 'feed':
        feed = client.get_timeline_feed(reason='pagination' if cursor else 'pull_to_refresh', max_id=cursor)
        media = [i.get('media_or_ad') for i in feed.get('feed_items', []) if i.get('media_or_ad')]
        if not media: media = feed.get('items', [])
        result = {'items': [ig_media(m) for m in media if not m.get('ad_id')], 'cursor': feed.get('next_max_id') or ''}
    elif route == 'following':
        users, next_cursor = client.user_following_v1_chunk(str(client.user_id), max_amount=50, max_id=cursor or '')
        result = {'items': [person(u) for u in users], 'cursor': next_cursor or ''}
    elif route == 'conversations':
        threads, next_cursor = client.direct_threads_chunk(cursor=cursor, thread_message_limit=1)
        result = {'items': [{'id': str(t.id), 'name': t.thread_title or ', '.join(u.username for u in t.users)} for t in threads], 'cursor': next_cursor or ''}
    elif route == 'messages':
        channel = args['channel']
        if args.get('write'):
            client.direct_answer(int(channel), args['text'])
            result = {'ok': True}
        else:
            raw = client.private_request('direct_v2/threads/' + channel + '/', params={
                'direction': 'older', 'limit': '20', **({'cursor': cursor} if cursor else {})})['thread']
            thread = extract_direct_thread(raw)
            users = {str(u.pk): u.username for u in thread.users}
            users[str(client.user_id)] = client.username or 'you'
            result = {'items': [ig_message(m, users) for m in reversed(thread.messages)],
                      'cursor': raw.get('oldest_cursor', '') if raw.get('has_older') else ''}
    else: raise ValueError('route')
    return result, {'settings': client.get_settings(), 'username': client.username or auth.get('username', '')}

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
            result, state = await asyncio.to_thread(instagram_request, route, auth, args)
        return JSONResponse({'result': result, 'auth': state}, headers={'Cache-Control': 'no-store'})
    except Exception as e:
        name = type(e).__name__
        import traceback
        frames = traceback.extract_tb(e.__traceback__)
        print(json.dumps({'event':'social_error','provider':data.get('provider') if isinstance(data,dict) else None,'route':data.get('route') if isinstance(data,dict) else None,'error_type':name,'frames':[{'file':f.filename.rsplit('/',1)[-1],'line':f.lineno,'function':f.name} for f in frames[-5:]]}),flush=True)
        if write:
            error = 'Send result unknown. Check the original app before retrying.'
        elif any(s in name.lower() for s in ['login', 'unauthorized', 'challenge', 'checkpoint', 'forbidden', 'badrequest', 'permission']):
            error = 'Session rejected. Open the original app, complete any account checks, then reconnect.'
        elif any(s in name.lower() for s in ['ratelimit', 'toomany', 'pleasewait']):
            error = 'Service rate limit. Try again later.'
        else:
            error = 'Service request failed (' + name + ').'
        return JSONResponse({'error': error}, status_code=502, headers={'Cache-Control': 'no-store'})
