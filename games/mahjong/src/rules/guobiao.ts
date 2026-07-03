import type { Tile, Ruleset, Meld } from '../types';
import { isWin } from './sichuan';

/** 国标麻将规则（136张，8番起胡，81种番型子集） */
export const guobiaoRules: Ruleset = {
  name: '国标麻将',
  tilesPerHand: 13,
  minFan: 8,
  allowSelfDrawOnly: false,

  tileSet(): Tile[] {
    const tiles: Tile[] = [];
    for (const suit of ['wan', 'tiao', 'tong'] as const) {
      for (let v = 1; v <= 9; v++) {
        for (let c = 0; c < 4; c++) tiles.push({ suit, value: v });
      }
    }
    for (let v = 1; v <= 4; v++) {
      for (let c = 0; c < 4; c++) tiles.push({ suit: 'feng' as const, value: v });
    }
    for (let v = 1; v <= 3; v++) {
      for (let c = 0; c < 4; c++) tiles.push({ suit: 'jian' as const, value: v });
    }
    return tiles;
  },

  checkWin(hand: Tile[], melds: Meld[], winTile: Tile): boolean {
    const all = [...hand, winTile];
    return isWin(all);
  },

  calculateFan(hand: Tile[], melds: Meld[], winTile: Tile, isSelfDraw: boolean, wind: string, seat: number): number {
    const all = [...hand, winTile];
    let fan = 0;

    const counts = tileCounts(all);

    // 箭刻（中/发/白的刻子或杠，count >= 3）
    if ((counts['jian_1'] || 0) >= 3) fan += 2;
    if ((counts['jian_2'] || 0) >= 3) fan += 2;
    if ((counts['jian_3'] || 0) >= 3) fan += 2;

    // 圈风刻（场风对应的刻子）
    const windMap: Record<string, number> = { east: 1, south: 2, west: 3, north: 4 };
    const windValue = windMap[wind] || 1;
    if ((counts[`feng_${windValue}`] || 0) >= 3) fan += 2;

    // 门风刻（玩家座位对应的风牌刻子）
    // seat 0=东, 1=南, 2=西, 3=北
    const seatWind = seat + 1;  // 0→1(东), 1→2(南), 2→3(西), 3→4(北)
    if ((counts[`feng_${seatWind}`] || 0) >= 3) fan += 2;

    // 自摸
    if (isSelfDraw) fan += 1;

    // 清一色（仅一种数牌花色，无字牌）
    const suits = new Set(all.map(t => t.suit));
    if (suits.size === 1 && !suits.has('feng') && !suits.has('jian')) fan += 24;

    // 混一色（一种数牌 + 字牌）
    const numSuits = new Set(all.filter(t => t.suit !== 'feng' && t.suit !== 'jian').map(t => t.suit));
    const hasHonor = suits.has('feng') || suits.has('jian');
    if (numSuits.size === 1 && hasHonor) fan += 6;

    // 断幺九（无幺九牌和字牌）
    const allNoYao = all.every(t =>
      (t.suit !== 'feng' && t.suit !== 'jian' && t.value >= 2 && t.value <= 8)
    );
    if (allNoYao) fan += 2;

    // 七对
    if (isQiDui(all)) fan += 24;

    // 对对胡（全刻子，无顺子）
    if (melds.length > 0 && melds.every(m => m.type === 'peng' || m.type === 'gang' || m.type === 'concealed_gang')) {
      // 检查手牌部分也全是刻子+雀头
      const handCounts = Object.values(counts);
      const allTripletsOrPairs = handCounts.every(c => c === 3 || c === 2);
      if (allTripletsOrPairs && handCounts.filter(c => c === 2).length === 1) {
        fan += 2;
      }
    }

    return fan;
  },
};

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
