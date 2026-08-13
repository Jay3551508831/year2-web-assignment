const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 8080;

app.use(express.static(path.join(__dirname, "public")));


// Game constants
const BOARD_SIZE = 4;
const TURN_TIMEOUT_MS = 60000;

const SHAPES = ["circle", "square", "triangle", "star"];
const COLOURS = ["red", "blue", "green", "yellow"];


// Game state
let board = createEmptyBoard();
let pool = createBlockPool();
let players = [];
let scores = {};
let currentPlayerIndex = 0;
let currentBlock = null;
let turnTimer = null;
let turnEndsAt = null;


// Basic helper functions
function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null)
  );
}

function createBlockPool() {
  const blocks = [];

  SHAPES.forEach((shape) => {
    COLOURS.forEach((colour) => {
      blocks.push({
        id: `${colour}-${shape}`,
        shape: shape,
        colour: colour
      });
    });
  });

  return blocks;
}

function clearTurnTimer() {
  if (turnTimer) {
    clearTimeout(turnTimer);
    turnTimer = null;
  }

  turnEndsAt = null;
}

function getCurrentPlayer() {
  if (players.length === 0) {
    return null;
  }

  if (currentPlayerIndex >= players.length) {
    currentPlayerIndex = 0;
  }

  return players[currentPlayerIndex];
}

function getRandomBlockFromPool() {
  if (pool.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

function getPublicGameState() {
  const currentPlayer = getCurrentPlayer();
  const turnRemainingMs =
    currentPlayer && turnEndsAt ? Math.max(0, turnEndsAt - Date.now()) : 0;

  return {
    board: board,
    players: players,
    scores: scores,
    currentPlayerId: currentPlayer ? currentPlayer.id : null,
    currentPlayerName: currentPlayer ? currentPlayer.name : null,
    poolCount: pool.length,
    turnDurationMs: TURN_TIMEOUT_MS,
    turnRemainingMs: turnRemainingMs
  };
}

function broadcastGameState() {
  io.emit("gameStateUpdate", getPublicGameState());
}

// Player management

function addPlayer(socket, playerName) {
  const cleanName = playerName.trim();

  if (cleanName.length === 0) {
    socket.emit("messageUpdate", "Please enter a valid name.");
    return;
  }

  const player = {
    id: socket.id,
    name: cleanName
  };

  players.push(player);
  scores[socket.id] = 0;

  socket.emit("joinedGame", player);

  if (players.length === 1) {
    startTurn(`${cleanName} joined the game.`);
  } else {
    io.emit("messageUpdate", `${cleanName} joined the game.`);
    broadcastGameState();
  }
}

function removePlayer(socketId, reason = "left the game") {
  const playerIndex = players.findIndex((p) => p.id === socketId);

  if (playerIndex === -1) {
    return;
  }

  const player = players[playerIndex];
  const wasCurrentPlayer = playerIndex === currentPlayerIndex;

  if (wasCurrentPlayer) {
    clearTurnTimer();
    currentBlock = null;
  }

  players.splice(playerIndex, 1);
  delete scores[socketId];

  io.to(socketId).emit("removedFromGame", `You were removed because you ${reason}.`);

  if (players.length === 0) {
    currentPlayerIndex = 0;
    currentBlock = null;
    io.emit("messageUpdate", `${player.name} ${reason}. There are no active players.`);
    broadcastGameState();
    return;
  }

  if (playerIndex < currentPlayerIndex) {
    currentPlayerIndex -= 1;
  }

  if (currentPlayerIndex >= players.length) {
    currentPlayerIndex = 0;
  }

  if (wasCurrentPlayer) {
    startTurn(`${player.name} ${reason}.`);
  } else {
    io.emit("messageUpdate", `${player.name} ${reason}.`);
    broadcastGameState();
  }
}

// Turn management

function startTurn(previousMessage = "") {
  clearTurnTimer();

  const currentPlayer = getCurrentPlayer();

  if (!currentPlayer) {
    currentBlock = null;
    broadcastGameState();
    return;
  }

  currentBlock = getRandomBlockFromPool();

  if (!currentBlock) {
    board = createEmptyBoard();
    pool = createBlockPool();
    currentBlock = getRandomBlockFromPool();
  }

  turnEndsAt = Date.now() + TURN_TIMEOUT_MS;
  broadcastGameState();

  io.to(currentPlayer.id).emit("yourTurn", currentBlock);

  const turnMessage = `It is now ${currentPlayer.name}'s turn.`;

  if (previousMessage) {
    io.emit("messageUpdate", `${previousMessage} ${turnMessage}`);
  } else {
    io.emit("messageUpdate", turnMessage);
  }

  const timedPlayerId = currentPlayer.id;

  turnTimer = setTimeout(() => {
    const stillCurrentPlayer = getCurrentPlayer();

    if (stillCurrentPlayer && stillCurrentPlayer.id === timedPlayerId) {
      removePlayer(timedPlayerId, "did not act in time");
    }
  }, TURN_TIMEOUT_MS);
}

function moveToNextPlayer(previousMessage = "") {
  clearTurnTimer();

  if (players.length === 0) {
    currentPlayerIndex = 0;
    currentBlock = null;
    broadcastGameState();
    return;
  }

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
  startTurn(previousMessage);
}


// Move handling
function isValidBoardPosition(row, col) {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < BOARD_SIZE &&
    col >= 0 &&
    col < BOARD_SIZE
  );
}

function placeBlock(socket, move) {
  const currentPlayer = getCurrentPlayer();

  if (!currentPlayer) {
    socket.emit("messageUpdate", "There are no active players.");
    return;
  }

  if (socket.id !== currentPlayer.id) {
    socket.emit("messageUpdate", "It is not your turn.");
    return;
  }

  if (!currentBlock) {
    socket.emit("messageUpdate", "No block is available for this turn.");
    return;
  }

  const row = Number(move.row);
  const col = Number(move.col);

  if (!isValidBoardPosition(row, col)) {
    socket.emit("messageUpdate", "Invalid board position.");
    return;
  }

  if (board[row][col] !== null) {
    socket.emit("messageUpdate", "This position is already occupied.");
    return;
  }

  clearTurnTimer();

  const placedBlock = currentBlock;

  board[row][col] = placedBlock;
  pool = pool.filter((block) => block.id !== placedBlock.id);
  currentBlock = null;

  const messages = [];
  messages.push(`${currentPlayer.name} placed a ${placedBlock.colour} ${placedBlock.shape}.`);

  if (isBoardFull()) {
    scores[currentPlayer.id] += 16;
    board = createEmptyBoard();
    pool = createBlockPool();
    messages.push(`Jackpot! ${currentPlayer.name} filled the board and earned 16 points.`);
  } else {
    const removedBlocks = clearMatchingBlocks();

    if (removedBlocks.length > 0) {
      scores[currentPlayer.id] += removedBlocks.length;
      messages.push(`${currentPlayer.name} earned ${removedBlocks.length} points.`);
    }
  }

  moveToNextPlayer(messages.join(" "));
}


// Matching logic
function clearMatchingBlocks() {
  const matchingCells = findMatchingCells();
  const removedBlocks = [];

  matchingCells.forEach((cell) => {
    const block = board[cell.row][cell.col];

    if (block) {
      removedBlocks.push(block);
      board[cell.row][cell.col] = null;
    }
  });

  returnBlocksToPool(removedBlocks);

  return removedBlocks;
}

function findMatchingCells() {
  const lines = getAllLines();
  const cellsToRemove = new Set();

  lines.forEach((line) => {
    addMatchesForProperty(line, "colour", cellsToRemove);
    addMatchesForProperty(line, "shape", cellsToRemove);
  });

  return Array.from(cellsToRemove).map((key) => {
    const parts = key.split("-");
    return {
      row: Number(parts[0]),
      col: Number(parts[1])
    };
  });
}

function getAllLines() {
  const lines = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const line = [];

    for (let col = 0; col < BOARD_SIZE; col += 1) {
      line.push({ row: row, col: col });
    }

    lines.push(line);
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    const line = [];

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      line.push({ row: row, col: col });
    }

    lines.push(line);
  }

  for (let startCol = 0; startCol < BOARD_SIZE; startCol += 1) {
    addDiagonalLine(lines, 0, startCol, 1, 1);
  }

  for (let startRow = 1; startRow < BOARD_SIZE; startRow += 1) {
    addDiagonalLine(lines, startRow, 0, 1, 1);
  }

  for (let startCol = 0; startCol < BOARD_SIZE; startCol += 1) {
    addDiagonalLine(lines, 0, startCol, 1, -1);
  }

  for (let startRow = 1; startRow < BOARD_SIZE; startRow += 1) {
    addDiagonalLine(lines, startRow, BOARD_SIZE - 1, 1, -1);
  }

  return lines;
}

function addDiagonalLine(lines, startRow, startCol, rowStep, colStep) {
  const line = [];
  let row = startRow;
  let col = startCol;

  while (
    row >= 0 &&
    row < BOARD_SIZE &&
    col >= 0 &&
    col < BOARD_SIZE
  ) {
    line.push({ row: row, col: col });
    row += rowStep;
    col += colStep;
  }

  if (line.length >= 3) {
    lines.push(line);
  }
}

function addMatchesForProperty(line, property, cellsToRemove) {
  let sequence = [];
  let currentValue = null;

  line.forEach((position) => {
    const block = board[position.row][position.col];

    if (block && block[property] === currentValue) {
      sequence.push(position);
    } else {
      addSequenceIfLongEnough(sequence, cellsToRemove);

      if (block) {
        currentValue = block[property];
        sequence = [position];
      } else {
        currentValue = null;
        sequence = [];
      }
    }
  });

  addSequenceIfLongEnough(sequence, cellsToRemove);
}

function addSequenceIfLongEnough(sequence, cellsToRemove) {
  if (sequence.length >= 3) {
    sequence.forEach((position) => {
      cellsToRemove.add(`${position.row}-${position.col}`);
    });
  }
}

function returnBlocksToPool(blocks) {
  blocks.forEach((block) => {
    const alreadyInPool = pool.some((poolBlock) => poolBlock.id === block.id);

    if (!alreadyInPool) {
      pool.push(block);
    }
  });
}

function isBoardFull() {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] === null) {
        return false;
      }
    }
  }

  return true;
}


// Socket.IO events
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.emit("gameStateUpdate", getPublicGameState());

  socket.on("joinGame", (playerName) => {
    const alreadyJoined = players.some((p) => p.id === socket.id);

    if (alreadyJoined) {
      socket.emit("messageUpdate", "You have already joined the game.");
      return;
    }

    addPlayer(socket, playerName);
  });

  socket.on("placeBlock", (move) => {
    placeBlock(socket, move);
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
    removePlayer(socket.id, "left the game");
  });
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
