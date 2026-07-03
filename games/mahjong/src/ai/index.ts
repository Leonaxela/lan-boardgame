import type { Tile, MahjongState, AvailableAction, Meld } from '../types';
import { getRules } from '../engine';

/**
 * AI 选牌逻辑（贪心）：
 * 1. 检测胡牌 → 胡
 * 2. 检测可以杠 → 杠（80%概率）
 * 3. 检测可以碰 → 碰（50%概率）
 * 4. 检测可以吃 → 吃（40%概率）
 * 5. 评估手牌，选一张打出去后向听数最小的牌
 */
export function selectAIMove(
  state: MahjongState,
  seat: number,
  actions: AvailableAction[] | null,
): { type: 'hu' | 'peng' | 'chi' | 'gang' | 'angang' | 'jiagang' | 'discard'; tileIndex?: number; action?: AvailableAction } {

  // 有胡牌操作 → 立即胡
  const huAction = actions?.find(a => a.type === 'hu' && a.seat === seat);
  if (huAction) return { type: 'hu', action: huAction };

  // 有杠操作 → 80% 概率执行
  const gangAction = actions?.find(a =>
    (a.type === 'gang' || a.type === 'angang' || a.type === 'jiagang') && a.seat === seat);
  if (gangAction && Math.random() > 0.2) {
    return { type: gangAction.type as 'gang' | 'angang' | 'jiagang', action: gangAction };
  }

  // 有碰操作 → 50% 概率执行
  const pengAction = actions?.find(a => a.type === 'peng' && a.seat === seat);
  if (pengAction && Math.random() > 0.5) {
    return { type: 'peng', action: pengAction };
  }

  // 有吃操作 → 40% 概率执行
  const chiAction = actions?.find(a => a.type === 'chi' && a.seat === seat);
  if (chiAction && Math.random() > 0.6) {
    return { type: 'chi', action: chiAction };
  }

  // 选一张牌打出
  const hand = state.hands[seat];
  const tileIndex = selectWorstTile(hand, state.melds[seat], state.variant);
  return { type: 'discard', tileIndex };
}

/** 选最差的一张牌打出 */
function selectWorstTile(hand: Tile[], melds: Meld[], variant: string): number {
  const rules = getRules(variant as any);

  // 如果手牌中有刚摸的牌（最后一张），优先评估
  let worstIdx = 0;
  let worstScore = Infinity;

  for (let i = 0; i < hand.length; i++) {
    const remaining = hand.filter((_, idx) => idx !== i);

    // 检查打出后是否听牌（听牌=好牌，不应打出）
    const isTenpai = checkTenpai(remaining, melds, rules.tilesPerHand);
    let score = evaluateHand(remaining, melds);
    if (isTenpai) score -= 100;  // 听牌的牌不要打

    if (score < worstScore) {
      worstScore = score;
      worstIdx = i;
    }
  }

  return worstIdx;
}

/** 简化听牌检测：检查打出后能否通过摸任意一张牌胡 */
function checkTenpai(hand: Tile[], melds: Meld[], tilesPerHand: number): boolean {
  if (hand.length !== tilesPerHand) return false;  // 只有手牌数正确时才检测

  // 简化：检查所有可能的牌是否能组成胡牌
  const suits: Array<{ suit: Tile['suit']; max: number }> = [
    { suit: 'wan', max: 9 }, { suit: 'tiao', max: 9 }, { suit: 'tong', max: 9 },
  ];

  // 检查四川/武汉/国标是否有字牌
  // 简化处理：检查所有数牌
  for (const { suit, max } of suits) {
    for (let v = 1; v <= max; v++) {
      const testTile: Tile = { suit, value: v };
      const testHand = [...hand, testTile];
      if (isWinSimple(testHand)) return true;
    }
  }

  // 检查字牌（如果有字牌在手中）
  for (let v = 1; v <= 4; v++) {
    if (hand.some(t => t.suit === 'feng' && t.value === v)) {
      if (isWinSimple([...hand, { suit: 'feng', value: v }])) return true;
    }
  }
  for (let v = 1; v <= 3; v++) {
    if (hand.some(t => t.suit === 'jian' && t.value === v)) {
      if (isWinSimple([...hand, { suit: 'jian', value: v }])) return true;
    }
  }

  return false;
}

/** 简化胡牌检测 */
function isWinSimple(hand: Tile[]): boolean {
  if (hand.length % 3 !== 2) return false;
  const counts: Record<string, number> = {};
  for (const t of hand) {
    const key = `${t.suit}_${t.value}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  // 七对
  if (hand.length === 14) {
    const pairs = Object.values(counts).filter(c => c >= 2).length;
    if (pairs === 7) return true;
  }

  // 标准型
  return tryMelds(counts);
}

/** 尝试组成面子 */
function tryMelds(counts: Record<string, number>): boolean {
  // 找一个非零的牌
  const keys = Object.keys(counts).filter(k => counts[k] > 0);
  if (keys.length === 0) return true;

  // 检查是否所有剩余都是3的倍数
  const total = Object.values(counts).reduce((s, c) => s + c, 0);
  if (total === 0) return true;

  const firstKey = keys[0];
  const [suit, valueStr] = firstKey.split('_');
  const value = parseInt(valueStr);

  // 尝试雀头
  if (total % 3 === 2) {
    if (counts[firstKey] >= 2) {
      counts[firstKey] -= 2;
      if (tryMelds(counts)) { counts[firstKey] += 2; return true; }
      counts[firstKey] += 2;
    }
  }

  // 刻子
  if (counts[firstKey] >= 3) {
    counts[firstKey] -= 3;
    if (tryMelds(counts)) { counts[firstKey] += 3; return true; }
    counts[firstKey] += 3;
  }

  // 顺子（仅数牌）
  if (suit !== 'feng' && suit !== 'jian' && value <= 7) {
    const k2 = `${suit}_${value + 1}`;
    const k3 = `${suit}_${value + 2}`;
    if ((counts[k2] || 0) >= 1 && (counts[k3] || 0) >= 1) {
      counts[firstKey]--;
      counts[k2]--;
      counts[k3]--;
      if (tryMelds(counts)) {
        counts[firstKey]++; counts[k2]++; counts[k3]++;
        return true;
      }
      counts[firstKey]++; counts[k2]++; counts[k3]++;
    }
  }

  return false;
}

/** 评估手牌好坏（越低越好：孤立牌越多分越高） */
function evaluateHand(hand: Tile[], _melds: Meld[]): number {
  if (hand.length === 0) return 0;
  const groups = groupBySuit(hand);
  let score = 0;

  for (const [suit, tiles] of Object.entries(groups)) {
    const sorted = tiles.sort((a, b) => a.value - b.value);

    // 统计连续序列的"断裂"程度
    let gaps = 0;
    for (let i = 1; i < sorted.length; i++) {
      const diff = sorted[i].value - sorted[i - 1].value;
      if (diff === 1) continue;  // 连续
      if (diff === 2) gaps += 1;  // 嵌张
      else gaps += 3;  // 孤立
    }

    // 字牌：每张+3（难以组顺子）
    const extra = (suit === 'feng' || suit === 'jian') ? tiles.length * 3 : 0;
    score += gaps + extra;
  }

  return score;
}

function groupBySuit(hand: Tile[]): Record<string, Tile[]> {
  const groups: Record<string, Tile[]> = {};
  for (const t of hand) {
    if (!groups[t.suit]) groups[t.suit] = [];
    groups[t.suit].push(t);
  }
  return groups;
}
