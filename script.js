/**
 * Setup default player email and name input fields for 4 players
 */
function setupDefaultPlayers() {
  for (let i = 1; i <= 4; i++) {
    document.getElementById(
      "players-email"
    ).innerHTML += `<input id="player-email-input-${i}" class="player-email-input" type="email" placeholder="Player ${i} Email" required />`;
  }
  for (let i = 1; i <= 4; i++) {
    document.getElementById(
      "players-name"
    ).innerHTML += `<input id="player-name-input-${i}" class="player-name-input" type="text" placeholder="Player ${i} Name" required />`;
  }
}

/**
 * Add a new player email input field
 */
function addEmailInput() {
  const playerInputs = document.querySelectorAll(".player-email-input");
  const lastPlayerInput = playerInputs[playerInputs.length - 1];
  const lastPlayerInputId = lastPlayerInput.id;
  const lastPlayerInputNumber = parseInt(lastPlayerInputId.split("-")[3]);
  document.getElementById(
    "players-email"
  ).innerHTML += `<input id="player-email-input-${
    lastPlayerInputNumber + 1
  }" class="player-email-input" type="email" placeholder="Player ${
    lastPlayerInputNumber + 1
  } Email" required />`;
}

/**
 * Add a new player name input field
 */
function addNameInput() {
  const playerNameInputs = document.querySelectorAll(".player-name-input");
  const lastPlayerNameInput = playerNameInputs[playerNameInputs.length - 1];
  const lastPlayerNameInputId = lastPlayerNameInput.id;
  const lastPlayerNameInputNumber = parseInt(
    lastPlayerNameInputId.split("-")[3]
  );
  document.getElementById(
    "players-name"
  ).innerHTML += `<input id="player-name-input-${
    lastPlayerNameInputNumber + 1
  }" class="player-name-input" type="text" placeholder="Player ${
    lastPlayerNameInputNumber + 1
  } Name" required />`;
}

/**
 * Create a table with players and their roles and statuses
 */
function createTable(numberOfPlayers) {
  const gameTable = document.getElementById("game-table");

  const row = gameTable.insertRow(0);
  const cell1 = row.insertCell(0);
  const cell2 = row.insertCell(1);
  const cell3 = row.insertCell(2);
  const cell4 = row.insertCell(3);
  cell1.innerHTML = "";
  cell2.innerHTML = '<span class="table-header">Player</span>';
  cell3.innerHTML = '<span class="table-header">Role</span>';
  cell4.innerHTML = '<span class="table-header">Status</span>';

  for (let i = 0; i < numberOfPlayers; i++) {
    const row = gameTable.insertRow(i + 1);
    const cell1 = row.insertCell(0);
    const cell2 = row.insertCell(1);
    const cell3 = row.insertCell(2);
    const cell4 = row.insertCell(3);
    cell1.innerHTML = `<input id="player-checkbox-${i}" type="checkbox" />`;
    cell2.innerHTML = `<span id="player-name-${i}" class="table-text"></span>`;
    cell3.innerHTML = `<span id="player-role-${i}" class="table-text">Role</span>`;
    cell4.innerHTML = `<span id="player-status-${i}" class="status">Alive</span>`;
  }

  gameTable.style.display = "table";
}

/**
 * Delete the table
 */
function deleteTable() {
  const gameTable = document.getElementById("game-table");
  gameTable.innerHTML = "";
}

/**
 * Populate the table with players and their roles and statuses
 * Add event listeners to the checkboxes to toggle player status
 */
function populateTable(players) {
  for (let i = 0; i < players.length; i++) {
    // Set player name and roles
    document.getElementById(`player-name-${i}`).innerHTML = players[i].name;
    document.getElementById(`player-role-${i}`).innerHTML = players[i].role;

    // Set event listener for checkbox
    document
      .getElementById(`player-checkbox-${i}`)
      .addEventListener("change", (event) => {
        const playerStatus = document.getElementById(`player-status-${i}`);
        playerStatus.innerHTML =
          playerStatus.innerHTML == "Alive" ? "Dead" : "Alive";
        playerStatus.classList.toggle("dead");
      });
  }
}

/**
 * Assign roles to players
 */
function assignRoles(playerEmails, playerNames) {
  let players = [];

  for (let i = 0; i < playerEmails.length; i++) {
    players.push({
      email: playerEmails[i].value,
      name: playerNames[i].value,
    });
  }

  const roles = ["Mafia", "Doctor", "Detective", "Citizen"];
  const shuffledRoles = roles.sort(() => 0.5 - Math.random());

  players = players.map((player, i) => {
    return {
      ...player,
      role: shuffledRoles[i % roles.length],
    };
  });

  return players;
}

/**
 * Send email to each player with their role
 */
const sendEmail = async (players) => {
  const url = `https://api.mailgun.net/v3/${env.DOMAIN}/messages`;

  const recipientVariables = players.reduce((acc, player) => {
    acc[player.email] = {
      PLAYER: player.name,
      ROLE: player.role,
    };
    return acc;
  }, {});

  const formData = new URLSearchParams();
  formData.append("from", `${env.MAIL_FROM} <postmaster@${env.DOMAIN}>`);
  formData.append("to", players.map((player) => player.email).join(", "));
  formData.append("template", `${env.TEMPLATE}`);
  formData.append(
    "h:X-Mailgun-Recipient-Variables",
    JSON.stringify(recipientVariables)
  );

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`api:${env.API_KEY}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to send email");
  }
};

// Add event listener to the add player button
document.getElementById("add-player-button").addEventListener("click", () => {
  addEmailInput();
  addNameInput();

  if (document.querySelectorAll(".player-email-input").length >= 5) {
    document.getElementById("delete-player-button").style.display = "block";
  }
});

// Event listener to delete the last player input field
document
  .getElementById("delete-player-button")
  .addEventListener("click", () => {
    const playerEmailInputs = document.querySelectorAll(".player-email-input");
    const playerNameInputs = document.querySelectorAll(".player-name-input");
    const lastPlayerEmailInput =
      playerEmailInputs[playerEmailInputs.length - 1];
    const lastPlayerNameInput = playerNameInputs[playerNameInputs.length - 1];
    lastPlayerEmailInput.remove();
    lastPlayerNameInput.remove();

    if (document.querySelectorAll(".player-email-input").length <= 4) {
      document.getElementById("delete-player-button").style.display = "none";
    }
  });

// Event listener to start the game
document
  .getElementById("start-game-button")
  .addEventListener("click", async () => {
    const playerEmails = document.querySelectorAll(".player-email-input");
    const playerNames = document.querySelectorAll(".player-name-input");

    const players = assignRoles(playerEmails, playerNames);

    // Create game with players
    createTable(players.length);
    // await sendEmail(players);
    populateTable(players);

    document.getElementById("start-game-button").style.display = "none";
    document.getElementById("end-game-button").style.display = "block";
  });

// Event listener to end the game
document.getElementById("end-game-button").addEventListener("click", () => {
  deleteTable();
  document.getElementById("start-game-button").style.display = "block";
  document.getElementById("end-game-button").style.display = "none";
});

setupDefaultPlayers();