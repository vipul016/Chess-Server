import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if(!JWT_SECRET){
    console.error("FATAL ERROR: JWT_SECRET environment variable is not set.");
    process.exit(1);
}

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
        const decoded = jwt.verify(token, JWT_SECRET as string) as { userId: string, username: string };
        req.userId = decoded.userId;
        req.username = decoded.username;
        next(); 

    }catch(error){
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
}