// src/ws/gameManager.ts
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '../types';
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extending the base WebSocket to hold our custom game state and auth data
interface ChessWebSocket extends WebSocket {
    isAlive: boolean;
    sessionId?: string;
    userId?: string;     
    username?: string;   
    color?: 'w' | 'b';
    roomId?: string;     
    isBeingReplaced?: boolean;
}

interface Room {
    players: ChessWebSocket[];
    game: Chess;
    dbGameId?: string;
    clock: { w: number; b: number }; // Time remaining in ms
    lastMoveTime: number;            // Timestamp of the last move
}

const rooms = new Map<string, Room>();

function sendToClient(ws: WebSocket, message: ServerMessage) {
    ws.send(JSON.stringify(message));
}

export function setupWebSockets(wss: WebSocketServer) {
    let waitingPlayer: ChessWebSocket | null = null; 

    wss.on("connection", (socket: WebSocket, req: any) => {
        const ws = socket as ChessWebSocket;
        
        // Hydrate socket with Auth data
        ws.userId = req.userId;
        ws.username = req.username;
        ws.isAlive = true;
        
        console.log(`Player ${ws.username} Connected!`);

        ws.on('pong', () => { 
            ws.isAlive = true; 
        });

        ws.on("message", async (data) => {
            try {
                const parsedMessage = JSON.parse(data.toString()) as ClientMessage;
                
                switch (parsedMessage.type) {
                    
                    case 'find_match': {
                        if (waitingPlayer && waitingPlayer.readyState !== WebSocket.OPEN) {
                            console.log(`Cleared dead connection for waiting player ${waitingPlayer.username}`);
                            waitingPlayer = null;
                        }
                        if (waitingPlayer) {
                            if (waitingPlayer === ws) return; 

                            const roomId = crypto.randomUUID(); 

                            // Create the room with a 10-minute clock (600,000 ms)
                            rooms.set(roomId, {
                                players: [waitingPlayer, ws],
                                game: new Chess(),
                                clock: { w: 600000, b: 600000 }, 
                                lastMoveTime: Date.now()         
                            });

                            const room = rooms.get(roomId)!;
                            
                            // Set State on Player 1
                            waitingPlayer.roomId = roomId;
                            waitingPlayer.color = 'w';
                            waitingPlayer.sessionId = crypto.randomUUID();
                            
                            // Set State on Player 2
                            ws.roomId = roomId;
                            ws.color = 'b';
                            ws.sessionId = crypto.randomUUID();

                            const dbGame = await prisma.game.create({
                                data: { 
                                    status: 'active',
                                    whitePlayerId: waitingPlayer.userId,
                                    blackPlayerId: ws.userId
                                }
                            });
                            room.dbGameId = dbGame.id;

                            sendToClient(waitingPlayer, { type: 'match_found', roomId, color: 'white' });
                            sendToClient(ws, { type: 'match_found', roomId, color: 'black' });

                            const startingState = {
                                type: 'state' as const,
                                fen: room.game.fen(),
                                turn: room.game.turn(),
                                clock: room.clock
                            };
                            sendToClient(waitingPlayer, startingState);
                            sendToClient(ws, startingState);

                            waitingPlayer = null; 
                            console.log(`Match created: Room ${roomId}`);
                        } else {
                            waitingPlayer = ws;
                            console.log(`Player ${ws.username} is waiting for a match...`);
                        }
                        break;
                    }

                    case 'move': {
                        if (!ws.roomId) break;
                        
                        const room = rooms.get(ws.roomId);
                        if (!room) return;
                        
                        const currTurn = room.game.turn();
                        if (!currTurn) break;
                        
                        if (currTurn !== ws.color) {
                            sendToClient(ws, { type: 'error', message: 'Not your turn' });
                            break;
                        }

                        // CLOCK MATH
                        const now = Date.now();
                        const timeElapsed = now - room.lastMoveTime;
                        room.clock[currTurn] -= timeElapsed;
                        room.lastMoveTime = now; // Reset timer for the next player

                        // Did they run out of time?
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
                            break; 
                        }
                        
                        try {
                            const moveResult = room.game.move({ 
                                from: parsedMessage.from, 
                                to: parsedMessage.to,
                                promotion: parsedMessage.promotion || 'q'
                            });

                            if (!moveResult) {
                                sendToClient(ws, { type: 'error', message: 'Illegal move' });
                                break;
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
                                } else if (room.game.isDraw() || room.game.isStalemate() || room.game.isThreefoldRepetition()) {
                                    resultMessage = "Draw!";
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
                        break;
                    }

                    case 'resign': {
                        if (!ws.roomId) break;
                        const room = rooms.get(ws.roomId);
                        if (!room) break;
                    
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
                        break;
                    }

                    case 'draw_offer': {
                        if (!ws.roomId) break;
                        const room = rooms.get(ws.roomId);
                        if (!room) break;
                    
                        const opponent = room.players.find(p => p !== ws);
                        if (opponent) {
                            sendToClient(opponent, { type: 'draw_offered' });
                            sendToClient(opponent, { type: 'chat', message: 'Your opponent offered a draw.' });
                        }
                        break;
                    }
                    
                    case 'draw_response': {
                        if (!ws.roomId) break;
                        const room = rooms.get(ws.roomId);
                        if (!room) break;
                    
                        const opponent = room.players.find(p => p !== ws);
                    
                        if (parsedMessage.accept) {
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
                        break;
                    }

                    case 'chat': {
                        if (!ws.roomId) break;
                        const room = rooms.get(ws.roomId);
                        if (!room) break;

                        const opponent = room.players.find(p => p !== ws);
                        if (opponent) {
                            sendToClient(opponent, { type: 'chat', message: parsedMessage.message });
                        }
                        break;
                    }

                    case 'reconnect': {
                        const { roomId, sessionId } = parsedMessage;
                        const room = rooms.get(roomId);
                        
                        if (!room) {
                            sendToClient(ws, { type: 'error', message: 'Room no longer exists.' });
                            break;
                        }

                        const ghostIndex = room.players.findIndex(p => p.sessionId === sessionId);
                        
                        if (ghostIndex === -1) {
                            sendToClient(ws, { type: 'error', message: 'Invalid Session ID.' });
                            break;
                        }
                        
                        const ghost = room.players[ghostIndex];
                        
                        if (ghost.userId !== ws.userId) {
                            sendToClient(ws, { type: 'error', message: 'Unauthorized: Identity mismatch.' });
                            break;
                        }
                        ws.roomId = roomId;
                        ws.color = ghost.color;
                        ws.sessionId = sessionId;
                        
                        room.players[ghostIndex] = ws;

                        ghost.isBeingReplaced = true;
                        ghost.terminate();

                        const colorString = ws.color === 'w' ? 'white' : 'black';
                        sendToClient(ws, { type: 'room_joined', color: colorString, sessionId: sessionId });
                        sendToClient(ws, { type: 'state', fen: room.game.fen(), turn: room.game.turn(), clock: room.clock });

                        const opponent = room.players.find(p => p !== ws);
                        if (opponent) {
                            sendToClient(opponent, { type: 'chat', message: 'Your opponent reconnected!' });
                        }
                        break;
                    }
                }
            } catch (error) {
                console.error("Received invalid JSON format");
            }
        });

        ws.on("close", () => {
            if (ws.isBeingReplaced) return; 
            
            if (waitingPlayer === ws) {
                waitingPlayer = null;
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

    // Heartbeat Interval
    const heartBeatInterval = setInterval(() => {
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

    // Timeout Sweeper (Runs every 1 second)
    const sweeperInterval = setInterval(async () => {
        const now = Date.now();

        for (const [roomId, room] of rooms.entries()) {
            const turn = room.game.turn();
            const timeElapsed = now - room.lastMoveTime;
            
            // If the elapsed time is greater than the player's remaining time, they flagged!
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