import { Room } from '../../../room/Room.js';

function getPieceAtInitialBoard(room: Room, move: any): string | null {
  const INIT_BOARD: Record<string, string> = {};
  const RED_BACK = ['rook','knight','bishop','advisor','king','advisor','bishop','knight','rook'];
  const RED_PAWN = [0,2,4,6,8];
  for (let c = 0; c < 9; c++) { INIT_BOARD[`9,${c}`] = `red_${RED_BACK[c]}`; }
  for (const c of RED_PAWN) { INIT_BOARD[`6,${c}`] = 'red_pawn'; }
  INIT_BOARD['7,1'] = 'red_cannon'; INIT_BOARD['7,7'] = 'red_cannon';
  const BLACK_BACK = ['rook','knight','bishop','advisor','king','advisor','bishop','knight','rook'];
  for (let c = 0; c < 9; c++) { INIT_BOARD[`0,${c}`] = `black_${BLACK_BACK[c]}`; }
  for (const c of RED_PAWN) { INIT_BOARD[`3,${c}`] = 'black_pawn'; }
  INIT_BOARD['2,1'] = 'black_cannon'; INIT_BOARD['2,7'] = 'black_cannon';

  const fromKey = `${move.fromRow},${move.fromCol}`;
  return INIT_BOARD[fromKey] || null;
}

export function generateChineseChessPgn(room: Room, result: any): string {
  const PIECE_NAMES: Record<string, Record<string, string>> = {
    king: { red: '帅', black: '将' },
    advisor: { red: '仕', black: '士' },
    bishop: { red: '相', black: '象' },
    knight: { red: '馬', black: '马' },
    rook: { red: '車', black: '车' },
    cannon: { red: '砲', black: '炮' },
    pawn: { red: '兵', black: '卒' },
  };
  const COL_LETTERS = 'abcdefghi';

  let pgn = '';
  const moves = room.moveHistory;

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.fromRow === undefined || m.fromCol === undefined) continue;

    const fromPiece = getPieceAtInitialBoard(room, m);
    const pieceType = fromPiece?.replace('red_', '').replace('black_', '') || '';
    const name = PIECE_NAMES[pieceType]?.[m.color] || '棋';

    const fromCol = COL_LETTERS[m.fromCol] || '?';
    const fromRow = 10 - m.fromRow;
    const toCol = COL_LETTERS[m.col] || '?';
    const toRow = 10 - m.row;

    const dir = m.fromRow > m.row ? '进' : m.fromRow < m.row ? '退' : '平';
    const numFrom = ['一','二','三','四','五','六','七','八','九'][m.fromCol] || '?';
    const numTo = ['一','二','三','四','五','六','七','八','九'][m.col] || '?';

    let moveStr: string;
    if (m.fromCol === m.col) {
      moveStr = `${name}${numFrom}${dir}${Math.abs(fromRow - toRow)}`;
    } else {
      moveStr = `${name}${numFrom}${dir}${numTo}`;
    }

    if (i % 2 === 0) {
      pgn += `${Math.floor(i / 2) + 1}. ${moveStr} `;
    } else {
      pgn += `${moveStr} `;
    }
  }

  if (result?.winner) {
    pgn += result.winner.color === 'red' ? '1-0' : '0-1';
  } else {
    pgn += '1/2-1/2';
  }

  return pgn.trim();
}
