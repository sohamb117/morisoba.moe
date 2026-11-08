"""Discover transaction indices in both webpack and current X module builds."""
import asyncio
import re
from urllib.parse import urljoin
from twikit.x_client_transaction.transaction import ClientTransaction, INDICES_REGEX

ROOT = 'https://abs.twimg.com/x-web/x-web/'
IMPORT = re.compile(r'''(?:from\s*|import\s*\()["'`]((?:\./)?assets/[\w-]+\.js|\./[\w-]+\.js)["'`]''')

class CurrentTransaction(ClientTransaction):
    async def get_indices(self, home_page_response, session, headers):
        html = str(home_page_response)
        async def fetch(url):
            # Asset discovery cannot redirect credentials or requests to another host.
            if not url.startswith('https://abs.twimg.com/'): raise RuntimeError('X asset host changed')
            response = await session.get(url, headers=headers, follow_redirects=False)
            response.raise_for_status()
            if len(response.content) > 8_000_000: raise RuntimeError('X asset too large')
            return response.text
        old = re.search(r'''["']ondemand\.s["']\s*:\s*["']([a-f0-9]+)["']''', html)
        asset_hash = old.group(1) if old else None
        if not asset_hash:
            chunk = re.search(r'''(?:[,{])\s*(\d+)\s*:\s*["']ondemand\.s["']''', html)
            if chunk:
                match = re.search(r'''(?:[,{])\s*''' + re.escape(chunk.group(1)) + r'''\s*:\s*["']([a-f0-9]+)["']''', html)
                asset_hash = match.group(1) if match else None
        if asset_hash:
            source = await fetch('https://abs.twimg.com/responsive-web/client-web/ondemand.s.' + asset_hash + 'a.js')
        else:
            entry = re.search(r'https://abs\.twimg\.com/x-web/x-web/entry-client-[\w-]+\.js', html)
            if not entry: raise RuntimeError('X entry module changed')
            entry_source = await fetch(entry.group())
            urls = list(dict.fromkeys(urljoin(entry.group(), m.group(1)) for m in IMPORT.finditer(entry_source)))[:16]
            modules = await asyncio.gather(*(fetch(url) for url in urls))
            source = None
            for url, module in zip(urls, modules):
                marker = module.find('x-botox-client-transaction-id')
                if marker < 0: continue
                # The transaction loader immediately precedes the request middleware.
                loaders = list(re.finditer(r'''import\(["'`](\./[\w-]+\.js)["'`]\)\.then\(\w+=>\w+\.default\(\)\)''', module[max(0,marker-2500):marker]))
                if loaders:
                    source = await fetch(urljoin(url, loaders[-1].group(1)))
                    break
            if source is None: raise RuntimeError('X transaction loader changed')
        indices = [int(m.group(2)) for m in INDICES_REGEX.finditer(source)]
        if len(indices) < 2: raise RuntimeError('X transaction asset changed')
        return indices[0], indices[1:]


def normalize_users(value):
    """Adapt optional profile metadata before twikit constructs User objects."""
    if isinstance(value, list):
        return [normalize_users(item) for item in value]
    if not isinstance(value, dict):
        return value
    value = {key: normalize_users(item) for key, item in value.items()}
    if value.get('__typename') != 'User' or not value.get('rest_id'):
        return value
    legacy = dict(value.get('legacy') or {})
    core = value.get('core') or {}
    for key in ('name', 'screen_name', 'created_at'):
        if key in core:
            legacy[key] = core[key]
    avatar = value.get('avatar') or {}
    if avatar.get('image_url'):
        legacy['profile_image_url_https'] = avatar['image_url']
    location = value.get('location') or {}
    if isinstance(location, dict) and 'location' in location:
        legacy['location'] = location['location']
    # Identity fields remain required. Missing metadata must not hide bad auth
    # responses or manufacture a successful account identity.
    for key in ('created_at', 'profile_image_url_https', 'location', 'description', 'translator_type'):
        legacy.setdefault(key, '')
    for key in ('pinned_tweet_ids_str', 'withheld_in_countries'):
        legacy.setdefault(key, [])
    for key in ('verified', 'possibly_sensitive', 'can_dm', 'can_media_tag', 'want_retweets',
                'default_profile', 'default_profile_image', 'has_custom_timelines', 'is_translator'):
        legacy.setdefault(key, False)
    for key in ('followers_count', 'fast_followers_count', 'normal_followers_count', 'friends_count',
                'favourites_count', 'listed_count', 'media_count', 'statuses_count'):
        legacy.setdefault(key, 0)
    entities = dict(legacy.get('entities') or {})
    description = dict(entities.get('description') or {})
    description.setdefault('urls', [])
    entities['description'] = description
    if entities.get('url') is None:
        entities.pop('url', None)
    legacy['entities'] = entities
    value['legacy'] = legacy
    value.setdefault('is_blue_verified', False)
    return value


from twikit import Client

class CompatibleClient(Client):
    async def request(self, *args, **kwargs):
        data, response = await super().request(*args, **kwargs)
        return normalize_users(data), response
