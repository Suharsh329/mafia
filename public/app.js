const API = "";
const MIN_PLAYERS = 4;            // keep in sync with the Worker
let roomId = null, tableVisible = false;
let playerPoll = null, rolePoll = null, tablePoll = null;
let roleTeams = {};               // role name -> team, from /roles
const $ = (id) => document.getElementById(id);

// ---- create ----
$('createBtn').onclick = async () => {
  $('createBtn').disabled = true; $('createMsg').textContent = 'Creating…';
  try {
    const r = await fetch(API + '/api/rooms', { method:'POST' });
    const data = await r.json();
    roomId = data.roomId;
    showLobby();
  } catch(e){
    $('createMsg').textContent = 'Could not create room. Try again.';
    $('createBtn').disabled = false;
  }
};

function showLobby(){
  $('createView').classList.add('hidden');
  $('lobbyView').classList.remove('hidden');
  const joinUrl = location.origin + '/r/' + roomId;
  $('joinUrl').textContent = joinUrl;
  new QRCode($('qrcode'), { text:joinUrl, width:200, height:200,
    colorDark:'#0a0a0c', colorLight:'#ffffff' });
  refreshRoster(); refreshRoles();
  playerPoll = setInterval(refreshRoster, 2000);
  rolePoll = setInterval(refreshRoles, 3000);
}

// ---- copy join link ----
$('copyBtn').onclick = async () => {
  const url = $('joinUrl').textContent;
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    // Fallback for insecure contexts / older browsers.
    const t = document.createElement('textarea');
    t.value = url; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (_) {}
    t.remove();
  }
  $('copyBtn').classList.add('copied');
  setTimeout(() => $('copyBtn').classList.remove('copied'), 1200);
};

// ---- roster ----
async function refreshRoster(){
  try{
    const r = await fetch(API + '/api/rooms/' + roomId + '/players');
    const data = await r.json();
    $('playerCount').textContent = data.count; // present players only
    const list = $('rosterList');
    list.innerHTML = data.players.length
      ? data.players.map(p =>
          `<li class="${p.online ? '' : 'away'}">
             <span class="pn">${esc(p.name)}</span>
             ${p.online ? '' : '<span class="away-tag">left</span>'}
             <button class="kick" data-id="${p.playerId}" title="Remove player" aria-label="Remove ${esc(p.name)}">&times;</button>
           </li>`).join('')
      : '<li class="muted">Awaiting souls…</li>';
    list.querySelectorAll('.kick').forEach(b => b.onclick = () => removePlayer(b.dataset.id));
    updateTally();
  }catch(e){}
}
async function removePlayer(id){
  try{ await fetch(API + '/api/rooms/' + roomId + '/remove/' + id, { method:'POST' }); }
  catch(e){}
  refreshRoster();
}

// ---- roles ----
async function refreshRoles(){
  try{
    const r = await fetch(API + '/api/rooms/' + roomId + '/roles');
    renderRoles(await r.json()); updateTally();
  }catch(e){}
}
function renderRoles(data){
  const cfg = $('roleConfig');
  const prev = {};
  cfg.querySelectorAll('input[data-role]').forEach(i => prev[i.dataset.role] = i.value);
  let html = '';
  for(const role of data.available){
    roleTeams[role.name] = role.team;
    const val = prev[role.name] ?? '0';
    const mafia = role.team === 'mafia' ? ' style="color:var(--blood-bright)"' : '';
    // Advisory "suggested count" chip on the Mafioso row (based on player count).
    const suggest = role.name === 'Mafioso'
      ? `<button type="button" class="role-suggest" id="mafiaSuggest" title="Use the suggested count"></button>`
      : '';
    html += `<div class="role-row"><div>
      <span class="role-name"${mafia}>${role.name}</span>
      <span class="role-team">${role.team}</span>
      <div class="role-info">${esc(role.info)}</div>${suggest}</div>
      <input class="role-input" type="number" min="0" inputmode="numeric"
             data-role="${role.name}" value="${val}"></div>`;
  }
  for(const role of data.locked){
    html += `<div class="role-row role-locked"><div>
      <span class="role-name">${role.name}</span></div>
      <div class="muted" style="font-size:.74rem">unlocks at ${role.unlocksAt}</div></div>`;
  }
  cfg.innerHTML = html;
  cfg.querySelectorAll('input[data-role]').forEach(i => i.oninput = updateTally);
  const sg = $('mafiaSuggest');
  if (sg) sg.onclick = () => {
    const inp = document.querySelector('#roleConfig input[data-role="Mafioso"]');
    if (inp) { inp.value = suggestedMafia(); inp.dispatchEvent(new Event('input')); }
  };
  updateSuggestion();
}
// ~1 mafia per 4 players (min 1) — the town-favored "quarter rule".
function suggestedMafia(){
  const pc = parseInt($('playerCount').textContent,10)||0;
  return pc ? Math.max(1, Math.round(pc/4)) : 0;
}
function updateSuggestion(){
  const sg = $('mafiaSuggest');
  if(!sg) return;
  const pc = parseInt($('playerCount').textContent,10)||0;
  if(pc < 1){ sg.style.display='none'; return; }
  sg.style.display='';
  sg.textContent = `suggested: ${suggestedMafia()} for ${pc} player${pc===1?'':'s'}`;
}
function collectCounts(){
  const c = {};
  document.querySelectorAll('#roleConfig input[data-role]').forEach(i => {
    const n = parseInt(i.value,10)||0; if(n>0) c[i.dataset.role]=n;
  });
  return c;
}
function updateTally(){
  const pc = parseInt($('playerCount').textContent,10)||0;
  const counts = collectCounts();
  const sum = Object.values(counts).reduce((a,b)=>a+b,0);
  const roles = Object.keys(counts);
  const hasMafia = roles.some(n => roleTeams[n] === 'mafia');
  const hasTown  = roles.some(n => roleTeams[n] === 'town');

  let ok = true, msg = `${sum} / ${pc} accounted for`;
  if (pc < MIN_PLAYERS)      { ok = false; msg = `Need at least ${MIN_PLAYERS} players — ${pc} so far`; }
  else if (sum !== pc)       { ok = false; }
  else if (!hasMafia)        { ok = false; msg = 'Add at least 1 Mafia role'; }
  else if (!hasTown)         { ok = false; msg = 'Add at least 1 Town role'; }

  const t = $('tally');
  t.className = 'tally ' + (ok ? 'ok' : 'bad');
  t.textContent = msg;
  $('startBtn').disabled = !ok;
  updateSuggestion();
}

// ---- start ----
$('startBtn').onclick = async () => {
  $('startBtn').disabled = true; $('startMsg').textContent = 'Dealing fates…';
  try{
    const r = await fetch(API + '/api/rooms/' + roomId + '/start', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ counts: collectCounts() }),
    });
    const data = await r.json();
    if(r.ok){
      clearInterval(playerPoll); clearInterval(rolePoll);
      $('lobbyView').classList.add('hidden');
      $('gameView').classList.remove('hidden');
      refreshTable();
      tablePoll = setInterval(refreshTable, 3000);
    } else if(data.error === 'role_count_mismatch'){
      $('startMsg').textContent = `Counts must total ${data.needed}.`; updateTally();
    } else if(data.error === 'min_players'){
      $('startMsg').textContent = `Need at least ${data.min} players (have ${data.have}).`; updateTally();
    } else if(data.error === 'need_mafia'){
      $('startMsg').textContent = 'Add at least 1 Mafia role.'; updateTally();
    } else if(data.error === 'need_town'){
      $('startMsg').textContent = 'Add at least 1 Town role.'; updateTally();
    } else { $('startMsg').textContent = 'Could not start.'; updateTally(); }
  }catch(e){ $('startMsg').textContent = 'Network error.'; updateTally(); }
};

// ---- in-game table ----
$('revealBtn').onclick = () => {
  tableVisible = !tableVisible;
  $('revealBtn').textContent = tableVisible ? 'Hide' : 'Show';
  applyMask();
};
function applyMask(){
  $('tableBody').classList.toggle('masked', !tableVisible);
}
async function refreshTable(){
  try{
    const r = await fetch(API + '/api/rooms/' + roomId + '/table');
    const data = await r.json();
    $('tableBody').innerHTML = data.players.map(p => {
      const roleCell = `<span class="prole ${isMafia(p.role)?'mafia':''}">${p.role||'—'}</span>`;
      const st = p.alive ? 'alive' : 'dead';
      const label = p.alive ? 'Alive' : 'Dead';
      return `<tr class="${p.alive?'':'dead'}">
        <td class="pname">${esc(p.name)}</td>
        <td>${roleCell}</td>
        <td><button class="status-btn ${st}" data-id="${p.playerId}">${label}</button></td>
      </tr>`;
    }).join('');
    $('tableBody').querySelectorAll('.status-btn').forEach(b =>
      b.onclick = () => toggleAlive(b.dataset.id));
    applyMask();
  }catch(e){}
}
async function toggleAlive(playerId){
  try{
    await fetch(API + '/api/rooms/' + roomId + '/toggle/' + playerId, { method:'POST' });
    refreshTable();
  }catch(e){}
}
function isMafia(role){ return role === 'Mafioso' || role === 'Godfather'; }

function esc(s){ return String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
