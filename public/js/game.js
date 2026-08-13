const socket = io();

let myPlayerId = null;
let myCurrentBlock = null;
let currentGameState = null;
let turnCountdownTimer = null;
let turnCountdownEndsAt = null;
let lastCountdownTurnKey = null;

const FALLBACK_TURN_DURATION_MS = 60000;

const joinForm = document.getElementById("join-form");
const playerNameInput = document.getElementById("player-name");
const gameStatus = document.getElementById("game-status");
const turnStatus = document.getElementById("turn-status");
const turnTimer = document.getElementById("turn-timer");
const turnTimerCard = turnTimer ? turnTimer.closest(".timer-card") : null;
const currentBlock = document.getElementById("current-block");
const currentBlockPreview = document.getElementById("current-block-preview");
const poolCount = document.getElementById("pool-count");
const playerList = document.getElementById("player-list");
const scoreboard = document.getElementById("scoreboard");
const messageArea = document.getElementById("message-area");
const cells = document.querySelectorAll(".cell");

const shapeSymbols = {
  circle: "●",
  square: "■",
  triangle: "▲",
  star: "★"
};

socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const playerName = playerNameInput.value;
  socket.emit("joinGame", playerName);
});

cells.forEach((cell) => {
  cell.addEventListener("click", () => {
    if (!currentGameState || !myCurrentBlock) {
      return;
    }

    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);

    const isMyTurn = currentGameState.currentPlayerId === myPlayerId;
    const occupied = currentGameState.board[row][col] !== null;

    if (!isMyTurn || occupied) {
      return;
    }

    const blockToPlace = { ...myCurrentBlock };

    drawBlockInCell(cell, blockToPlace, row, col);

    cell.disabled = true;
    myCurrentBlock = null;
    currentBlock.textContent = "Current block: placing...";

    if (typeof renderCurrentBlockPreview === "function") {
      renderCurrentBlockPreview(null, "Placing...");
    }

    updateCellAvailability();

    socket.emit("placeBlock", {
      row: row,
      col: col
    });
  });
});

socket.on("joinedGame", (player) => {
  myPlayerId = player.id;

  gameStatus.textContent = `You joined the game as ${player.name}. Waiting for your turn.`;

  playerNameInput.disabled = true;
  joinForm.querySelector("button").disabled = true;
});

socket.on("yourTurn", (block) => {
  myCurrentBlock = block;

  currentBlock.textContent = `Current block: ${formatBlock(block)}. Click an empty cell.`;
  renderCurrentBlockPreview(block, formatBlock(block));

  updateCellAvailability();
});

socket.on("gameStateUpdate", (gameState) => {
  currentGameState = gameState;

  if (gameState.currentPlayerId !== myPlayerId) {
    myCurrentBlock = null;
  }

  renderBoard(gameState.board);
  renderPlayers(gameState.players);
  renderScores(gameState.players, gameState.scores);
  renderTurnStatus(gameState);
  renderPoolCount(gameState.poolCount);
  syncTurnCountdown(gameState);
  updateCellAvailability();
});

socket.on("messageUpdate", (message) => {
  messageArea.textContent = message;
});

socket.on("removedFromGame", (message) => {
  myPlayerId = null;
  myCurrentBlock = null;

  gameStatus.textContent = message;
  currentBlock.textContent = "Current block: none";
  renderCurrentBlockPreview(null, "No block yet");
  stopTurnCountdown();

  playerNameInput.disabled = false;
  joinForm.querySelector("button").disabled = false;

  updateCellAvailability();
});

function drawBlockInCell(cell, block, row, col) {
  cell.className = "cell";
  cell.textContent = "";
  cell.title = "";
  cell.setAttribute("aria-label", `Empty cell row ${row + 1} column ${col + 1}`);

  if (block) {
    const colour = block.colour || block.color;
    const shape = block.shape;

    cell.textContent = shapeSymbols[shape] || "?";

    if (colour) {
      cell.classList.add(`block-${colour}`);
    }

    cell.title = formatBlock(block);
    cell.setAttribute(
      "aria-label",
      `${formatBlock(block)} at row ${row + 1} column ${col + 1}`
    );
  }
}

function renderBoard(board) {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const block = board[row][col];
      const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);

      drawBlockInCell(cell, block, row, col);
    }
  }
}

function renderPlayers(players) {
  playerList.innerHTML = "";

  if (players.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No players currently in the game.";
    playerList.appendChild(item);
    return;
  }

  players.forEach((player, index) => {
    const item = document.createElement("li");
    const nameSpan = document.createElement("span");
    const tagSpan = document.createElement("span");

    nameSpan.textContent = `${index + 1}. ${player.name}`;

    if (player.id === myPlayerId) {
      tagSpan.textContent = "you";
      tagSpan.classList.add("player-tag");
      item.classList.add("self-player");
    }

    if (
      currentGameState &&
      player.id === currentGameState.currentPlayerId
    ) {
      item.classList.add("current-player");

      if (tagSpan.textContent.length > 0) {
        tagSpan.textContent = `${tagSpan.textContent} · turn`;
      } else {
        tagSpan.textContent = "turn";
        tagSpan.classList.add("player-tag");
      }
    }

    item.appendChild(nameSpan);

    if (tagSpan.textContent.length > 0) {
      item.appendChild(tagSpan);
    }

    playerList.appendChild(item);
  });
}

function renderScores(players, scores) {
  scoreboard.innerHTML = "";

  if (players.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No scores available.";
    scoreboard.appendChild(item);
    return;
  }

  players.forEach((player) => {
    const item = document.createElement("li");
    const nameSpan = document.createElement("span");
    const scoreSpan = document.createElement("span");
    const score = scores[player.id] || 0;

    nameSpan.textContent = player.name;
    scoreSpan.textContent = `${score} pts`;
    scoreSpan.classList.add("score-value");

    if (
      currentGameState &&
      player.id === currentGameState.currentPlayerId
    ) {
      item.classList.add("current-player");
    }

    if (player.id === myPlayerId) {
      item.classList.add("self-player");
    }

    item.appendChild(nameSpan);
    item.appendChild(scoreSpan);

    scoreboard.appendChild(item);
  });
}

function renderTurnStatus(gameState) {
  if (!gameState.currentPlayerName) {
    turnStatus.textContent = "Current turn: none";
    currentBlock.textContent = "Current block: none";
    renderCurrentBlockPreview(null, "No block yet");
    return;
  }

  turnStatus.textContent = `Current turn: ${gameState.currentPlayerName}`;

  if (gameState.currentPlayerId === myPlayerId && myCurrentBlock) {
    gameStatus.textContent = "It is your turn.";
    currentBlock.textContent = `Current block: ${formatBlock(myCurrentBlock)}. Click an empty cell.`;
    renderCurrentBlockPreview(myCurrentBlock, formatBlock(myCurrentBlock));
  } else if (gameState.currentPlayerId === myPlayerId) {
    gameStatus.textContent = "It is your turn.";
    currentBlock.textContent = "Current block: waiting...";
    renderCurrentBlockPreview(null, "Waiting for block");
  } else {
    gameStatus.textContent = "Waiting for another player's turn.";
    currentBlock.textContent = "Current block: hidden until it is your turn.";
    renderCurrentBlockPreview(null, "Hidden until your turn", true);
  }
}

function renderPoolCount(count) {
  poolCount.textContent = `Blocks remaining in pool: ${count}`;
}

function syncTurnCountdown(gameState) {
  const remainingMs = Number(gameState.turnRemainingMs);
  const hasActiveTurn = Boolean(gameState.currentPlayerId);
  const hasServerTimer =
    Object.prototype.hasOwnProperty.call(gameState, "turnRemainingMs") &&
    Number.isFinite(remainingMs);

  if (!hasActiveTurn) {
    lastCountdownTurnKey = null;
    stopTurnCountdown();
    return;
  }

  const turnKey = getTurnStateKey(gameState);

  if (hasServerTimer && remainingMs <= 0) {
    lastCountdownTurnKey = turnKey;
    stopTurnCountdown("Time remaining: 0:00");
    updateTimerCardState(0);
    return;
  }

  if (hasServerTimer) {
    lastCountdownTurnKey = turnKey;
    startTurnCountdown(remainingMs);
    return;
  }

  if (turnKey !== lastCountdownTurnKey || !turnCountdownEndsAt) {
    lastCountdownTurnKey = turnKey;
    startTurnCountdown(FALLBACK_TURN_DURATION_MS);
  }
}

function startTurnCountdown(remainingMs) {
  turnCountdownEndsAt = Date.now() + remainingMs;
  renderTurnCountdown();

  if (!turnCountdownTimer) {
    turnCountdownTimer = setInterval(renderTurnCountdown, 1000);
  }
}

function stopTurnCountdown(labelText = "Time remaining: --") {
  if (turnCountdownTimer) {
    clearInterval(turnCountdownTimer);
    turnCountdownTimer = null;
  }

  turnCountdownEndsAt = null;

  if (turnTimer) {
    turnTimer.textContent = labelText;
  }

  updateTimerCardState(null);
}

function getTurnStateKey(gameState) {
  const boardKey = gameState.board
    .map((row) =>
      row.map((block) => (block ? block.id || `${block.colour}-${block.shape}` : "empty")).join(",")
    )
    .join("|");

  return `${gameState.currentPlayerId}:${gameState.poolCount}:${boardKey}`;
}

function renderTurnCountdown() {
  if (!turnCountdownEndsAt) {
    stopTurnCountdown();
    return;
  }

  const remainingMs = Math.max(0, turnCountdownEndsAt - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  if (turnTimer) {
    turnTimer.textContent = `Time remaining: ${formatTimer(remainingSeconds)}`;
  }

  updateTimerCardState(remainingSeconds);

  if (remainingSeconds <= 0) {
    stopTurnCountdown("Time remaining: 0:00");
    updateTimerCardState(0);
  }
}

function updateTimerCardState(remainingSeconds) {
  if (!turnTimerCard) {
    return;
  }

  turnTimerCard.classList.remove("timer-warning", "timer-expired");

  if (remainingSeconds === null) {
    return;
  }

  if (remainingSeconds <= 0) {
    turnTimerCard.classList.add("timer-expired");
  } else if (remainingSeconds <= 10) {
    turnTimerCard.classList.add("timer-warning");
  }
}

function formatTimer(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateCellAvailability() {
  if (!currentGameState) {
    return;
  }

  const isMyTurn =
    currentGameState.currentPlayerId === myPlayerId && myCurrentBlock !== null;

  cells.forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const occupied = currentGameState.board[row][col] !== null;

    cell.disabled = !isMyTurn || occupied;
  });
}

function renderCurrentBlockPreview(block, labelText, hidden = false) {
  currentBlockPreview.className = "block-preview-card";

  if (!block) {
    currentBlockPreview.classList.add(hidden ? "block-preview-hidden" : "block-preview-empty");

    currentBlockPreview.innerHTML = `
      <span class="block-preview-symbol">?</span>
      <span class="block-preview-text">${labelText}</span>
    `;

    return;
  }

  currentBlockPreview.classList.add(`block-${block.colour}`);

  currentBlockPreview.innerHTML = `
    <span class="block-preview-symbol">${shapeSymbols[block.shape] || "?"}</span>
    <span class="block-preview-text">${labelText}</span>
  `;
}

function formatBlock(block) {
  if (!block) {
    return "none";
  }

  return `${capitalise(block.colour)} ${capitalise(block.shape)}`;
}

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
