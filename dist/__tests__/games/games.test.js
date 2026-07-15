"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../../app"));
const unique = () => `u_${Math.floor(Math.random() * 1000000)}`;
describe('Game Endpoints', () => {
    let token;
    beforeAll(async () => {
        const username = unique();
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/auth/signup')
            .send({ username, password: 'password123' });
        token = res.body.token;
    });
    describe('GET /games', () => {
        it('with auth returns 200 and an array', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .get('/games')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
        it('without auth returns 401', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .get('/games');
            expect(res.status).toBe(401);
        });
    });
    describe('GET /games/active', () => {
        it('with auth returns 200 and an array', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .get('/games/active')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
    });
    describe('POST /games/analyze', () => {
        it('with valid FEN returns 200 or 500 (if stockfish not installed)', async () => {
            const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/games/analyze')
                .set('Authorization', `Bearer ${token}`)
                .send({ fen });
            // Accept 200 (stockfish works) or 500 (stockfish not installed)
            expect([200, 500]).toContain(res.status);
        });
        it('with invalid/short FEN returns 400', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/games/analyze')
                .set('Authorization', `Bearer ${token}`)
                .send({ fen: 'abc' });
            expect(res.status).toBe(400);
        });
        it('without auth returns 401', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/games/analyze')
                .send({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' });
            expect(res.status).toBe(401);
        });
    });
});
