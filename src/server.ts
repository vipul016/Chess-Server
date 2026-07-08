import {WebSocketServer,WebSocket} from 'ws';
import { ClientMessage,ServerMessage } from './types';
import { Chess } from 'chess.js';

interface Room {
    players: WebSocket[];
    game : Chess;
}
const wss = new WebSocketServer({ port: 8080 });
const rooms = new Map<string,Room>();

wss.on("connection",(ws: WebSocket)=>{
    console.log("A New Player Connected!")

    let currentRoomId : string | null = null;

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
                        ws.send("Error: Room is Full!");
                        break;
                    }
                    room.players.push(ws);
                    currentRoomId = roomId;
                    if(room.players.length === 1){
                        console.log(`Player 1 joined room ${roomId}. Waiting for opponent...`);
                        ws.send(JSON.stringify({type : "room_joined",color : "white"}));
                    }
                    else if(room.players.length === 2){
                        console.log(`Player 2 joined room ${roomId}. Game is ready!`);
                        ws.send(JSON.stringify({ type: 'room_joined', color: 'black' }));

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
                    try{
                        room?.game.move({from : parsedMessage.from, to : parsedMessage.to });

                        const newFen = room?.game.fen();
                        const turn = room?.game.turn();

                        room?.players.forEach(client => {
                            client.send(JSON.stringify({type: 'state',fen : newFen,turn : turn}));
                        })
                    }catch(error){
                        ws.send(JSON.stringify({type : 'error', message : 'illegal move'}));
                    }
                }
        }
        }catch(error){
            console.error("Recived invalid JSON format");
        }
        
    });
    // listen for disconnection
    ws.on("close",()=>{
        console.log("Client Disconnected");

        if(currentRoomId){
            const room = rooms.get(currentRoomId);

            if(room){
                room.players = room.players.filter(client => client !== ws);
    
                room.players.forEach(client => {
                    client.send(JSON.stringify({ type: 'error', message: 'Your opponent disconnected.' }));
                })

                if(room.players.length === 0){
                    rooms.delete(currentRoomId);
                    console.log(`Room ${currentRoomId} is empty and has been deleted.`);
                }
            }
        }


    });
})