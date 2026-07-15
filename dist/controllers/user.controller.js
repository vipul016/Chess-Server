"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfile = exports.getProfile = void 0;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const prisma = new client_1.PrismaClient();
const updateProfileSchema = zod_1.z.object({
    username: zod_1.z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be under 20 characters").optional(),
    bio: zod_1.z.string().max(160, "Bio must be under 160 characters").optional(),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters").max(100).optional(),
});
const getProfile = async (req, res) => {
    try {
        const username = req.params.username;
        const user = await prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
                rating: true,
                wins: true,
                losses: true,
                draws: true,
                bio: true,
                createdAt: true,
            }
        });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        const recentGames = await prisma.game.findMany({
            where: {
                status: 'finished',
                OR: [
                    { whitePlayerId: user.id },
                    { blackPlayerId: user.id }
                ]
            },
            include: {
                whitePlayer: { select: { username: true, rating: true } },
                blackPlayer: { select: { username: true, rating: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        res.json({ user, recentGames });
    }
    catch (e) {
        res.status(500).json({ error: "Server error" });
    }
};
exports.getProfile = getProfile;
const updateProfile = async (req, res) => {
    try {
        const parsed = updateProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }
        const { username, bio, password } = parsed.data;
        const updates = {};
        if (username) {
            const existing = await prisma.user.findUnique({ where: { username } });
            if (existing && existing.id !== req.userId) {
                return res.status(400).json({ error: "Username already taken" });
            }
            updates.username = username;
        }
        if (bio !== undefined) {
            updates.bio = bio;
        }
        if (password) {
            updates.passwordHash = await bcryptjs_1.default.hash(password, 10);
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: "No fields provided to update" });
        }
        const updatedUser = await prisma.user.update({
            where: { id: req.userId },
            data: updates,
            select: { id: true, username: true, bio: true }
        });
        res.json({ message: "Profile updated successfully", user: updatedUser });
    }
    catch (e) {
        res.status(500).json({ error: "Server error" });
    }
};
exports.updateProfile = updateProfile;
