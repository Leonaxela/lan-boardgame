import type { Tile, Ruleset, Meld } from '../types';
import { SUIT_NAMES, FENG_NAMES, JIAN_NAMES } from '../types';

/** 四川麻将规则（108张，血战到底，不点炮） */
export const sichuanRules: Ruleset = {
  name: '四川麻将',
  tilesPerHand: 13,
  minFan: 0,
  allowSelfDrawOnly: true,

  tileSet(): Tile[] {
    const tiles: Tile[] = [];
    for (const suit of ['wan', 'tiao', 'tong'] as const) {
      for (let v = 1; v <= 9; v++) {
        for (let c = 0; c < 4; c++) tiles.push({ suit, value: v });
      }
    }
    return tiles;
  },

  checkWin(hand: Tile[], melds: Meld[], winTile: Tile): boolean {
    const all = [...hand, winTile];
    return isWin(all);
  },

  calculateFan(hand: Tile[], melds: Meld[], winTile: Tile, isSelfDraw: boolean, _wind: string, _seat: number): number {
    const all = [...hand, winTile];
    let fan = 1; // 平胡1番

    // 七对
    if (isQiDui(all)) return 4;

    // 清一色
    if (all.every(t => t.suit === all[0].suit)) fan = 6;

    // 对对胡
    if (melds.every(m => m.type === 'peng' || m.type === 'gang' || m.type === 'concealed_gang') && countPairs(all) === 1) {
      fan = Math.max(fan, 4);
    }

    return fan;
  },
};

// ── 工具函数 ──

/** 手牌排序 */
function sortHand(hand: Tile[]): Tile[] {
  const order: Record<string, number> = { wan: 0, tiao: 1, tong: 2, feng: 3, jian: 4 };
  return [...hand].sort((a, b) => {
    const oa = order[a.suit] ?? 0;
    const ob = order[b.suit] ?? 0;
    if (oa !== ob) return oa - ob;
    return a.value - b.value;
  });
}

/** 统计各牌出现次数 */
function tileCounts(hand: Tile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of hand) {
    const key = `${t.suit}_${t.value}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** 是否为七对 */
function isQiDui(hand: Tile[]): boolean {
  if (hand.length !== 14) return false;
  const counts = tileCounts(hand);
  const pairs = Object.values(counts).filter(c => c >= 2).length;
  const fours = Object.values(counts).filter(c => c >= 4).length;
  return pairs === 7 || (pairs + fours >= 7);
}

/** 统计对子数 */
function countPairs(hand: Tile[]): number {
  const counts = tileCounts(hand);
  return Object.values(counts).filter(c => c >= 2).length;
}

/** 检测是否能胡牌（标准型：4个面子+1个雀头） */
export function isWin(hand: Tile[]): boolean {
  if (hand.length % 3 !== 2) return false;

  // 七对检测
  if (hand.length === 14 && isQiDui(hand)) return true;

  // 标准型检测
  const sorted = sortHand(hand);
  const counts = tileCounts(sorted);

  // 找雀头（对子）
  for (const key of Object.keys(counts)) {
    if (counts[key] >= 2) {
      const remaining = removeTiles(sorted, key, 2);
      if (canFormMelds(remaining)) return true;
    }
  }

  return false;
}

/** 移除指定牌型 */
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

/** 检查能否组成面子序列 */
function canFormMelds(hand: Tile[]): boolean {
  if (hand.length === 0) return true;
  if (hand.length % 3 !== 0) return false;

  const sorted = sortHand(hand);
  const counts = tileCounts(sorted);
  const keys = Object.keys(counts);

  // 取第一张牌
  const firstKey = keys[0];
  const [suit, valueStr] = firstKey.split('_');
  const value = parseInt(valueStr);

  // 刻子检测（三张相同）
  if (counts[firstKey] >= 3) {
    const after = removeTiles(sorted, firstKey, 3);
    if (canFormMelds(after)) return true;
  }

  // 顺子检测（仅限万条筒）
  if (suit !== 'feng' && suit !== 'jian' && value <= 7 &&
      counts[`${suit}_${value + 1}`] >= 1 && counts[`${suit}_${value + 2}`] >= 1) {
    let after = removeTiles(sorted, firstKey, 1);
    after = removeTiles(after, `${suit}_${value + 1}`, 1);
    after = removeTiles(after, `${suit}_${value + 2}`, 1);
    if (canFormMelds(after)) return true;
  }

  return false;
}
