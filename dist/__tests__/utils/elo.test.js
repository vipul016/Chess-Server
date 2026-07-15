"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const elo_1 = require("../../utils/elo");
describe('calculateElo', () => {
    it('white wins at equal ratings (1200 vs 1200)', () => {
        const result = (0, elo_1.calculateElo)(1200, 1200, 'w');
        expect(result.newWhite).toBeGreaterThan(1200);
        expect(result.newBlack).toBeLessThan(1200);
        expect(result.whiteDiff).toBe(-result.blackDiff);
    });
    it('black wins at equal ratings (1200 vs 1200)', () => {
        const result = (0, elo_1.calculateElo)(1200, 1200, 'b');
        expect(result.newWhite).toBeLessThan(1200);
        expect(result.newBlack).toBeGreaterThan(1200);
        expect(result.whiteDiff).toBe(-result.blackDiff);
    });
    it('draw at equal ratings: both stay the same', () => {
        const result = (0, elo_1.calculateElo)(1200, 1200, 'd');
        expect(result.whiteDiff).toBe(0);
        expect(result.blackDiff).toBe(0);
        expect(result.newWhite).toBe(1200);
        expect(result.newBlack).toBe(1200);
    });
    it('favored player (1500) wins against lower rated (1200): gains less than 16', () => {
        const result = (0, elo_1.calculateElo)(1500, 1200, 'w');
        expect(result.whiteDiff).toBeGreaterThan(0);
        expect(result.whiteDiff).toBeLessThan(16);
        expect(result.blackDiff).toBeLessThan(0);
    });
    it('upset: lower rated (1200) beats higher rated (1500): gains more than 16', () => {
        const result = (0, elo_1.calculateElo)(1200, 1500, 'w');
        expect(result.whiteDiff).toBeGreaterThan(16);
        expect(result.blackDiff).toBeLessThan(-16);
    });
    it('K-factor: no single rating change exceeds 32', () => {
        const scenarios = [
            [1200, 1200, 'w'],
            [1200, 1200, 'b'],
            [1200, 1200, 'd'],
            [2000, 800, 'w'],
            [800, 2000, 'w'],
            [2000, 800, 'b'],
            [800, 2000, 'b'],
        ];
        for (const [wr, br, outcome] of scenarios) {
            const result = (0, elo_1.calculateElo)(wr, br, outcome);
            expect(Math.abs(result.whiteDiff)).toBeLessThanOrEqual(32);
            expect(Math.abs(result.blackDiff)).toBeLessThanOrEqual(32);
        }
    });
    it('draw between unequal ratings: lower rated gains, higher rated loses slightly', () => {
        const result = (0, elo_1.calculateElo)(1500, 1200, 'd');
        expect(result.whiteDiff).toBeLessThan(0);
        expect(result.blackDiff).toBeGreaterThan(0);
    });
});
