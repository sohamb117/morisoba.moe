"""Use browser sessions with Instagram's web host, never the mobile host."""
import json
from urllib.parse import quote, unquote
import httpx
from instagram_chat import request as chat_request

class BrowserSessionRejected(Exception): pass
class BrowserRequestFailed(Exception): pass

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15'

def request(route, auth, args, media_parser):
    settings = auth.get('settings', {})
    saved = auth.get('cookies') or settings.get('cookies', {})
    session = auth.get('sessionid') or saved.get('sessionid') or settings.get('authorization_data', {}).get('sessionid')
    if not session: raise BrowserSessionRejected()
    user_id = str(settings.get('authorization_data', {}).get('ds_user_id') or saved.get('ds_user_id') or unquote(session).split(':')[0])
    if not user_id.isdigit(): raise BrowserSessionRejected()
    cookies = {'sessionid': quote(unquote(session), safe=''), 'ds_user_id': user_id}
    if saved.get('csrftoken'): cookies['csrftoken'] = saved['csrftoken']
    with httpx.Client(base_url='https://www.instagram.com', timeout=20, follow_redirects=False,
                      headers={'User-Agent':UA,'X-IG-App-ID':'936619743392459','Referer':'https://www.instagram.com/',
                               'Origin':'https://www.instagram.com','Accept':'application/json'}, cookies=cookies) as client:
        # Bootstrap only if the connection predates the browser-cookie adapter.
        if not cookies.get('csrftoken'):
            homepage = client.get('/')
            if homepage.status_code >= 400: raise BrowserRequestFailed()
            for cookie in client.cookies.jar:
                if cookie.name == 'csrftoken': cookies['csrftoken'] = cookie.value
        if not cookies.get('csrftoken'): raise BrowserSessionRejected()
        client.headers['X-CSRFToken'] = cookies['csrftoken']
        def call(path, params=None, form=None):
            response = client.post('/api/v1/'+path, data=form) if form is not None else client.get('/api/v1/'+path, params=params)
            if response.status_code in (301,302,303,307,308,401,403): raise BrowserSessionRejected()
            if response.status_code == 429: raise BrowserRateLimit()
            if not response.is_success: raise BrowserRequestFailed()
            try: data=response.json()
            except ValueError: raise BrowserRequestFailed() from None
            if data.get('message') in ('login_required','challenge_required','checkpoint_required'): raise BrowserSessionRejected()
            if data.get('status') == 'fail': raise BrowserRequestFailed()
            return data
        cursor=args.get('cursor') or ''
        if route in ('connection','feed'):
            feed=call('feed/timeline/',form={'reason':'pagination' if cursor else 'cold_start_fetch','is_pull_to_refresh':'0',
                'phone_id':'00000000-0000-0000-0000-000000000000','battery_level':'100','is_charging':'1','will_sound_on':'0',**({'pagination_source':'following'} if route=='feed' and args.get('mode')=='following' else {}),**({'max_id':cursor} if cursor else {})})
            media=[i['media_or_ad'] for i in feed.get('feed_items',[]) if i.get('media_or_ad')]
            if not media: media=feed.get('items',[])
            if 'feed_items' not in feed and 'items' not in feed: raise BrowserRequestFailed()
            if route=='feed' and args.get('mode')=='following':
                print(json.dumps({'event':'social_feed','provider':'instagram','mode':'following',
                    'source':feed.get('pagination_source') if feed.get('pagination_source') in ('following','feed_recs','favorites','past_posts') else 'unspecified',
                    'items':len(media),'followed':sum(1 for m in media if (m.get('user') or {}).get('friendship_status',{}).get('following') is True)}),flush=True)
            result={'account':auth.get('username') or 'Instagram '+user_id} if route=='connection' else {'items':[media_parser(m) for m in media if not m.get('ad_id')], 'cursor':feed.get('next_max_id') or ''}
        elif route=='following':
            data=call('friendships/'+user_id+'/following/',params={'count':50,**({'max_id':cursor} if cursor else {})})
            result={'items':[{'id':str(u['pk']),'name':u.get('full_name') or u['username'],'handle':u['username']} for u in data.get('users',[])], 'cursor':data.get('next_max_id') or ''}
        elif route in ('conversations','messages'):
            result, chat = chat_request(client, route, auth, args, user_id, BrowserRequestFailed)
            auth = {**auth, 'chat':chat}
        else: raise ValueError('route')
        # Keep only the explicitly used cookie names, with no cross-domain cookie jar.
        for cookie in client.cookies.jar:
            if cookie.name in cookies and cookie.domain.lstrip('.') in ('instagram.com','www.instagram.com'):
                cookies[cookie.name]=cookie.value
        return result,{'cookies':cookies,'username':auth.get('username',''),'transport':'web','chat':auth.get('chat',{})}

class BrowserRateLimit(Exception): pass
