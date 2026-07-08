import {WebSocketServer,WebSocket} from 'ws';
import { ClientMessage } from './types';

const wss = new WebSocketServer({ port: 8080 });
const rooms = new Map<string,WebSocket[]>();

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
                        rooms.set(roomId,[]);
                    }
                    const room = rooms.get(roomId)!;
                    if(room.length >= 2){
                        ws.send("Error: Room is Full!");
                        break;
                    }
                    room.push(ws);
                    currentRoomId = roomId;
                    if(room.length === 1){
                        console.log(`Player 1 joined room ${roomId}. Waiting for opponent...`);
                        ws.send("You joined as Player 1 (White). Waiting for opponent...");
                    }
                    else if(room.length === 2){
                        console.log(`Player 2 joined room ${roomId}. Game is ready!`);
                        ws.send("You joined as Player 2 (Black). Game starting!");

                        room[0].send("Your opponent has connected! The game begins.");
                    }
                    break;
                }
                case 'chat':
                    console.log("Player says:", parsedMessage.message);
                    ws.send("Server received: " + parsedMessage.message);
                    break;
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
                const updatedRoom = room.filter(client => client !== ws);
                rooms.set(currentRoomId,updatedRoom);
    
                updatedRoom.forEach(client => {
                    client.send("Your opponent disconnected.")
                })

                if(updatedRoom.length === 0){
                    rooms.delete(currentRoomId);
                    console.log(`Room ${currentRoomId} is empty and has been deleted.`);
                }
            }
        }


    });
})