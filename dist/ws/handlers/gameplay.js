"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeGame = finalizeGame;
exports.handleMove = handleMove;
exports.handleResign = handleResign;
exports.handleDrawOffer = handleDrawOffer;
exports.handleDrawResponse = handleDrawResponse;
// src/ws/handlers/gameplay.ts
const client_1 = require("@prisma/client");
const state_1 = require("../state");
const elo_1 = require("../../utils/elo");
const prisma = new client_1.PrismaClient();
async function finalizeGame(roomId, dbGameId, resultMessage, outcome) {
    const room = state_1.rooms.get(roomId);
    if (!room)
        return;
    if (room.botEngine) {
        room.botEngine.kill();
    }
    try {
        if (room.isBotGame) {
            // For bot games, just mark as finished, no Elo changes
            await prisma.game.update({
                where: { id: dbGameId },
                data: {
                    status: 'finished',
                    result: resultMessage,
                    finishedAt: new Date(),
                    whiteRatingChange: 0,
                    blackRatingChange: 0
                }
            });
            return;
        }
        // 1. Fetch the current game and players to get their ratings
        const game = await prisma.game.findUnique({
            where: { id: dbGameId },
            include: { whitePlayer: true, blackPlayer: true }
        });
        if (!game || !game.whitePlayer || !game.blackPlayer || !game.whitePlayerId || !game.blackPlayerId)
            return;
        // 2. Calculate new Elo ratings
        const eloResult = (0, elo_1.calculateElo)(game.whitePlayer.rating, game.blackPlayer.rating, outcome);
        // 3. Execute an atomic transaction so everything updates perfectly
        await prisma.$transaction([
            prisma.game.update({
                where: { id: dbGameId },
                data: {
                    status: 'finished',
                    result: resultMessage,
                    finishedAt: new Date(),
                    whiteRatingChange: eloResult.whiteDiff,
                    blackRatingChange: eloResult.blackDiff
                }
            }),
            prisma.user.update({
                where: { id: game.whitePlayerId },
                data: {
                    rating: eloResult.newWhite,
                    wins: outcome === 'w' ? { increment: 1 } : undefined,
                    losses: outcome === 'b' ? { increment: 1 } : undefined,
                    draws: outcome === 'd' ? { increment: 1 } : undefined,
                }
            }),
            prisma.user.update({
                where: { id: game.blackPlayerId },
                data: {
                    rating: eloResult.newBlack,
                    wins: outcome === 'b' ? { increment: 1 } : undefined,
                    losses: outcome === 'w' ? { increment: 1 } : undefined,
                    draws: outcome === 'd' ? { increment: 1 } : undefined,
                }
            })
        ]);
        console.log(`Game ${dbGameId} finalized. Ratings updated.`);
    }
    catch (error) {
        console.error("Failed to finalize game and update Elo:", error);
    }
}
async function handleMove(ws, parsedMessage) {
    if (!ws.roomId)
        return;
    const room = state_1.rooms.get(ws.roomId);
    if (!room)
        return;
    const currTurn = room.game.turn();
    if (!currTurn)
        return;
    if (currTurn !== ws.color && !room.isBotGame) {
        (0, state_1.sendToClient)(ws, { type: 'error', message: 'Not your turn' });
        return;
    }
    const now = Date.now();
    const timeElapsed = now - room.lastMoveTime;
    room.clock[currTurn] -= timeElapsed;
    room.lastMoveTime = now;
    if (room.clock[currTurn] <= 0) {
        room.clock[currTurn] = 0;
        const winner = currTurn === 'w' ? 'Black' : 'White';
        const resultMessage = `Timeout! ${winner} wins.`;
        room.players.forEach(client => {
            (0, state_1.sendToClient)(client, { type: 'state', fen: room.game.fen(), turn: currTurn, clock: room.clock });
            (0, state_1.sendToClient)(client, { type: 'game_over', result: resultMessage });
        });
        // --- NEW: REPLACED PRISMA UPDATE WITH FINALIZE GAME ---
        if (room.dbGameId) {
            const outcome = currTurn === 'w' ? 'b' : 'w'; // The person who timed out loses
            await finalizeGame(ws.roomId, room.dbGameId, resultMessage, outcome);
        }
        state_1.rooms.delete(ws.roomId);
        return;
    }
    try {
        const movePayload = {
            from: parsedMessage.from,
            to: parsedMessage.to,
            ...(parsedMessage.promotion && { promotion: parsedMessage.promotion })
        };
        const moveResult = room.game.move(movePayload);
        if (!moveResult) {
            (0, state_1.sendToClient)(ws, { type: 'error', message: 'Illegal move' });
            return;
        }
        const newFen = room.game.fen();
        const turn = room.game.turn();
        room.drawOfferedBy = null;
        room.players.forEach(client => {
            (0, state_1.sendToClient)(client, { type: 'state', fen: newFen, turn: turn, clock: room.clock });
        });
        if (room.dbGameId) {
            const history = room.game.history();
            await prisma.move.create({
                data: {
                    gameId: room.dbGameId,
                    moveNumber: history.length,
                    notation: history[history.length - 1],
                    fenAfter: newFen
                }
            });
        }
        if (room.game.isGameOver()) {
            let resultMessage = "Game Over";
            let outcome = 'd'; // Default to draw
            if (room.game.isCheckmate()) {
                const winner = turn === 'b' ? 'White' : 'Black';
                resultMessage = `Checkmate! ${winner} wins.`;
                outcome = turn === 'b' ? 'w' : 'b'; // If turn is 'b', white just moved and won
            }
            else if (room.game.isDraw()) {
                if (room.game.isStalemate())
                    resultMessage = "Draw by Stalemate!";
                else if (room.game.isThreefoldRepetition())
                    resultMessage = "Draw by Repetition!";
                else if (room.game.isInsufficientMaterial())
                    resultMessage = "Draw by Insufficient Material!";
                else
                    resultMessage = "Draw!";
                outcome = 'd';
            }
            room.players.forEach(client => {
                (0, state_1.sendToClient)(client, { type: 'game_over', result: resultMessage });
            });
            // --- NEW: REPLACED PRISMA UPDATE WITH FINALIZE GAME ---
            if (room.dbGameId) {
                await finalizeGame(ws.roomId, room.dbGameId, resultMessage, outcome);
            }
            state_1.rooms.delete(ws.roomId);
        }
        else if (room.isBotGame && turn === room.botColor && room.botEngine) {
            // Trigger bot move asynchronously
            setTimeout(async () => {
                try {
                    const analysis = await room.botEngine.analyzePosition(room.game.fen(), 10);
                    // bestMove is a string like 'e2e4' or 'e7e8q'
                    const bm = analysis.bestMove;
                    const from = bm.slice(0, 2);
                    const to = bm.slice(2, 4);
                    const promotion = bm.length > 4 ? bm[4] : undefined;
                    // Mock a WebSocket message to reuse handleMove logic for the bot
                    // Pass a dummy websocket (or the human's ws with a flag) 
                    // Actually, handleMove checks ws.color to ensure it's their turn.
                    // If we pass the human's ws, `ws.color` is 'w', but the turn is 'b'.
                    // It will fail the check `currTurn !== ws.color`.
                    // We need a dummy ws object for the bot.
                    const dummyBotWs = { color: room.botColor, roomId: ws.roomId };
                    await handleMove(dummyBotWs, { type: 'move', from, to, promotion });
                }
                catch (e) {
                    console.error("Bot failed to move:", e);
                }
            }, 500); // Small delay for realism
        }
    }
    catch (e) {
        (0, state_1.sendToClient)(ws, { type: 'error', message: 'Invalid move' });
    }
}
async function handleResign(ws) {
    if (!ws.roomId)
        return;
    const room = state_1.rooms.get(ws.roomId);
    if (!room)
        return;
    const winner = ws.color === 'w' ? 'Black' : 'White';
    const resultMessage = `${winner} wins by resignation.`;
    room.players.forEach(client => {
        (0, state_1.sendToClient)(client, { type: 'game_over', result: resultMessage });
    });
    // --- NEW: REPLACED PRISMA UPDATE WITH FINALIZE GAME ---
    if (room.dbGameId) {
        const outcome = ws.color === 'w' ? 'b' : 'w'; // The person who resigned loses
        await finalizeGame(ws.roomId, room.dbGameId, resultMessage, outcome);
    }
    state_1.rooms.delete(ws.roomId);
}
function handleDrawOffer(ws) {
    if (!ws.roomId)
        return;
    const room = state_1.rooms.get(ws.roomId);
    if (!room)
        return;
    const opponent = room.players.find(p => p !== ws);
    if (opponent) {
        room.drawOfferedBy = ws.color;
        (0, state_1.sendToClient)(opponent, { type: 'draw_offered' });
        (0, state_1.sendToClient)(opponent, { type: 'chat', message: 'Your opponent offered a draw.' });
    }
}
async function handleDrawResponse(ws, accept) {
    if (!ws.roomId)
        return;
    const room = state_1.rooms.get(ws.roomId);
    if (!room)
        return;
    const opponent = room.players.find(p => p !== ws);
    if (accept && room.drawOfferedBy && room.drawOfferedBy !== ws.color) {
        const resultMessage = "Draw by agreement.";
        room.players.forEach(client => {
            (0, state_1.sendToClient)(client, { type: 'game_over', result: resultMessage });
        });
        // --- NEW: REPLACED PRISMA UPDATE WITH FINALIZE GAME ---
        if (room.dbGameId) {
            await finalizeGame(ws.roomId, room.dbGameId, resultMessage, 'd');
        }
        state_1.rooms.delete(ws.roomId);
    }
    else {
        room.drawOfferedBy = null;
        if (opponent) {
            (0, state_1.sendToClient)(opponent, { type: 'chat', message: 'Draw offer declined.' });
        }
    }
}
