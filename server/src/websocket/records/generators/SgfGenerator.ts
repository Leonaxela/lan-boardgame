import { Room } from '../../../room/Room.js';

export function generateSgf(room: Room, result: any): string {
  const size = room.config.rows || 19;
  const ruleSet = (room.config.extra?.ruleSet as string) || 'chinese';
  const komi = ruleSet === 'japanese' ? '6.5' : '7.5';

  let sgf = `(;GM[1]FF[4]CA[UTF-8]SZ[${size}]KM[${komi}]RU[${ruleSet}]`;

  const isKatago = !!room.katagoGame;
  const players = isKatago
    ? room.players
    : room.players.filter(p => !p.id.startsWith('ai-'));
  for (const p of players) {
    const letter = p.color === 'black' ? 'B' : 'W';
    sgf += `${letter}N[${p.username}]`;
  }

  const letters = 'abcdefghijklmnopqrs';
  for (const move of room.moveHistory) {
    const colLetter = letters[move.col] || 'a';
    const rowLetter = letters[move.row] || 'a';
    const color = move.color === 'black' ? 'B' : 'W';
    sgf += `;${color}[${colLetter}${rowLetter}]`;
  }

  if (result) {
    let resultStr = '';
    if (result.reason === 'resign') {
      resultStr = result.winner?.color === 'black' ? 'B+R' : 'W+R';
    } else if (result.reason === 'score') {
      const komi = 3.75;
      const blackMargin = (result.scores?.black || 0) - (size * size / 2 + komi);
      const whiteMargin = (result.scores?.white || 0) - (size * size / 2 - komi);
      if (result.winner?.color === 'black') {
        resultStr = `B+${blackMargin.toFixed(1)}`;
      } else if (result.winner?.color === 'white') {
        resultStr = `W+${whiteMargin.toFixed(1)}`;
      } else {
        resultStr = 'Void';
      }
    } else if (result.reason === 'disconnect') {
      resultStr = result.winner?.color === 'black' ? 'B+T' : 'W+T';
    } else {
      resultStr = 'Void';
    }
    sgf += `RE[${resultStr}]`;
  }

  sgf += ')';
  return sgf;
}
