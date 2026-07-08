import {WebSocketServer,WebSocket} from 'ws';
import { ClientMessage,ServerMessage } from './types';
import { Chess } from 'chess.js';
import crypto from 'crypto';

interface ChessWebSocket extends WebSocket{
    isAlive : boolean;
    sessionId?: string;
    color: 'w' | 'b';
    isBeingReplaced?: boolean;
}
interface Room {
    players: ChessWebSocket[];
    game : Chess;
}
const wss = new WebSocketServer({ port: 8080 });
const rooms = new Map<string,Room>();

function sendToClient(ws : WebSocket, message: ServerMessage){
    ws.send(JSON.stringify(message));
}

wss.on("connection",(socket: WebSocket)=>{
    const ws = socket as ChessWebSocket;
    console.log("A New Player Connected!")


    ws.isAlive = true;
    ws.on('pong',()=>{
        ws.isAlive = true;
    })

    let currentRoomId : string | null = null;
    let playerColor : 'w' | 'b' | null = null;

    // listen for message
    ws.on("message",(data)=>{
        try{
            const parsedMessage = JSON.parse(data.toString()) as ClientMessage;
            switch (parsedMessage.type){
                case 'join':{
                    const roomId = parsedMessage.roomId;
                    if(!rooms.has(roomId)){
                        rooms.set(roomId,{
                            players: [],
                            game : new Chess()
                        });
                    }
                    const room = rooms.get(roomId)!;
                    if(room.players.length >= 2){
                        sendToClient(ws,{type : 'error',message: 'room is full!'});
                        break;
                    }
                    ws.sessionId = crypto.randomUUID();
                    currentRoomId = roomId;

                    room.players.push(ws);

                    if(room.players.length === 1){
                        playerColor = 'w';
                        console.log(`Player 1 joined room ${roomId}. Waiting for opponent...`);
                        sendToClient(ws,{type : "room_joined",color : "white",sessionId: ws.sessionId});
                    }
                    else if(room.players.length === 2){
                        playerColor = 'b';
                        console.log(`Player 2 joined room ${roomId}. Game is ready!`);
                        sendToClient(ws,{ type: 'room_joined', color: 'black',sessionId: ws.sessionId })

                        const startingState = JSON.stringify({
                            type : 'state',
                            fen : room.game.fen(),
                            turn : room.game.turn()
                        })
                        room.players[0].send(startingState);
                        room.players[1].send(startingState);
                    }
                    break;
                }
                case 'chat':
                    console.log("Player says:", parsedMessage.message);
                    ws.send("Server received: " + parsedMessage.message);
                    break;
                case 'move': {
                    if(!currentRoomId){
                        break;
                    }
                    const room = rooms.get(currentRoomId);
                    if(!room) return;
                    const currTurn = room?.game.turn();
                    if(!currTurn) break;
                    if(currTurn !== playerColor){
                        sendToClient(ws,{type : 'error', message : 'Not your turn'});
                        break;
                    }
                    try{
                        room?.game.move({from : parsedMessage.from, to : parsedMessage.to });

                        const newFen = room?.game.fen();
                        const turn = room?.game.turn();

                        room?.players.forEach(client => {
                            sendToClient(client,{type: 'state',fen : newFen!,turn : turn!});
                        })
                        if(room.game.isGameOver()){
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
                        }
                    }catch(error){
                        sendToClient(ws,{type : 'error', message : 'illegal move'});
                    }
                    break;
                }
                case 'reconnect': {
                    const {roomId,sessionId} = parsedMessage;
                    const room = rooms.get(roomId);
                    if (!room) {
                        sendToClient(ws, { type: 'error', message: 'Room no longer exists.' });
                        break;
                    }

                    const ghostIndex = room.players.findIndex(p => p.sessionId===sessionId);

                    if(ghostIndex === -1){
                        sendToClient(ws, { type: 'error', message: 'Invalid Session ID.' });
                        break;
                    }
                    const ghost = room.players[ghostIndex];

                    console.log(`Player ${ghost.color} is reconnecting to ${roomId}...`);

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
        }catch(error){
            console.error("Recived invalid JSON format");
        }
        
    });
    // listen for disconnection
    ws.on("close",()=>{

        if(ws.isBeingReplaced){
            console.log("Ghost connection safely terminated.");
            return;
        }
        console.log("Client Disconnected");

        if(currentRoomId){
            const room = rooms.get(currentRoomId);

            if(room){
                room.players = room.players.filter(client => client !== ws);
    
                room.players.forEach(client => {
                    sendToClient(client,{ type: 'error', message: 'Your opponent disconnected.' });
                })

                if(room.players.length === 0){
                    rooms.delete(currentRoomId);
                    console.log(`Room ${currentRoomId} is empty and has been deleted.`);
                }
            }
        }


    });
})

const heartBeatInterval = setInterval(()=>{
    wss.clients.forEach((client)=>{
        const ws = client as ChessWebSocket;

        if(ws.isAlive === false){
            console.log("Terminating ghost connection due to missed heartbeat.");
            ws.terminate();
        }
        ws.ping();
        ws.isAlive = false;
    })
},30000);

wss.on('close',()=>{
    clearInterval(heartBeatInterval);
});

console.log("Chess Server running on ws://localhost:8080");