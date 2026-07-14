import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '../types';
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ChessWebSocket extends WebSocket {
    isAlive: boolean;
    sessionId?: string;
    userId?: string;
    username?: string;
    color?: 'w' | 'b';
    isBeingReplaced?: boolean;
}

interface Room {
    players: ChessWebSocket[];
    game: Chess;
    dbGameId?: string;
}

const rooms = new Map();

function sendToClient(ws: WebSocket, message: ServerMessage) {
    ws.send(JSON.stringify(message));
}

export function setupWebSockets(wss: WebSocketServer) {
    wss.on("connection", (socket: WebSocket,req: any    ) => {
        const ws = socket as ChessWebSocket;

        ws.userId = req.userId;
        ws.username = req.username;
        console.log(`Player ${ws.username} Connected!`);

        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        let currentRoomId: string | null = null;
        let playerColor: 'w' | 'b' | null = null;

        ws.on("message", async (data) => {
            try {
                const parsedMessage = JSON.parse(data.toString()) as ClientMessage;
                
                switch (parsedMessage.type) {
                    case 'join': {
                        const roomId = parsedMessage.roomId;
                        if (!rooms.has(roomId)) {
                            rooms.set(roomId, { players: [], game: new Chess() });
                        }
                        const room = rooms.get(roomId)!;
                        if (room.players.length >= 2) {
                            sendToClient(ws, { type: 'error', message: 'room is full!' });
                            break;
                        }
                        ws.sessionId = crypto.randomUUID();
                        currentRoomId = roomId;
                        room.players.push(ws);

                        if (room.players.length === 1) {
                            playerColor = 'w';
                            ws.color = 'w';
                            console.log(`Player 1 joined room ${roomId}. Waiting...`);
                            sendToClient(ws, { type: "room_joined", color: "white", sessionId: ws.sessionId });
                        }
                        else if (room.players.length === 2) {
                            playerColor = 'b';
                            ws.color = 'b';
                            console.log(`Player 2 joined room ${roomId}. Game is ready!`);
                            sendToClient(ws, { type: 'room_joined', color: 'black', sessionId: ws.sessionId });

                            const startingState = {
                                type: 'state' as const,
                                fen: room.game.fen(),
                                turn: room.game.turn()
                            };

                            const dbGame = await prisma.game.create({ data: { status: 'active' } });
                            room.dbGameId = dbGame.id;
                            
                            sendToClient(room.players[0], startingState);
                            sendToClient(room.players[1], startingState);
                        }
                        break;
                    }
                    case 'chat':
                        console.log("Player says:", parsedMessage.message);
                        ws.send("Server received: " + parsedMessage.message);
                        break;
                    case 'move': {
                        if (!currentRoomId) break;
                        const room = rooms.get(currentRoomId);
                        if (!room) return;
                        const currTurn = room.game.turn();
                        if (!currTurn) break;
                        if (currTurn !== playerColor) {
                            sendToClient(ws, { type: 'error', message: 'Not your turn' });
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
                                sendToClient(client, { type: 'state', fen: newFen, turn: turn });
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
                                        data: { status: 'finished', result: resultMessage, finishedAt: new Date() }
                                    });
                                }
                                rooms.delete(currentRoomId);
                            }
                        } catch (error) {
                            sendToClient(ws, { type: 'error', message: 'Move execution failed' });
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
                        ws.sessionId = sessionId;
                        ws.color = ghost.color;
                        currentRoomId = roomId;
                        playerColor = ghost.color;
                        room.players[ghostIndex] = ws;

                        ghost.isBeingReplaced = true;
                        ghost.terminate();

                        const colorString = ws.color === 'w' ? 'white' : 'black';
                        sendToClient(ws, { type: 'room_joined', color: colorString, sessionId: sessionId });
                        sendToClient(ws, { type: 'state', fen: room.game.fen(), turn: room.game.turn() });

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
            console.log("Client Disconnected");
            if (currentRoomId) {
                const room = rooms.get(currentRoomId);
                if (room) {
                    room.players = room.players.filter(client => client !== ws);
                    room.players.forEach(client => {
                        sendToClient(client, { type: 'error', message: 'Your opponent disconnected.' });
                    });
                    if (room.players.length === 0) {
                        rooms.delete(currentRoomId);
                    }
                }
            }
        });
    });

    const heartBeatInterval = setInterval(() => {
        wss.clients.forEach((client) => {
            const ws = client as ChessWebSocket;
            if (ws.isAlive === false) {
                console.log("Terminating ghost connection due to missed heartbeat.");
                ws.terminate();
            }
            ws.ping();
            ws.isAlive = false;
        });
    }, 30000);

    wss.on('close', () => clearInterval(heartBeatInterval));
}