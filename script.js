/**
 * Setup default player email and name input fields for 4 players
 */
const setupDefaultFields = () => {
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
};

/**
 * Add a new player email input field
 */
const addEmailInput = () => {
  const playerInputs = document.querySelectorAll(".player-email-input");
  const lastPlayerInput = playerInputs[playerInputs.length - 1];
  const lastPlayerInputId = lastPlayerInput.id;
  const lastPlayerInputNumber = parseInt(lastPlayerInputId.split("-")[3]);
  const newEmailInput = document.createElement("input");
  newEmailInput.id = `player-email-input-${lastPlayerInputNumber + 1}`;
  newEmailInput.className = "player-email-input";
  newEmailInput.type = "email";
  newEmailInput.placeholder = `Player ${lastPlayerInputNumber + 1} Email`;
  newEmailInput.required = true;
  document.getElementById("players-email").appendChild(newEmailInput);
};

/**
 * Add a new player name input field
 */
const addNameInput = () => {
  const playerNameInputs = document.querySelectorAll(".player-name-input");
  const lastPlayerNameInput = playerNameInputs[playerNameInputs.length - 1];
  const lastPlayerNameInputId = lastPlayerNameInput.id;
  const lastPlayerNameInputNumber = parseInt(
    lastPlayerNameInputId.split("-")[3]
  );
  const newNameInput = document.createElement("input");
  newNameInput.id = `player-name-input-${lastPlayerNameInputNumber + 1}`;
  newNameInput.className = "player-name-input";
  newNameInput.type = "text";
  newNameInput.placeholder = `Player ${lastPlayerNameInputNumber + 1} Name`;
  newNameInput.required = true;
  document.getElementById("players-name").appendChild(newNameInput);
};

/**
 * Create a table with players and their roles and statuses
 */
const createGameTable = (numberOfPlayers) => {
  const gameTable = document.getElementById("game-table");

  const row = gameTable.insertRow(0);
  const cell1 = row.insertCell(0);
  const cell2 = row.insertCell(1);
  const cell3 = row.insertCell(2);
  const cell4 = row.insertCell(3);
  cell1.innerHTML = '<span class="table-header"></span>';
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
  gameTable.style.filter = blurValue;
};

/**
 * Delete the table
 */
const deleteGameTable = () => {
  const gameTable = document.getElementById("game-table");
  gameTable.innerHTML = "";
};

/**
 * Populate the table with players and their roles and statuses
 * Add event listeners to the checkboxes to toggle player status
 */
const populateGameTable = (players) => {
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
};

/**
 * Assign roles to players
 */
const assignRoles = (playerEmails, playerNames) => {
  let players = [];

  for (let i = 0; i < playerEmails.length; i++) {
    players.push({
      email: playerEmails[i].value,
      name: playerNames[i].value,
    });
  }

  try {
    const mafiosiCount = parseInt(
      document.getElementById("mafiosi-count").value,
      10
    );
    const citizenCount = parseInt(
      document.getElementById("citizens-count").value,
      10
    );

    if (mafiosiCount + citizenCount + 2 !== players.length) {
      alert(
        "Please make sure the number of players matches the sum of Mafia, Citizen, Doctor and Detective"
      );
      return [];
    }

    const roles = ["Doctor", "Detective"];
    roles.push(...Array(mafiosiCount).fill("Mafia"));
    roles.push(...Array(citizenCount).fill("Citizen"));
    const shuffledRoles = roles.sort(() => 0.5 - Math.random()).slice(0);

    players = players.map((player, i) => {
      return {
        ...player,
        role: shuffledRoles[i],
      };
    });
  } catch (e) {
    alert("Please enter valid numbers for Mafia and Citizen counts");
    return [];
  }

  return players;
};

/**
 * Send an email to each player with their role.
 */
const sendEmail = async (players) => {
  const emailList = players.map(player => player.email).join(',');

  // Create object of players with email as key
  const playersObject = players.reduce((acc, player) => {
    acc[player.email] = player;
    return acc;
  }, {});

  const bodyData = {
    to: emailList,
    'recipient-variables': playersObject,
    game: 'Mafia',
  };

  try {
    const result = await fetch("https://elegant-peace-production.up.railway.app/mail/games", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyData),
    });

    return result?.status >= 400 ? false : true;
  } catch (e) {
    console.error(e);
    return false;
  }
};

/**
 * Validate player email and name inputs
 */
const validateInputs = (playerNames, playerEmails) => {
  for (let i = 0; i < playerEmails.length; i++) {
    if (!playerEmails[i].value || !playerNames[i].value) {
      alert("Please fill out all player email and name fields.");
      return false;
    }
    if (!playerEmails[i].checkValidity()) {
      alert(`Invalid email format for Player ${i + 1}`);
      return false;
    }
  }
  return true;
};

/**
 * Disable elements when the game starts
 */
const disableElements = () => {
  document.getElementById("start-game-button").classList.remove("loading");
  document.getElementById("start-game-button").style.display = "none";
  document.getElementById("add-player-button").style.display = "none";
  document.getElementById("mafiosi-count").disabled = true;
  document.getElementById("citizens-count").disabled = true;
  document.getElementById("end-game-button").style.display = "block";
  Array.from(document.getElementsByClassName('player-email-input')).forEach(input => input.disabled = true);
  Array.from(document.getElementsByClassName('player-name-input')).forEach(input => input.disabled = true);
};

/**
 * Enable elements when the game ends
 */
const enableElements = () => {
  document.getElementById("start-game-button").style.display = "block";
  document.getElementById("add-player-button").style.display = "block";
  document.getElementById("mafiosi-count").disabled = false;
  document.getElementById("citizens-count").disabled = false;
  document.getElementById("end-game-button").style.display = "none";
  Array.from(document.getElementsByClassName('player-email-input')).forEach(input => input.disabled = false);
  Array.from(document.getElementsByClassName('player-name-input')).forEach(input => input.disabled = false);
};


/**************************************************EVENT LISTENERS **************************************************/

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

    document.getElementById("start-game-button").classList.add("loading");

    // Validate inputs
    if (!validateInputs(playerNames, playerEmails)) {
      document.getElementById("start-game-button").classList.remove("loading");
      return;
    }

    const players = assignRoles(playerEmails, playerNames);
    if (players.length === 0) {
      document.getElementById("start-game-button").classList.remove("loading");
      return;
    }

    const emailSent = await sendEmail(players);
    if (!emailSent) {
      alert("Failed to send emails to players");
      document.getElementById("start-game-button").classList.remove("loading");
      return;
    }

    createGameTable(players.length);
    populateGameTable(players);
    disableElements();
  });

// Event listener to toggle blur effect on the table
document.getElementById("game-table").addEventListener("click", (e) => { 
  if (!e.target.childNodes[0]) {
    return;
  }
  document.getElementById("game-table").style.filter = document.getElementById("game-table").style.filter === blurValue ? "none" : blurValue;
});

// Event listener to end the game
document.getElementById("end-game-button").addEventListener("click", () => {
  deleteGameTable();
  enableElements();
});

const blurValue = "blur(30px)";
setupDefaultFields();
