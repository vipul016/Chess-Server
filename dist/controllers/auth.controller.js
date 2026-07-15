"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMe = exports.login = exports.signup = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET environment variable is not set.");
    process.exit(1);
}
const prisma = new client_1.PrismaClient();
const authSchema = zod_1.z.object({
    username: zod_1.z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be under 20 characters"),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters").max(100)
});
const signup = async (req, res) => {
    try {
        const parsed = authSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }
        const { username, password } = parsed.data;
        if (!username || !password)
            return res.status(400).json({ error: "Missing fields" });
        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing)
            return res.status(400).json({ error: "Username taken" });
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma.user.create({
            data: { username, passwordHash }
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, userId: user.id, username: user.username });
    }
    catch (error) {
        res.status(500).json({ error: "Server error" });
    }
};
exports.signup = signup;
const login = async (req, res) => {
    try {
        const parsed = authSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }
        const { username, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user)
            return res.status(400).json({ error: "Invalid credentials" });
        const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!valid)
            return res.status(400).json({ error: "Invalid credentials" });
        const token = jsonwebtoken_1.default.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, userId: user.id, username: user.username });
    }
    catch (error) {
        res.status(500).json({ error: "Server error" });
    }
};
exports.login = login;
const getMe = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        res.json({
            id: user.id,
            username: user.username,
            rating: user.rating,
            wins: user.wins,
            losses: user.losses,
            draws: user.draws,
            createdAt: user.createdAt
        });
    }
    catch (e) {
        res.status(500).json({ error: "Server error" });
    }
};
exports.getMe = getMe;
