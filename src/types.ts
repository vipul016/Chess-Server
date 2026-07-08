export type ClientMessage = 
  | { type: 'join'; roomId: string }
  | { type: 'chat'; message: string };