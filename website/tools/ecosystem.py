"""Render the ecosystem diagrams as portable, dependency-free SVGs."""
from pathlib import Path
from html import escape
import sys

REPO = Path(__file__).resolve().parents[2]
LIBRARY = REPO / 'brand' / 'diagrams'
WEBSITE = REPO / 'website' / 'dist' / 'assets'
ICONS = {
    'mint': '<circle cx="12" cy="12" r="9"/><path d="M9 8h5a2 2 0 0 1 0 4H9m0 0h5a2 2 0 0 1 0 4H9m2-10v12"/>',
    'wallet': '<path d="M4 6h14v4M4 6V4h13v2M4 6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16V8H4m16 4h-6v5h6"/><circle cx="16.5" cy="14.5" r=".5"/>',
    'till': '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M9 6h6m-6 4h6m-6 4h2m2 0h2m-6 3h2m2 0h2"/>',
    'ops': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v7c0 4 18 4 18 0V5M3 12v7c0 4 18 4 18 0v-7"/>',
    'ccp': '<rect x="3" y="2" width="12" height="20" rx="3"/><path d="M7 5h4m-3 14h2m9-12c3 3 3 7 0 10m-2-8c2 2 2 4 0 6"/>',
    'copy': '<path d="M5 8a8 8 0 0 1 13-3l2 2m0-5v5h-5M19 16a8 8 0 0 1-13 3l-2-2m0 5v-5h5"/>',
    'storage': '<path d="M2 7V4h8l3 3h9v13H2V7Zm0 3h20"/>',
    'alerts': '<path d="M5 15v-5a7 7 0 0 1 14 0v5l2 3H3l2-3m4 6h6"/>',
    'key': '<circle cx="8" cy="9" r="5"/><path d="m12 13 9 9m-5-5 3-3m0 6 3-3"/>',
    'chip': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 4v16m6-16v16M4 9h5m-5 6h5m6-6h5m-5 6h5"/>',
}

STYLE = '''
svg{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
.node{fill:url(#surface);stroke:#365747;stroke-width:1.2}
.support .node{fill:#0d2119;stroke:#365044}
.kicker{fill:#96af9f;font-size:12px;letter-spacing:1.5px;font-weight:600}
.title{fill:#edf4e8;font-size:22px;font-weight:650;letter-spacing:-.5px}
.body{fill:#aac2b0;font-size:16px}
.icon{fill:none;stroke:#cceaa2;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.lane{fill:#8eaa99;font-size:12px;font-weight:650;letter-spacing:2px}
.edge{fill:none;stroke:#83a99d;stroke-width:1.7;stroke-linejoin:round}
.nfc{stroke:#cceaa2;stroke-width:2}
.recovery{stroke:#b9ab85;stroke-dasharray:5 5}
.edge-label{fill:#a6c0ac;font-size:14px;text-anchor:middle}
.nfc-label{fill:#cceaa2}
.recovery-label{fill:#c5bda5}
.card-title{fill:#163021;font-size:24px;font-weight:700;letter-spacing:-.6px}
.card-body{fill:#254331;font-size:16px}
.card-chip{fill:none;stroke:#32553b;stroke-width:1.5;stroke-linecap:round}
'''

def text(x, y, value, cls, extra=''):
    return f'<text x="{x}" y="{y}" class="{cls}" {extra}>{escape(value)}</text>'


def edge(path, kind='', both=False):
    marker = {'nfc': 'lime', 'recovery': 'sand'}.get(kind, 'soft')
    return f'<path d="{path}" class="edge {kind}" marker-end="url(#{marker})"' + (f' marker-start="url(#{marker})"' if both else '') + '/>'


def label(x, y, value, kind=''):
    width = len(value) * 7.3 + 18
    return f'<rect x="{x-width/2:g}" y="{y-14}" width="{width:g}" height="21" rx="8" fill="#0a1d15"/>' + text(x, y, value, f'edge-label {kind}-label')


def node(x, y, width, height, icon, role, title, lines, support=False, mobile=False):
    ty = 56 if mobile else 63
    parts = [f'<g class="{"support" if support else "component"}" transform="translate({x} {y})">',
             f'<rect class="node" width="{width}" height="{height}" rx="12"/>',
             f'<use href="#icon-{icon}" class="icon" x="16" y="14" width="22" height="22"/>',
             text(46, 29, role, 'kicker') if not mobile else '',
             text(16, ty, title, 'title'),
             *[text(16, ty+25+i*21, line, 'body') for i, line in enumerate(lines)], '</g>']
    return ''.join(parts)


def card(x, y, width, height, mobile=False):
    return f'''<g transform="translate({x} {y})">
<rect width="{width}" height="{height}" rx="15" fill="url(#card)" stroke="#ddf4b7"/>
<use href="#icon-chip" class="card-chip" x="17" y="16" width="30" height="30"/>
<path d="M{width-40} 21q9 8 0 16m5-21q14 13 0 26" class="card-chip"/>
{text(17, 76 if mobile else 80, 'Cashu card', 'card-title')}
{text(17, 101 if mobile else 106, 'Applet on chip', 'card-body')}
{text(17, 124 if mobile else 129, 'Spending key' if mobile else 'Spending key + ecash', 'card-body')}
</g>'''


def render(mobile=False):
    width, height = (360, 1168) if mobile else (1000, 824)
    defs = f'''<defs>
<linearGradient id="surface" x2="1" y2="1"><stop stop-color="#173326"/><stop offset="1" stop-color="#10251c"/></linearGradient>
<linearGradient id="card" x2=".8" y2="1"><stop stop-color="#def4b5"/><stop offset="1" stop-color="#a8cd83"/></linearGradient>
{''.join(f'<symbol id="icon-{key}" viewBox="0 0 24 24">{value}</symbol>' for key,value in ICONS.items())}
{''.join(f'<marker id="{name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="m1 1 8 4-8 4" fill="none" stroke="{color}" stroke-width="1.5"/></marker>' for name,color in [('soft','#83a99d'),('lime','#cceaa2'),('sand','#b9ab85')])}
</defs>'''
    if not mobile:
        parts = [text(32, 29, 'PAYMENTS', 'lane'),
                 text(968, 29, 'NUT-CCP / DRAFT', 'lane', 'text-anchor="end"'),
                 '<path d="M32 370H968M32 594H968" stroke="#294435"/>',
                 text(32, 399, 'ISSUANCE', 'lane'), text(32, 623, 'RECOVERY', 'lane'),
                 edge('M390 100H147V198', both=True), label(264, 83, 'Cashu API'),
                 edge('M853 198V100H610'), label(742, 83, 'Settle online'),
                 edge('M262 260H385', 'nfc'), label(323, 244, 'Own + load', 'nfc'),
                 edge('M615 260H738', 'nfc'), label(676, 244, 'Tap to pay', 'nfc'),
                 edge('M262 494H385', both=True), label(323, 477, 'Keys + records'),
                 edge('M500 432V338', 'nfc'), label(572, 390, 'Install / reset', 'nfc'),
                 edge('M147 556V644', 'recovery'), label(229, 583, 'Encrypted export', 'recovery'),
                 edge('M262 697H385', 'recovery'), label(323, 680, 'Copy + verify', 'recovery'),
                 edge('M147 750V796H853V750', 'recovery'), label(500, 796, 'Failure / stale-copy alerts', 'recovery'),
                 node(390,52,220,96,'mint','MINT OPERATOR','Cashu mint',['Issues + settles ecash']),
                 node(32,198,230,126,'wallet','HOLDER','Wallet',['Owner key + funding']),
                 card(385,192,230,146),
                 node(738,198,230,126,'till','MERCHANT','Till app',['Accepts + queues taps']),
                 node(32,432,230,124,'ops','CARD ISSUER','Ops-service',['Manager keys + records','SQLite · files / R2']),
                 node(385,432,230,124,'ccp','OPERATOR','CCP app',['NFC installation + reset']),
                 node(738,432,230,124,'key','SEPARATE CUSTODY','Backup key',['Vault + offline copy'], True),
                 node(32,644,230,106,'copy','HOST-SPECIFIC','Backup / copy job',['Scheduler or Atoll*'], True),
                 node(385,644,230,106,'storage','INDEPENDENT STORAGE','Backup files',['e.g. Nextcloud'], True),
                 node(738,644,230,106,'alerts','ALERT DELIVERY','Notifications',['e.g. ntfy'], True)]
    else:
        parts = [text(16,28,'PAYMENTS','lane'), text(344,28,'NUT-CCP / DRAFT','lane','text-anchor="end"'),
                 '<path d="M16 538H344M16 784H344" stroke="#294435"/>',
                 text(16,563,'ISSUANCE','lane'), text(180,810,'RECOVERY','lane','text-anchor="middle"'),
                 edge('M128 148V174H90V203', both=True), label(79,176,'Cashu API'),
                 edge('M270 203V174H232V148'), label(280,176,'Settle online'),
                 edge('M90 323V444H102','nfc'), label(62,350,'Own + load','nfc'),
                 edge('M258 444H270V323','nfc'), label(299,350,'Tap to pay','nfc'),
                 edge('M164 678H196',both=True), label(180,603,'Keys + records'),
                 edge('M270 620V555H180V524','nfc'), label(275,585,'Install / reset','nfc'),
                 edge('M90 732V860','recovery'), label(174,760,'Encrypted export','recovery'),
                 edge('M164 914H196','recovery'), label(180,843,'Copy + verify','recovery'),
                 edge('M90 968V1062H196','recovery'), label(95,1004,'Alerts','recovery'),
                 node(102,56,156,92,'mint','','Cashu mint',['Issue + settle'], mobile=True),
                 node(16,203,148,120,'wallet','','Wallet',['Owner key','Load ecash'],mobile=True),
                 node(196,203,148,120,'till','','Till app',['Accept taps','Settle online'],mobile=True),
                 card(102,378,156,146,True),
                 node(16,620,148,112,'ops','','Ops-service',['Manager keys','Card records'],mobile=True),
                 node(196,620,148,112,'ccp','','CCP app',['Install + reset'],mobile=True),
                 node(16,860,148,108,'copy','','Backup job',['Scheduler /','Atoll*'],True,True),
                 node(196,860,148,108,'storage','','Backup files',['e.g. Nextcloud'],True,True),
                 node(196,1020,148,86,'alerts','','Notifications',['e.g. ntfy'],True,True),
                 '<path d="M16 1122H344" stroke="#294435"/>',
                 '<use href="#icon-key" class="icon" x="16" y="1136" width="20" height="20"/>',
                 text(45,1151,'Backup key: vault + offline copy','body')]
    # Mobile titles and body keep their intended size in the compact node layout.
    style = STYLE + ('.title{font-size:19px}.body{font-size:16px}.card-title{font-size:22px}.card-body{font-size:16px}' if mobile else '')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">
<title id="title">Cashu Card ecosystem</title>
<desc id="desc">Wallets and tills use the mint and tap one physical card running the applet. The ops-service authorizes CCP to install or reset that card. Encrypted exports go through a backup job to independent storage and alerts. The backup decryption key has separate custody.</desc>
<style>{style}</style>
{defs}
<rect width="{width}" height="{height}" rx="16" fill="#0a1d15"/>
{''.join(parts)}
</svg>
'''

for mobile in (False, True):
    name = 'ecosystem-mobile.svg' if mobile else 'ecosystem.svg'
    rendered = render(mobile)
    for directory in (LIBRARY, WEBSITE):
        file = directory / name
        if '--check' in sys.argv:
            if not file.exists() or file.read_text() != rendered:
                raise SystemExit(f'Regenerate {file} with python3 website/tools/ecosystem.py')
        else:
            directory.mkdir(parents=True, exist_ok=True)
            file.write_text(rendered)
print('Ecosystem SVGs verified.' if '--check' in sys.argv else 'Ecosystem SVGs generated.')
