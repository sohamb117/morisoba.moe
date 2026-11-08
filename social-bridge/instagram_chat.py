"""Instagram web chat queries. No automatic retries for message sends."""
import json
import re
import secrets
import time

PV = {'__relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider': True,
      '__relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider': 5,
      '__relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider': True}


def request(client, route, auth, args, user_id, failure):
    state = dict(auth.get('chat') or {})
    page = client.get('/direct/inbox/', headers={'Accept':'text/html', 'Sec-Fetch-Site':'none',
        'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document','Sec-Fetch-User':'?1','Upgrade-Insecure-Requests':'1'})
    if page.status_code != 200: raise failure()
    def grab(pattern):
        match = re.search(pattern, page.text)
        return match.group(1) if match else ''
    dtsg = grab(r'"DTSGInitialData",\[\],\{"token":"([^"]+)"')
    lsd = grab(r'"LSD",\[\],\{"token":"([^"]+)"')
    if not dtsg or not lsd: raise failure()
    for cookie in client.cookies.jar:
        if cookie.name == 'csrftoken': client.headers['X-CSRFToken'] = cookie.value
    base = {'av':user_id,'__user':'0','__a':'1','__d':'www','__req':'1','dpr':'2','__comet_req':'7',
        '__hs':grab(r'"haste_session":"([^"]+)"'), '__spin_r':grab(r'"__spin_r":([0-9]+)'),
        '__spin_t':grab(r'"__spin_t":([0-9]+)'), '__spin_b':'trunk',
        'fb_dtsg':dtsg,'lsd':lsd,'jazoest':'2'+str(sum(map(ord,dtsg))),'server_timestamps':'true',
        'fb_api_caller_class':'RelayModern'}
    def query(doc, name, variables):
        res = client.post('/api/graphql', data={**base,'doc_id':doc,'fb_api_req_friendly_name':name,
            'variables':json.dumps(variables,separators=(',',':'))}, headers={
            'X-FB-LSD':lsd,'X-FB-Friendly-Name':name,'X-ASBD-ID':'359341',
            'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty',
            'Referer':'https://www.instagram.com/direct/inbox/'})
        if res.status_code != 200: raise failure()
        try: data=json.loads(res.text.removeprefix('for (;;);').strip().split('\n',1)[0])
        except ValueError: raise failure() from None
        if data.get('errors') or data.get('error') or not data.get('data'): raise failure()
        return data['data']
    def next_cursor(connection):
        info=connection.get('page_info') or {}
        return info.get('end_cursor','') if info.get('has_next_page') else ''
    cursor=args.get('cursor') or ''
    if route=='conversations':
        if cursor and state.get('mailbox'):
            data=query('28774058922187457','IGDThreadListOffMsysPaginationQuery',
                {**PV,'count':20,'cursor':cursor,'folder':'INBOX','id':state['mailbox'],'newer_than_timestamp_ms':None})
            connection=(data.get('fetch__SlideMailbox') or {}).get('threads_by_folder') or {}
        else:
            data=query('27909866362025854','PolarisDirectInboxQuery',{**PV,
                'device_id_for_iris_subscription':state.setdefault('device',secrets.token_hex(16)),
                '__relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider':False})
            mailbox=data.get('get_slide_mailbox_for_iris_subscription')
            if not mailbox: raise failure()
            state['mailbox']=mailbox['id']
            connection=mailbox.get('threads_by_folder') or {}
        items=[]
        threads=dict(state.get('threads') or {})
        for edge in connection.get('edges',[]):
            raw=(edge.get('node') or {}).get('as_ig_direct_thread') or {}
            key=str(raw.get('thread_key') or '')
            fbid=str(raw.get('thread_fbid') or raw.get('id') or '')
            if not key or not fbid: continue
            threads[key]=fbid
            items.append({'id':key,'name':raw.get('thread_title') or ', '.join(u.get('username','') for u in raw.get('users',[]))})
        state['threads']=dict(list(threads.items())[-1000:])
        return {'items':items,'cursor':next_cursor(connection)},state
    channel=args['channel']
    fbid=(state.get('threads') or {}).get(channel)
    if not fbid: raise failure()
    if args.get('write'):
        query('26911679871773184','IGDirectTextSendMutation',{
            'text':{'sensitive_string_value':args['text']},'ig_thread_igid':fbid,'recipient_igids':None,
            'offline_threading_id':str((int(time.time()*1000)<<22)+secrets.randbits(22)),
            'send_attribution':'igd_web_chat_tab:in_thread','mentions':[],'mentioned_user_ids':[],
            'commands':None,'forwarded_from_thread_id':None,'is_forwarded_from_own_message':None,
            'replied_to_client_context':None,'replied_to_item_id':None,'reply_to_message_id':None,'sampled':None})
        return {'ok':True},state
    if cursor:
        data=query('29380270148264352','IGDMessageListOffMsysQuery',{'after':cursor,'before':None,
            'first':30,'last':None,'id':fbid,'newer_than_message_id':None,'older_than_message_id':None,
            '__relay_internal__pv__IGDInitialMessagePageCountrelayprovider':30})
        thread=(data.get('fetch__SlideThread') or {}).get('as_ig_direct_thread') or {}
    else:
        data=query('29432273173041378','IGDThreadDetailQuery',{'min_uq_seq_id':None,'thread_fbid':channel,
            '__relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider':False,
            '__relay_internal__pv__IGDInitialMessagePageCountrelayprovider':30})
        thread=(data.get('get_slide_thread_nullable') or {}).get('as_ig_direct_thread') or {}
    if not thread: raise failure()
    connection=thread.get('slide_messages') or {}
    items=[]
    for edge in connection.get('edges',[]):
        node=edge.get('node') or {};content=node.get('content') or {};sender=node.get('sender') or {}
        user=sender.get('user_dict') or {}
        items.append({'id':str(node.get('message_id') or node.get('id') or ''),
            'text':node.get('text_body') or content.get('text_body') or content.get('xma_text_body') or '[attachment]',
            'author':user.get('username') or str(sender.get('igid') or user.get('id') or ''),
            'createdAt':int(node.get('timestamp_ms') or 0),'images':[]})
    return {'items':sorted(items,key=lambda m:m['createdAt']),'cursor':next_cursor(connection)},state
