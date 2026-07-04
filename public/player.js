// Trimmed for the phone: the night/day loop + win conditions.
// Each player already sees their own role and its description above this.
const RULES = `Mafia is a game of hidden identities. A few players are secretly Mafia; everyone else is Town (Citizens, plus special roles like the Doctor and Detective).

The game alternates between two phases:

NIGHT — everyone "sleeps". The Mafia secretly choose one player to eliminate. Special roles act too: the Doctor protects someone, the Detective investigates someone.

DAY — the host announces who was eliminated overnight. The living players discuss, accuse, and vote. Whoever gets a majority is eliminated.

These phases repeat until one side wins:
- Town wins when every Mafioso is eliminated.
- Mafia win when they equal or outnumber the Town.

Keep your role secret, trust no one, and — most importantly — have fun!`;

const roomId = location.pathname.split('/r/')[1];
const KEY = 'mafia:room:' + roomId;
let playerId = null;
const $ = (id) => document.getElementById(id);

// Fill the "how to play" panels from the shared rules text.
document.querySelectorAll('.rules').forEach(el => { el.textContent = RULES; });

function show(view) {
  ['joinView', 'lobbyView', 'roleView'].forEach(v =>
    $(v).classList.toggle('hidden', v !== view));
}
function showRole(data) {
  const el = $('roleName');
  el.textContent = data.role;
  el.className = 'role ' + (data.team || '');
  $('roleInfo').textContent = data.roleInfo;
  show('roleView');
}

$('go').onclick = async () => {
  const name = $('name').value.trim();
  if (!name) { $('joinMsg').textContent = 'Enter your name.'; return; }
  $('go').disabled = true; $('joinMsg').textContent = 'Joining…';
  try {
    const r = await fetch('/api/rooms/' + roomId + '/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    if (r.ok) {
      playerId = data.playerId;
      localStorage.setItem(KEY, playerId); // so a refresh resumes instead of re-joining
      show('lobbyView');
      pollForRole();
    } else if (data.error === 'name_taken') {
      $('joinMsg').textContent = 'That name is already taken — try another.';
      $('go').disabled = false;
    } else if (data.error === 'already_started') {
      $('joinMsg').textContent = 'Game already started.';
    } else {
      $('joinMsg').textContent = 'Could not join. Try again.';
      $('go').disabled = false;
    }
  } catch (e) {
    $('joinMsg').textContent = 'Network error. Try again.';
    $('go').disabled = false;
  }
};

// Polling /me doubles as this player's heartbeat, so the host sees them as present.
async function pollForRole() {
  try {
    const r = await fetch('/api/rooms/' + roomId + '/me/' + playerId);
    if (r.status === 404) { // host removed us, or the room was reset
      localStorage.removeItem(KEY); playerId = null;
      show('joinView'); $('go').disabled = false;
      $('joinMsg').textContent = 'You were removed from the room.';
      return;
    }
    const data = await r.json();
    if (data.started && data.role) { showRole(data); return; } // game running: stop polling
  } catch (e) { /* ignore, retry */ }
  setTimeout(pollForRole, 2000);
}

// On load, resume an existing session (refresh / reopened link) rather than joining twice.
(async () => {
  const saved = localStorage.getItem(KEY);
  if (!saved) return;
  playerId = saved;
  try {
    const r = await fetch('/api/rooms/' + roomId + '/me/' + playerId);
    if (r.status === 404) { localStorage.removeItem(KEY); playerId = null; return; }
    const data = await r.json();
    if (data.started && data.role) { showRole(data); return; }
    show('lobbyView');
    pollForRole();
  } catch (e) { /* fall back to the join form */ }
})();
