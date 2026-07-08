export type ClientMessage = 
  | { type: 'join'; roomId: string }
  | { type: 'chat'; message: string }
  | { type : 'move'; from : string; to : string};

export type ServerMessage =
  | { type: 'room_joined'; color: 'white' | 'black' }
  | { type: 'state'; fen: string; turn: 'w' | 'b' } 
  | { type: 'error'; message: string }
  | { type: 'game_over'; result: string};
  