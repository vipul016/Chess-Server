"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const game_controller_1 = require("../controllers/game.controller");
const httpAuth_1 = require("../middlewares/httpAuth");
const game_controller_2 = require("../controllers/game.controller");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const analyzeLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    message: { error: 'Too many analysis requests. Please try again later.' }
});
const router = (0, express_1.Router)();
router.get('/', httpAuth_1.requireAuth, game_controller_1.getMyGames);
router.get('/active', httpAuth_1.requireAuth, game_controller_2.getActiveGames);
router.get('/my-active', httpAuth_1.requireAuth, game_controller_2.getMyActiveGame);
router.get('/:id', httpAuth_1.requireAuth, game_controller_1.getGameById);
router.get('/:id/analyze', httpAuth_1.requireAuth, analyzeLimiter, game_controller_2.getFullGameAnalysis);
router.post('/analyze', httpAuth_1.requireAuth, analyzeLimiter, game_controller_2.analyzeGamePosition);
exports.default = router;
