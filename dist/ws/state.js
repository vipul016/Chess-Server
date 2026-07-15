"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingPrivateRooms = exports.matchQueue = exports.rooms = void 0;
exports.sendToClient = sendToClient;
// Global in-memory state
exports.rooms = new Map();
exports.matchQueue = [];
exports.pendingPrivateRooms = new Map();
// Shared utility
function sendToClient(ws, message) {
    ws.send(JSON.stringify(message));
}
