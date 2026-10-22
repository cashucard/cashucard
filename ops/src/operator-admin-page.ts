import {createHash} from 'node:crypto';
const script = String.raw`
let token = '', principal = null;
const $ = id => document.getElementById(id);
function status(s) { $('status').textContent = s; }
function locked() { token = ''; $('admin').hidden = true; $('login').hidden = false; }
async function request(path, body, method) {
  const response = await fetch(path, {method: method || (body ? 'POST' : 'GET'), cache:'no-store', credentials:'omit', headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
  const value = await response.json();
  if (!response.ok) { if(response.status === 401) locked(); throw Error(value.reason || value.error || 'Request failed'); }
  return value;
}
async function load() {
  const data = await request('/admin/operators');
  $('operators').replaceChildren(); $('target').replaceChildren();
  for(const op of data.operators) {
    const option=document.createElement('option'); option.value=op.id; option.textContent=op.name; $('target').append(option);
    const row=document.createElement('tr');
    for(const value of [op.name,op.key_env,op.disabled ? 'Disabled':'Active']) {const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
    const cell=document.createElement('td'), button=document.createElement('button');button.type='button';button.textContent=op.disabled?'Enable':'Disable';
    button.onclick=()=>perform(async()=>{if(!confirm(button.textContent+' '+op.name+'? Existing sessions will be revoked.')) return;await request('/admin/operators/'+op.id+'/'+(op.disabled?'enable':'disable'),{});await load();status('Operator updated.');});
    cell.append(button);row.append(cell);$('operators').append(row);
  }
  const names=new Map(data.operators.map(op=>[op.id,op.name+' (#'+op.id+')']));
  const audit=await request('/admin/operators/audit');
  $('audit').textContent=audit.events.map(e=>new Date(e.created*1000).toISOString()+' · '+e.action+' · actor '+names.get(e.actor_id)+' → operator '+names.get(e.target_id)).join('\n');
}
let busy=false;
async function perform(work) { if(busy) return;busy=true;document.querySelectorAll('button').forEach(e=>e.disabled=true);try {await work();} catch(e){status(e.message || 'Request failed');}finally{busy=false;document.querySelectorAll('button').forEach(e=>e.disabled=false);} }
$('login').onsubmit=e=>{e.preventDefault();perform(async()=>{const password=$('password').value;$('password').value='';const auth=await request('/auth/operator/session',{name:$('name').value,password});token=auth.token;principal=auth.operator_id;try{await load();}catch(e){await request('/auth/operator/signout',{}).catch(()=>{});locked();throw e;}$('login').hidden=true;$('admin').hidden=false;status('Signed in.');});};
$('create').onsubmit=e=>{e.preventDefault();perform(async()=>{const password=$('new-password').value;$('new-password').value='';await request('/admin/operators',{name:$('new-name').value,password,keyEnv:$('environment').value});$('new-name').value='';await load();status('Operator created. Deliver their password through your secrets vault.');});};
$('reset').onsubmit=e=>{e.preventDefault();perform(async()=>{const password=$('reset-password').value;$('reset-password').value='';if(!confirm('Reset this operator password and revoke all their sessions?'))return;await request('/admin/operators/'+$('target').value+'/reset-password',{password});if(Number($('target').value)===principal){locked();status('Password changed. Sign in with your new password.');}else{await load();status('Password reset. Disabled accounts stay disabled.');}});};
$('logout').onclick=()=>perform(async()=>{try{await request('/auth/operator/signout',{});}finally{locked();status('Signed out.');}});
$('refresh').onclick=()=>perform(load);
window.addEventListener('pagehide',()=>{if(token)fetch('/auth/operator/signout',{method:'POST',credentials:'omit',keepalive:true,headers:{Authorization:'Bearer '+token}}).catch(()=>{});token='';});
`;
const style =
  'body{font:16px system-ui;max-width:850px;margin:40px auto;padding:0 20px}label{display:block;margin:12px 0}input,select,button{font:inherit;padding:8px}input{display:block;width: min(95%,420px)}button{margin:6px}td,th{text-align:left;padding:8px}pre{white-space:pre-wrap}#status{min-height:24px}';
export function operatorAdminPage() {
  const hash = (s: string) => createHash('sha256').update(s).digest('base64');
  return {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    },
    html: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cashu operator administration</title><style>${style}</style><body><h1>Operator administration</h1><p>Restricted to deployment-designated administrators. Disabling an account preserves its card history.</p><p id="status" role="status"></p><form id="login"><label>Operator name<input id="name" autocomplete="username" required></label><label>Password<input id="password" type="password" autocomplete="current-password" required></label><button>Sign in</button></form><section id="admin" hidden><button id="logout">Sign out</button><button id="refresh">Refresh</button><h2>Operators</h2><table><thead><tr><th>Name</th><th>Environment</th><th>Status</th><th>Access</th></tr></thead><tbody id="operators"></tbody></table><h2>Add operator</h2><form id="create"><label>Name<input id="new-name" pattern="[A-Za-z0-9._@-]{1,64}" maxlength="64" required></label><label>Password (at least 12 characters)<input id="new-password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required></label><label>Key environment<select id="environment"><option value="issued">Issued</option><option value="factory">Factory</option></select></label><button>Create operator</button></form><h2>Reset password</h2><form id="reset"><label>Operator<select id="target"></select></label><label>New password<input id="reset-password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required></label><p>This revokes existing sessions. Disabled accounts remain disabled.</p><button>Reset password</button></form><h2>Recent administration events</h2><pre id="audit"></pre></section><script>${script}</script></body></html>`,
  };
}
