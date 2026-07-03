import type { Tile, Ruleset, Meld } from '../types';

/** 武汉麻将规则（136张，16张手牌，硬胡/软胡） */
export const wuhanRules: Ruleset = {
  name: '武汉麻将',
  tilesPerHand: 13, // 标准13张（武汉实际是4面子+1雀头=14张胡牌）
  minFan: 0,
  allowSelfDrawOnly: false,

  tileSet(): Tile[] {
    const tiles: Tile[] = [];
    for (const suit of ['wan', 'tiao', 'tong'] as const) {
      for (let v = 1; v <= 9; v++) {
        for (let c = 0; c < 4; c++) tiles.push({ suit, value: v });
      }
    }
    // 风牌东南西北
    for (let v = 1; v <= 4; v++) {
      for (let c = 0; c < 4; c++) tiles.push({ suit: 'feng' as const, value: v });
    }
    // 箭牌中发白
    for (let v = 1; v <= 3; v++) {
      for (let c = 0; c < 4; c++) tiles.push({ suit: 'jian' as const, value: v });
    }
    return tiles;
  },

  checkWin(hand: Tile[], melds: Meld[], winTile: Tile): boolean {
    const all = [...hand, winTile];
    return isWuhanWin(all);
  },

  calculateFan(_hand: Tile[], _melds: Meld[], _winTile: Tile, isSelfDraw: boolean, _wind: string, _seat: number): number {
    return isSelfDraw ? 2 : 1; // 硬胡2番，点炮1番
  },
};

// ── 简化胡牌检测 ──
function sortHand(hand: Tile[]): Tile[] {
  const order: Record<string, number> = { wan: 0, tiao: 1, tong: 2, feng: 3, jian: 4 };
  return [...hand].sort((a, b) => {
    const oa = order[a.suit] ?? 0;
    const ob = order[b.suit] ?? 0;
    if (oa !== ob) return oa - ob;
    return a.value - b.value;
  });
}

function tileCounts(hand: Tile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of hand) {
    const key = `${t.suit}_${t.value}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function isQiDui(hand: Tile[]): boolean {
  if (hand.length !== 14) return false;
  const counts = tileCounts(hand);
  const pairs = Object.values(counts).filter(c => c >= 2).length;
  return pairs === 7;
}

function isWuhanWin(hand: Tile[]): boolean {
  if (hand.length % 3 !== 2) return false;
  if (hand.length === 14 && isQiDui(hand)) return true;

  const sorted = sortHand(hand);
  const counts = tileCounts(sorted);

  for (const key of Object.keys(counts)) {
    if (counts[key] >= 2) {
      const remaining = removeTiles(sorted, key, 2);
      if (canFormMelds(remaining)) return true;
    }
  }
  return false;
}

function removeTiles(hand: Tile[], key: string, count: number): Tile[] {
  const [suit, valueStr] = key.split('_');
  const value = parseInt(valueStr);
  let removed = 0;
  return hand.filter(t => {
    if (t.suit === suit && t.value === value && removed < count) {
      removed++;
      return false;
    }
    return true;
  });
}

function canFormMelds(hand: Tile[]): boolean {
  if (hand.length === 0) return true;
  if (hand.length % 3 !== 0) return false;

  const sorted = sortHand(hand);
  const counts = tileCounts(sorted);
  const firstKey = Object.keys(counts)[0];
  const [suit, valueStr] = firstKey.split('_');
  const value = parseInt(valueStr);

  // 刻子
  if (counts[firstKey] >= 3) {
    if (canFormMelds(removeTiles(sorted, firstKey, 3))) return true;
  }

  // 顺子
  if (suit !== 'feng' && suit !== 'jian' && value <= 7 &&
      counts[`${suit}_${value + 1}`] >= 1 && counts[`${suit}_${value + 2}`] >= 1) {
    let after = removeTiles(sorted, firstKey, 1);
    after = removeTiles(after, `${suit}_${value + 1}`, 1);
    after = removeTiles(after, `${suit}_${value + 2}`, 1);
    if (canFormMelds(after)) return true;
  }

  return false;
}
