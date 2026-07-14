export type ClientMessage = 
  | { type: 'join'; roomId: string}
  | { type: 'find_match'}
  | { type: 'cancel_find_match'}
  | { type: 'chat'; message: string }
  | { type : 'move'; from : string; to : string; promotion ?: string}
  | { type: 'reconnect'; roomId: string; sessionId: string; token: string}
  | { type: 'resign' }                                     
  | { type: 'leave_room' }
  | { type: 'draw_offer' }                                
  | { type: 'draw_response'; accept: boolean }
  | { type: 'create_private_room' }
  | { type: 'join_private_room'; roomCode: string }
  | { type: 'play_bot'; level: number }
  | { type: 'rematch_offer' }
  | { type: 'rematch_accept' };

export type PlayerInfo = { username: string; rating: number };

export type ServerMessage =
  | { type: 'room_joined'; color: 'white' | 'black'; sessionId: string; players: { white: PlayerInfo; black: PlayerInfo } }
  | { type: 'match_found'; roomId: string; color: 'white' | 'black'; sessionId: string; players: { white: PlayerInfo; black: PlayerInfo } }
  | { type: 'state'; fen: string; turn: 'w' | 'b'; clock: { w: number; b: number }} 
  | { type: 'error'; message: string }
  | { type: 'game_over'; result: string}
  | { type: 'chat'; message: string }
  | { type: 'draw_offered' }
  | { type: 'room_created'; roomCode: string }
  | { type: 'rematch_offered' };
