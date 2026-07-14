import url from 'url';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-chess-key';

export const handleWsUpgrade = (wss: WebSocketServer) => {
    return (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const { query } = url.parse(request.url || '', true);
        const token = query.token as string;

        if (!token) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET) as { userId: string, username: string };
            
            (request as any).userId = decoded.userId;
            (request as any).username = decoded.username;

            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        } catch (error) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
        }
    };
};