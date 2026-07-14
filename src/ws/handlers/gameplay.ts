import { PrismaClient } from '@prisma/client';
import { ChessWebSocket, rooms, sendToClient } from '../state';

const prisma = new PrismaClient();

export async function handleMove(ws: ChessWebSocket, parsedMessage: any) {
    if (!ws.roomId) return;
    
    const room = rooms.get(ws.roomId);
    if (!room) return;
    
    const currTurn = room.game.turn();
    if (!currTurn) return;
    
    if (currTurn !== ws.color) {
        sendToClient(ws, { type: 'error', message: 'Not your turn' });
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
            sendToClient(client, { type: 'state', fen: room.game.fen(), turn: currTurn, clock: room.clock });
            sendToClient(client, { type: 'game_over', result: resultMessage });
        });

        if (room.dbGameId) {
            await prisma.game.update({
                where: { id: room.dbGameId },
                data: { status: 'finished', result: resultMessage, finishedAt: new Date() }
            });
        }
        rooms.delete(ws.roomId);
        return; 
    }
    
    try {
        const moveResult = room.game.move({ 
            from: parsedMessage.from, 
            to: parsedMessage.to,
            promotion: parsedMessage.promotion || 'q'
        });

        if (!moveResult) {
            sendToClient(ws, { type: 'error', message: 'Illegal move' });
            return;
        }

        const newFen = room.game.fen();
        const turn = room.game.turn();

        room.players.forEach(client => {
            sendToClient(client, { type: 'state', fen: newFen, turn: turn, clock: room.clock });
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

            if (room.game.isCheckmate()) {
                const winner = turn === 'b' ? 'White' : 'Black'; 
                resultMessage = `Checkmate! ${winner} wins.`;
            } 
            else if (room.game.isDraw()) {
                if (room.game.isStalemate()) resultMessage = "Draw by Stalemate!";
                else if (room.game.isThreefoldRepetition()) resultMessage = "Draw by Repetition!";
                else if (room.game.isInsufficientMaterial()) resultMessage = "Draw by Insufficient Material!";
                else resultMessage = "Draw!";
            }
                                        
            room.players.forEach(client => {
                sendToClient(client, { type: 'game_over', result: resultMessage });
            });
            
            if (room.dbGameId) {
                await prisma.game.update({
                    where: { id: room.dbGameId },
                    data: {
                        status: 'finished',
                        result: resultMessage,
                        finishedAt: new Date()
                    }
                });
            }
            rooms.delete(ws.roomId);
        }
    } catch (error) {
        sendToClient(ws, { type: 'error', message: 'Move execution failed' });
    }
}

export async function handleResign(ws: ChessWebSocket) {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    const winner = ws.color === 'w' ? 'Black' : 'White';
    const resultMessage = `${winner} wins by resignation.`;

    room.players.forEach(client => {
        sendToClient(client, { type: 'game_over', result: resultMessage });
    });

    if (room.dbGameId) {
        await prisma.game.update({
            where: { id: room.dbGameId },
            data: { status: 'finished', result: resultMessage, finishedAt: new Date() }
        });
    }

    rooms.delete(ws.roomId);
}

export function handleDrawOffer(ws: ChessWebSocket) {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    const opponent = room.players.find(p => p !== ws);
    if (opponent) {
        sendToClient(opponent, { type: 'draw_offered' });
        sendToClient(opponent, { type: 'chat', message: 'Your opponent offered a draw.' });
    }
}

export async function handleDrawResponse(ws: ChessWebSocket, accept: boolean) {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    const opponent = room.players.find(p => p !== ws);

    if (accept) {
        const resultMessage = "Draw by agreement.";
        
        room.players.forEach(client => {
            sendToClient(client, { type: 'game_over', result: resultMessage });
        });

        if (room.dbGameId) {
            await prisma.game.update({
                where: { id: room.dbGameId },
                data: { status: 'finished', result: resultMessage, finishedAt: new Date() }
            });
        }
        rooms.delete(ws.roomId);
    } else {
        if (opponent) {
            sendToClient(opponent, { type: 'chat', message: 'Draw offer declined.' });
        }
    }
}