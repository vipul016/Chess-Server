import {Request,Response} from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if(!JWT_SECRET){
    console.error("FATAL ERROR: JWT_SECRET environment variable is not set.");
    process.exit(1);
}

const prisma = new PrismaClient();   

const authSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be under 20 characters"),
    password: z.string().min(6, "Password must be at least 6 characters").max(100)
});


export const signup = async (req : Request, res: Response)=> {
    try{
        const parsed = authSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }
        const { username, password } = parsed.data;
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