export type ClientMessage = 
  | { type: 'join'; roomId: string }
  | { type: 'chat'; message: string }
  | { type : 'move'; from : string; to : string; promotion ?: string}
  | { type: 'reconnect'; roomId: string; sessionId: string };

export type ServerMessage =
  | { type: 'room_joined'; color: 'white' | 'black'; sessionId: string}
  | { type: 'state'; fen: string; turn: 'w' | 'b' } 
  | { type: 'error'; message: string }
  | { type: 'game_over'; result: string}
  | { type: 'chat'; message: string };
