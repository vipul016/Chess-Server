import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessage } from '../types';
import { PrismaClient } from '@prisma/client';
import { ChessWebSocket, rooms, matchQueue, sendToClient } from './state';
import { handleFindMatch } from './handlers/matchmaking';
import { handleMove, handleResign, handleDrawOffer, handleDrawResponse } from './handlers/gameplay';
import { handleChat, handleReconnect } from './handlers/connection';

const prisma = new PrismaClient();
let heartBeatInterval: NodeJS.Timeout;
let sweeperInterval: NodeJS.Timeout;

export function setupWebSockets(wss: WebSocketServer) {
    wss.on("connection", (socket: WebSocket, req: any) => {
        const ws = socket as ChessWebSocket;
        ws.userId = req.userId;
        ws.username = req.username;
        ws.isAlive = true;
        
        console.log(`Player ${ws.username} Connected!`);

        ws.on('pong', () => { 
            ws.isAlive = true; 
        });

        ws.on("message", async (data) => {
            const now = Date.now();
            if (ws.lastActionTime && (now - ws.lastActionTime < 200)) {
                return;
            }
            ws.lastActionTime = now;

            try {
                const parsedMessage = JSON.parse(data.toString()) as ClientMessage;
                
                switch (parsedMessage.type) {
                    case 'find_match':
                        await handleFindMatch(ws);
                        break;
                    case 'move':
                        await handleMove(ws, parsedMessage);
                        break;
                    case 'resign':
                        await handleResign(ws);
                        break;
                    case 'draw_offer':
                        handleDrawOffer(ws);
                        break;
                    case 'draw_response':
                        await handleDrawResponse(ws, parsedMessage.accept);
                        break;
                    case 'chat':
                        handleChat(ws, parsedMessage.message);
                        break;
                    case 'reconnect':
                        handleReconnect(ws, parsedMessage.roomId, parsedMessage.sessionId);
                        break;
                }
            } catch (error) {
                console.error("Received invalid JSON format");
            }
        });

        ws.on("close", () => {
            if (ws.isBeingReplaced) return; 
            
            if (matchQueue.waitingPlayer === ws) {
                matchQueue.waitingPlayer = null;
                console.log(`Waiting player ${ws.username} disconnected. Queue cleared.`);
            }

            console.log(`Player ${ws.username} Disconnected`);
            
            if (ws.roomId) {
                const room = rooms.get(ws.roomId);
                if (room) {
                    room.players = room.players.filter(client => client !== ws);
                    
                    room.players.forEach(client => {
                        sendToClient(client, { type: 'error', message: 'Your opponent disconnected.' });
                    });
                    
                    if (room.players.length === 0) {
                        rooms.delete(ws.roomId);
                    }
                }
            }
        });
    });

    heartBeatInterval = setInterval(() => {
        wss.clients.forEach((client) => {
            const ws = client as ChessWebSocket;
            if (ws.isAlive === false) {
                console.log(`Terminating ghost connection for ${ws.username} due to missed heartbeat.`);
                ws.terminate();
                return;
            }
            ws.ping();
            ws.isAlive = false;
        });
    }, 30000);

    sweeperInterval = setInterval(async () => {
        const now = Date.now();

        for (const [roomId, room] of rooms.entries()) {
            const turn = room.game.turn();
            const timeElapsed = now - room.lastMoveTime;
            
            if (room.clock[turn] - timeElapsed <= 0) {
                console.log(`Room ${roomId}: Player ${turn} flagged!`);
                room.clock[turn] = 0;
                
                const winner = turn === 'w' ? 'Black' : 'White';
                const resultMessage = `Timeout! ${winner} wins.`;
                
                room.players.forEach(client => {
                    sendToClient(client, { type: 'state', fen: room.game.fen(), turn: turn, clock: room.clock });
                    sendToClient(client, { type: 'game_over', result: resultMessage });
                });

                if (room.dbGameId) {
                    await prisma.game.update({
                        where: { id: room.dbGameId },
                        data: { status: 'finished', result: resultMessage, finishedAt: new Date() }
                    });
                }
                
                rooms.delete(roomId);
            }
        }
    }, 1000);

    wss.on('close', () => {
        clearInterval(heartBeatInterval);
        clearInterval(sweeperInterval);
    });
}

export async function shutdownActiveGames() {
    console.log("Stopping game loops...");
    clearInterval(heartBeatInterval);
    clearInterval(sweeperInterval);

    console.log(`Aborting ${rooms.size} active games...`);
    
    for (const [roomId, room] of rooms.entries()) {
        room.players.forEach(client => {
            sendToClient(client, { type: 'error', message: 'Server is restarting. Game aborted.' });
            client.terminate();
        });

        if (room.dbGameId) {
            await prisma.game.update({
                where: { id: room.dbGameId },
                data: { status: 'aborted', finishedAt: new Date() }
            });
        }
    }
    rooms.clear();
}