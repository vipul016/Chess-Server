import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { Chess } from 'chess.js';
import { ChessWebSocket, rooms, matchQueue, sendToClient } from '../state';

const prisma = new PrismaClient();

export async function handleFindMatch(ws: ChessWebSocket) {
    if (matchQueue.waitingPlayer && matchQueue.waitingPlayer.readyState !== ws.OPEN) {
        console.log(`Cleared dead connection for waiting player ${matchQueue.waitingPlayer.username}`);
        matchQueue.waitingPlayer = null;
    }

    if (matchQueue.waitingPlayer) {
        if (matchQueue.waitingPlayer === ws) return; 

        const roomId = crypto.randomUUID(); 

        rooms.set(roomId, {
            players: [matchQueue.waitingPlayer, ws],
            game: new Chess(),
            clock: { w: 600000, b: 600000 }, 
            lastMoveTime: Date.now()         
        });

        const room = rooms.get(roomId)!;
        
        matchQueue.waitingPlayer.roomId = roomId;
        matchQueue.waitingPlayer.color = 'w';
        matchQueue.waitingPlayer.sessionId = crypto.randomUUID();
        
        ws.roomId = roomId;
        ws.color = 'b';
        ws.sessionId = crypto.randomUUID();

        const dbGame = await prisma.game.create({
            data: { 
                status: 'active',
                whitePlayerId: matchQueue.waitingPlayer.userId!,
                blackPlayerId: ws.userId!
            }
        });
        room.dbGameId = dbGame.id;

        sendToClient(matchQueue.waitingPlayer, { type: 'match_found', roomId, color: 'white' });
        sendToClient(ws, { type: 'match_found', roomId, color: 'black' });

        const startingState = {
            type: 'state' as const,
            fen: room.game.fen(),
            turn: room.game.turn(),
            clock: room.clock
        };
        sendToClient(matchQueue.waitingPlayer, startingState);
        sendToClient(ws, startingState);

        console.log(`Match created: Room ${roomId}`);
        matchQueue.waitingPlayer = null; 
    } else {
        matchQueue.waitingPlayer = ws;
        console.log(`Player ${ws.username} is waiting for a match...`);
    }
}