/**
 * 统一的终局文案生成
 */

interface GameResultInfo {
  winner?: { name?: string; color?: string } | null;
  /** 投降/断线/违规的人（输家），用于显示投降者名字 */
  loser?: { name?: string; color?: string } | null;
  reason?: string;
  scores?: Record<string, number>;
  gameType?: string;
  /** 棋盘大小（围棋数子用），默认19 */
  boardSize?: number;
  /** 隐藏玩家名字，只显示棋色（用于后台管理等已有名字列的场景） */
  hideName?: boolean;
}

const COLOR_LABEL: Record<string, Record<string, string>> = {
  go:       { black: '黑棋', white: '白棋' },
  gomoku:   { black: '黑棋', white: '白棋' },
  'chinese-chess': { red: '红方', black: '黑方' },
  chess:    { white: '白方', black: '黑方' },
  draughts: { white: '白方', black: '黑方' },
};

function colorLabel(gameType: string, color: string): string {
  return COLOR_LABEL[gameType]?.[color] || color;
}

function loserColor(gameType: string, winnerColor: string): string {
  const colors = Object.keys(COLOR_LABEL[gameType] || {});
  return colors.find(c => c !== winnerColor) || winnerColor;
}

/**
 * 生成终局文案
 * - 认输: "xx投降，x棋胜"
 * - 围棋数子: "数子，黑棋胜4又1/4子"
 * - 五子连珠: "xx五子连珠，x棋胜"
 * - 将死/将杀: "x棋被将死，x棋胜" / "x棋被将杀，x棋胜"
 * - 吃光: "x棋被吃光，x棋胜"
 * - 无子可走: "x棋无子可走，x棋胜"
 * - 平局: "平局"
 * - 断线: "xx断线，x棋胜"
 */
export function getGameResultText(result: GameResultInfo): string {
  const { winner, loser, reason, scores, gameType, boardSize, hideName } = result;

  // 平局
  if (!winner || reason === 'draw') {
    return '平局';
  }

  const wColor = winner.color || '';
  const lColor = loserColor(gameType || '', wColor);
  const wLabel = colorLabel(gameType || '', wColor);
  const lLabel = colorLabel(gameType || '', lColor);
  // 输家名字（投降/断线/违规的人）
  const lName = hideName ? '' : (loser?.name ? loser.name + ' ' : '');
  // 赢家名字（五子连珠等场景）
  const wName = hideName ? '' : (winner.name ? winner.name + ' ' : '');

  switch (reason) {
    case 'resign':
      return hideName ? `${lLabel}投降，${wLabel}胜` : `${lName}投降，${wLabel}胜`;

    case 'score': {
      if (gameType === 'go' || gameType === 'gomoku') {
        // 围棋数子：中国规则第11条
        // 胜子数 = 一方总得点 - (归本数 + 贴目)
        if (gameType === 'go' && scores) {
          const bScore = scores['black'] ?? 0;
          const wScore = scores['white'] ?? 0;
          const size = boardSize || 19;
          const baseNumber = (size * size) / 2; // 归本数：棋盘总点数的一半
          const komi = 3.75; // 贴 3¾ 子
          const blackMargin = bScore - (baseNumber + komi);
          const whiteMargin = wScore - (baseNumber - komi);
          const isBlackWin = blackMargin > 0;
          const diff = isBlackWin ? blackMargin : whiteMargin;
          const intPart = Math.floor(diff);
          const frac = diff - intPart;
          let fracStr = '';
          if (Math.abs(frac - 0.5) < 0.01) fracStr = '又1/2';
          else if (Math.abs(frac - 0.25) < 0.01) fracStr = '又1/4';
          else if (Math.abs(frac - 0.75) < 0.01) fracStr = '又3/4';
          else if (frac > 0.01) fracStr = `又${frac}`;
          return `数子，${wLabel}胜${intPart}${fracStr}子`;
        }
        // 五子棋五连珠
        if (gameType === 'gomoku') {
          return hideName ? `${wLabel}五子连珠，${wLabel}胜` : `${wName}五子连珠，${wLabel}胜`;
        }
        return `${wLabel}胜`;
      }
      // 中国象棋/国际象棋/国际跳棋：将死/将杀/吃光/无子可走
      if (gameType === 'chinese-chess') {
        return `${lLabel}被将死，${wLabel}胜`;
      }
      if (gameType === 'chess') {
        return `${lLabel}被将杀，${wLabel}胜`;
      }
      if (gameType === 'draughts') {
        return `${lLabel}被吃光，${wLabel}胜`;
      }
      return `${wLabel}胜`;
    }

    case 'disconnect':
      return hideName ? `${lLabel}断线，${wLabel}胜` : `${lName}断线，${wLabel}胜`;

    case 'violation':
      return hideName ? `${lLabel}违规，${wLabel}胜` : `${lName}违规，${wLabel}胜`;

    default:
      return `${wLabel}胜`;
  }
}
