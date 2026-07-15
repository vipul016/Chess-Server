"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockfishService = void 0;
// src/services/stockfish.service.ts
const child_process_1 = require("child_process");
// Ensure this path matches where Stockfish is installed on your OS!
const STOCKFISH_PATH = process.env.STOCKFISH_PATH || 'stockfish';
class StockfishService {
    engine = null;
    constructor() {
        this.initEngine();
    }
    initEngine() {
        try {
            this.engine = (0, child_process_1.spawn)(STOCKFISH_PATH);
            // Set up UCI (Universal Chess Interface) protocol mode
            this.engine.stdin.write('uci\n');
            this.engine.stdin.write('isready\n');
            this.engine.on('error', (err) => {
                console.error('Failed to start Stockfish binary. Is it installed in your PATH?', err.message);
                this.engine = null;
            });
        }
        catch (e) {
            console.error('Stockfish initialization crash:', e);
        }
    }
    setSkillLevel(level) {
        if (!this.engine)
            return;
        // Map 1-20 to Stockfish Skill Level 0-20
        const skill = Math.max(0, Math.min(20, level));
        this.engine.stdin.write(`setoption name Skill Level value ${skill}\n`);
    }
    /**
     * Sends a single board state to Stockfish and gets an evaluation + best move
     */
    analyzePosition(fen, depth = 10) {
        return new Promise((resolve, reject) => {
            if (!this.engine) {
                return reject(new Error('Stockfish engine is not running'));
            }
            let output = '';
            const onData = (data) => {
                output += data.toString();
                // Stockfish outputs "bestmove" when it finishes the requested depth
                if (output.includes('bestmove')) {
                    cleanup();
                    const isBlack = fen.includes(' b ');
                    const result = this.parseOutput(output, isBlack);
                    resolve(result);
                }
            };
            const cleanup = () => {
                this.engine?.stdout.removeListener('data', onData);
            };
            this.engine.stdout.on('data', onData);
            // Tell Stockfish to look at the current position and calculate
            this.engine.stdin.write(`position fen ${fen}\n`);
            this.engine.stdin.write(`go depth ${depth}\n`);
        });
    }
    /**
     * Loops through an array of FENs, evaluating each one to generate a post-game accuracy report
     */
    async analyzeFullGame(fens) {
        const analysis = [];
        let whiteAccuracySum = 0;
        let blackAccuracySum = 0;
        let whiteMoves = 0;
        let blackMoves = 0;
        // Evaluate the starting position first
        let previousEvalText = (await this.analyzePosition(fens[0], 10)).evaluation;
        let previousEvalNum = this.parseEvalToNumber(previousEvalText);
        // Loop through every move made in the game
        for (let i = 1; i < fens.length; i++) {
            const isWhiteTurn = i % 2 !== 0; // If 'i' is odd, White just moved to create this FEN
            const currentAnalysis = await this.analyzePosition(fens[i], 10);
            const currentEvalNum = this.parseEvalToNumber(currentAnalysis.evaluation);
            const classification = this.classifyMove(previousEvalNum, currentEvalNum, isWhiteTurn);
            // Calculate a rough accuracy score for this specific move (0 to 100)
            const diff = isWhiteTurn ? (previousEvalNum - currentEvalNum) : (currentEvalNum - previousEvalNum);
            const moveAccuracy = Math.max(0, 100 - (Math.max(0, diff) * 50));
            if (isWhiteTurn) {
                whiteAccuracySum += moveAccuracy;
                whiteMoves++;
            }
            else {
                blackAccuracySum += moveAccuracy;
                blackMoves++;
            }
            analysis.push({
                fen: fens[i],
                evaluation: currentAnalysis.evaluation,
                bestMove: currentAnalysis.bestMove,
                classification: classification
            });
            previousEvalNum = currentEvalNum;
        }
        return {
            whiteAccuracy: whiteMoves > 0 ? (whiteAccuracySum / whiteMoves).toFixed(1) : 0,
            blackAccuracy: blackMoves > 0 ? (blackAccuracySum / blackMoves).toFixed(1) : 0,
            moves: analysis
        };
    }
    // --- HELPER METHODS ---
    parseOutput(output, isBlackToMove) {
        const lines = output.split('\n');
        let bestMove = '';
        let evaluation = '0.00';
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].startsWith('bestmove')) {
                const parts = lines[i].split(' ');
                bestMove = parts[1]; // e.g., "e2e4"
            }
            if (lines[i].includes('score cp')) {
                const parts = lines[i].split(' ');
                const cpIndex = parts.indexOf('cp');
                if (cpIndex !== -1) {
                    let score = parseInt(parts[cpIndex + 1], 10) / 100;
                    if (isBlackToMove)
                        score = -score;
                    evaluation = score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
                }
            }
            else if (lines[i].includes('score mate')) {
                const parts = lines[i].split(' ');
                const mateIndex = parts.indexOf('mate');
                if (mateIndex !== -1) {
                    let mateIn = parseInt(parts[mateIndex + 1], 10);
                    if (isBlackToMove)
                        mateIn = -mateIn;
                    evaluation = `M${mateIn}`; // e.g. M3 or M-3
                }
            }
        }
        return { bestMove, evaluation };
    }
    classifyMove(evalBefore, evalAfter, isWhite) {
        const diff = isWhite ? (evalBefore - evalAfter) : (evalAfter - evalBefore);
        if (diff <= 0.1)
            return 'Best';
        if (diff <= 0.3)
            return 'Excellent';
        if (diff <= 0.5)
            return 'Good';
        if (diff <= 1.0)
            return 'Inaccuracy';
        if (diff <= 2.0)
            return 'Mistake';
        return 'Blunder';
    }
    parseEvalToNumber(evaluation) {
        if (evaluation.startsWith('M')) {
            return evaluation.includes('-') ? -1000 : 1000;
        }
        return parseFloat(evaluation);
    }
    kill() {
        if (this.engine) {
            this.engine.stdin.write('quit\n');
            this.engine.kill();
        }
    }
}
exports.StockfishService = StockfishService;
