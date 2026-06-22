import { Room } from '../../../room/Room.js';

export function generateDraughtsPdn(room: Room, result: any): string {
  const squareNumber = (row: number, col: number): number => {
    return Math.floor((row * 10 + col) / 2) + 1;
  };

  let pdn = '';
  const moves = room.moveHistory;

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.fromRow === undefined || m.fromCol === undefined) continue;
    const from = squareNumber(m.fromRow, m.fromCol);
    const to = squareNumber(m.row, m.col);

    const isCapture = Math.abs(m.fromRow - m.row) > 1 || Math.abs(m.fromCol - m.col) > 1;
    const notation = isCapture ? `${from}x${to}` : `${from}-${to}`;

    if (i % 2 === 0) {
      pdn += `${Math.floor(i / 2) + 1}. ${notation} `;
    } else {
      pdn += `${notation} `;
    }
  }

  if (result?.winner) {
    pdn += result.winner.color === 'white' ? '1-0' : '0-1';
  } else {
    pdn += '1/2-1/2';
  }

  return pdn.trim();
}
