# ZAP baseline hook: the public intake surface (Hardening H2f; docs/porting/maps/H2.md
# part 6, "DAST"; owner decision 178).
#
# The baseline's spider reaches only what a signed-in page links to, and the
# public form at /f/<publicId> and its two POST routes are linked from nowhere.
# dast.yml publishes a public form and writes /zap/wrk/zap-public-intake.json
# (the workspace mounted by zaproxy/action-baseline): the page's URL, a valid
# submission (a signed token from the page, its proof-of-work solved), a
# refused one and a confirmation with a made-up token. This hook sends each
# through ZAP once it has started, so the passive rules read the page and the
# three answers like any spidered URL. Written fresh for Islestone.
import json
from urllib.parse import urlparse

CONFIG = '/zap/wrk/zap-public-intake.json'


def zap_started(zap, target):
    # No file means dast.yml's setup did not run: fail the scan, never scan less in silence.
    with open(CONFIG, encoding='utf-8') as f:
        config = json.load(f)
    for url in config['get']:
        zap.core.access_url(url=url, followredirects='true')
    for post in config['post']:
        url = post['url']
        host = urlparse(url).netloc
        body = post['body']
        raw = (
            f'POST {url} HTTP/1.1\r\n'
            f'Host: {host}\r\n'
            'Content-Type: application/json\r\n'
            'Sec-Fetch-Site: same-origin\r\n'
            f'Content-Length: {len(body.encode("utf-8"))}\r\n'
            '\r\n'
            f'{body}'
        )
        zap.core.send_request(request=raw, followredirects='false')
