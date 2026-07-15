"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../../app"));
const unique = () => `u_${Math.floor(Math.random() * 1000000)}`;
describe('Auth Endpoints', () => {
    let validToken;
    let validUsername;
    const validPassword = 'securePass123';
    // Create a user for login and /me tests
    beforeAll(async () => {
        validUsername = unique();
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/auth/signup')
            .send({ username: validUsername, password: validPassword });
        validToken = res.body.token;
    });
    describe('POST /auth/signup', () => {
        it('happy path: returns 200 with token, userId, username', async () => {
            const username = unique();
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/signup')
                .send({ username, password: 'password123' });
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('token');
            expect(res.body).toHaveProperty('userId');
            expect(res.body.username).toBe(username);
        });
        it('duplicate username returns 400', async () => {
            const username = unique();
            await (0, supertest_1.default)(app_1.default)
                .post('/auth/signup')
                .send({ username, password: 'password123' });
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/signup')
                .send({ username, password: 'password123' });
            expect(res.status).toBe(400);
        });
        it('username too short (2 chars) returns 400', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/signup')
                .send({ username: 'ab', password: 'password123' });
            expect(res.status).toBe(400);
        });
        it('username too long (21 chars) returns 400', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/signup')
                .send({ username: 'a'.repeat(21), password: 'password123' });
            expect(res.status).toBe(400);
        });
        it('password too short (5 chars) returns 400', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/signup')
                .send({ username: unique(), password: '12345' });
            expect(res.status).toBe(400);
        });
        it('missing fields returns 400', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/signup')
                .send({});
            expect(res.status).toBe(400);
        });
    });
    describe('POST /auth/login', () => {
        it('happy path: returns 200 with token, userId, username', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/login')
                .send({ username: validUsername, password: validPassword });
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('token');
            expect(res.body).toHaveProperty('userId');
            expect(res.body.username).toBe(validUsername);
        });
        it('wrong password returns 400', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/login')
                .send({ username: validUsername, password: 'wrongpassword' });
            expect(res.status).toBe(400);
        });
        it('non-existent user returns 400', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/login')
                .send({ username: 'nonexistent_user_xyz', password: 'password123' });
            expect(res.status).toBe(400);
        });
        it('missing fields returns 400', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/auth/login')
                .send({});
            expect(res.status).toBe(400);
        });
    });
    describe('GET /auth/me', () => {
        it('with valid token returns 200 with user profile', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .get('/auth/me')
                .set('Authorization', `Bearer ${validToken}`);
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('id');
            expect(res.body).toHaveProperty('username');
            expect(res.body).toHaveProperty('rating');
            expect(res.body).toHaveProperty('wins');
            expect(res.body).toHaveProperty('losses');
            expect(res.body).toHaveProperty('draws');
        });
        it('without token returns 401', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .get('/auth/me');
            expect(res.status).toBe(401);
        });
        it('with invalid token returns 401', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .get('/auth/me')
                .set('Authorization', 'Bearer invalidtoken123');
            expect(res.status).toBe(401);
        });
    });
});
