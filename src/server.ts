import {WebSocketServer,WebSocket} from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection",(ws: WebSocket)=>{
    console.log("A New Player Connected!")

    // listen for message
    ws.on("message",(data)=>{
        console.log(data.toString());
        ws.send("Server echos: "+ data.toString());
    });

    // listen for disconnection
    ws.on("close",()=>{
        console.log("Client Disconnected");
    });
})