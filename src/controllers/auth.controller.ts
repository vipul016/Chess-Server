import {Request,Response} from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if(!JWT_SECRET){
    console.error("FATAL ERROR: JWT_SECRET environment variable is not set.");
    process.exit(1);
}

const prisma = new PrismaClient();    

export const signup = async (req : Request, res: Response)=> {
    try{
        const {username,password} = req.body;
        if (!username || !password) return res.status(400).json({ error: "Missing fields" });

        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) return res.status(400).json({ error: "Username taken" });

        const passwordHash = await bcrypt.hash(password,10);
        const user = await prisma.user.create({
            data: { username, passwordHash }
        });
        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, userId: user.id, username: user.username });

    }catch(error){
        res.status(500).json({ error: "Server error" });    
    }
}

export const login = async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;
        
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return res.status(400).json({ error: "Invalid credentials" });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return res.status(400).json({ error: "Invalid credentials" });

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, userId: user.id, username: user.username });
    } catch (error) {
        res.status(500).json({ error: "Server error" });
    }
};