import { Room } from '../../../room/Room.js';

export function generateChessPgn(room: Room, result: any): string {
  const COL = 'abcdefgh';
  const PIECE_LETTER: Record<string, string> = {
    king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: '',
  };

  const INIT_BOARD: Record<string, string> = {};
  const BACK = ['rook','knight','bishop','queen','king','bishop','knight','rook'];
  for (let c = 0; c < 8; c++) {
    INIT_BOARD[`7,${c}`] = `white_${BACK[c]}`;
    INIT_BOARD[`0,${c}`] = `black_${BACK[c]}`;
    INIT_BOARD[`6,${c}`] = 'white_pawn';
    INIT_BOARD[`1,${c}`] = 'black_pawn';
  }

  const board = { ...INIT_BOARD };
  let pgn = '';

  for (let i = 0; i < room.moveHistory.length; i++) {
    const m = room.moveHistory[i];
    const fromKey = `${m.fromRow},${m.fromCol}`;
    const piece = board[fromKey] || '';
    const pieceType = piece.replace('white_', '').replace('black_', '');
    const letter = PIECE_LETTER[pieceType] || '';

    const from = `${COL[m.fromCol!]}${8 - m.fromRow!}`;
    const to = `${COL[m.col]}${8 - m.row}`;

    const captured = board[`${m.row},${m.col}`];
    const captureSymbol = captured ? 'x' : '';

    let notation: string;
    if (pieceType === 'king' && Math.abs(m.col - m.fromCol!) === 2) {
      notation = m.col > m.fromCol! ? 'O-O' : 'O-O-O';
    } else {
      notation = `${letter}${from}${captureSymbol}${to}`;
    }

    if (i % 2 === 0) {
      pgn += `${Math.floor(i / 2) + 1}. ${notation} `;
    } else {
      pgn += `${notation} `;
    }

    board[`${m.row},${m.col}`] = piece;
    delete board[fromKey];
  }

  if (result?.winner) {
    pgn += result.winner.color === 'white' ? '1-0' : '0-1';
  } else {
    pgn += '1/2-1/2';
  }

  return pgn.trim();
}
