import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-chess-key';

export interface AuthRequest extends Request {
    userId?: string;
    username?: string;
}

export const requireAuth = (req : AuthRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if(!authHeader || !authHeader.startsWith('Bearer ')){
        res.status(401).json({ error: 'Unauthorized: Missing token' });
        return;
    }

    const token = authHeader.split(' ')[1];

    try{
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string, username: string };
        req.userId = decoded.userId;
        req.username = decoded.username;
        next(); 

    }catch(error){
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
}