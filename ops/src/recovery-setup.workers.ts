import {randomBytes} from 'node:crypto';

/** Same-origin approval surface. Sessions and pairing codes stay in memory. */
export function recoverySetup(): Response {
  const nonce = randomBytes(18).toString('base64');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Atoll Recovery</title>
<style>body{font:17px system-ui;max-width:42rem;margin:3rem auto;padding:0 1.5rem;line-height:1.5}label{display:block;margin:1rem 0}input,textarea,button{font:inherit;padding:.6rem;box-sizing:border-box}input,textarea{display:block;width:100%}button{cursor:pointer}#status{white-space:pre-wrap}li{margin:1rem 0}</style>
<h1>Connect Atoll Recovery</h1><p>Approve a backup reader for this issuer. It can download existing encrypted exports. It cannot provision cards or decrypt backups.</p>
<form id="login"><label>Recovery administrator<input name="name" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button></form>
<section id="approved" hidden><button id="signout">Sign out</button><form id="pair"><label>Connection name<input name="name" value="Zion" maxlength="64" required></label><button>Create pairing code</button></form><label id="codeLabel" hidden>Pairing code<textarea id="code" readonly rows="3" spellcheck="false"></textarea></label><p id="expires"></p><h2>Connections</h2><p>Copy attestation is a separate grant. It lets a copier report verified backups that may unblock issuance; ordinary readers remain read-only.</p><button id="refresh">Refresh connections</button><ul id="connections"></ul></section><p id="status" role="status"></p>
<script nonce="${nonce}">
let token=''; const status=document.getElementById('status');
async function call(path,method='GET',body){const r=await fetch(path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.reason==='recovery-admin-required'?'This account is not a recovery administrator.':j.reason==='recovery-not-configured'?'Recovery enrollment is not configured for this issuer.':'The request failed. Check access and try again.');return j}
async function connections(){const j=await call('/ops/recovery/connections');const list=document.getElementById('connections');list.replaceChildren();for(const c of j.connections){const li=document.createElement('li');li.append(document.createTextNode(c.name+' — '+(c.revoked?'Revoked':'Active')+' '));if(!c.revoked){const b=document.createElement('button');b.textContent='Revoke';b.onclick=async()=>{if(!confirm('Revoke this backup reader?'))return;try{await call('/ops/recovery/connections/'+c.id,'DELETE');await connections()}catch(e){status.textContent=e.message}};li.append(b);const a=document.createElement('button');a.textContent=c.can_attest?'Remove copy attestations':'Allow copy attestations';a.onclick=async()=>{if(!confirm(c.can_attest?'Remove attestation authority and its saved evidence?':'This lets the copier report verified backups that may unblock issuance. Allow this connection?'))return;a.disabled=true;try{await call('/ops/recovery/connections/'+c.id+'/attestation','POST',{enabled:!c.can_attest});await connections();status.textContent='Copy attestation permission updated. Configure the copier separately; granting permission alone does not verify a backup.'}catch(e){status.textContent=e.message}finally{a.disabled=false}};li.append(a)}list.append(li)}}
document.getElementById('refresh').onclick=async()=>{try{await connections()}catch(e){status.textContent=e.message}};
document.getElementById('login').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;status.textContent='Signing in…';try{const j=await call('/auth/operator/session','POST',{name:f.elements.name.value,password:f.elements.password.value});token=j.token;f.elements.password.value='';await connections();f.hidden=true;document.getElementById('approved').hidden=false;status.textContent='Choose a name for the backup reader.'}catch(e){token='';status.textContent=e.message}};
document.getElementById('signout').onclick=async()=>{try{await call('/auth/operator/signout','POST',{});token='';document.getElementById('code').value='';document.getElementById('approved').hidden=true;document.getElementById('login').hidden=false;status.textContent='Signed out.'}catch(e){status.textContent=e.message}};
document.getElementById('pair').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{const j=await call('/ops/recovery/pairings','POST',{name:e.currentTarget.elements.name.value});document.getElementById('code').value=j.code;document.getElementById('codeLabel').hidden=false;document.getElementById('expires').textContent='Expires '+new Date(j.expires_at*1000).toLocaleTimeString()+'. Enter this code in Atoll Recovery’s Connect Issuer action.';status.textContent='The code approves one connection. Keep it private.'}catch(e){status.textContent=e.message}finally{b.disabled=false}};
</script></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Keep CDN-injected scripts out of these CSP-protected approval pages.
      'cache-control': 'no-store, no-transform',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    },
  });
}
