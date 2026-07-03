import type {
  Tile, MahjongState, MahjongPhase, RuleVariant, Ruleset, Meld,
  AvailableAction, Wind,
} from './types';
import { sichuanRules } from './rules/sichuan';
import { wuhanRules } from './rules/wuhan';
import { guobiaoRules } from './rules/guobiao';

const RULES_MAP: Record<RuleVariant, Ruleset> = {
  sichuan: sichuanRules,
  wuhan: wuhanRules,
  guobiao: guobiaoRules,
};

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 手牌排序 */
export function sortHand(hand: Tile[]): Tile[] {
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

/** 牌键 */
function tileKey(t: Tile): string {
  return `${t.suit}_${t.value}`;
}

/** 判断两张牌是否相同 */
function sameTile(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.value === b.value;
}

/** 操作优先级排序：胡 > 杠 > 碰 > 吃 */
const ACTION_PRIORITY: Record<string, number> = {
  hu: 0, gang: 1, angang: 1, jiagang: 1, peng: 2, chi: 3,
};

/** 创建初始状态 */
export function createInitialState(variant: RuleVariant): MahjongState {
  const rules = getRules(variant);
  const wall = shuffle(rules.tileSet());
  const hands: Tile[][] = [[], [], [], []];

  // 发牌
  let idx = 0;
  for (let seat = 0; seat < 4; seat++) {
    hands[seat] = wall.slice(idx, idx + rules.tilesPerHand);
    idx += rules.tilesPerHand;
  }
  // 庄家多摸一张
  const dealerDraw = wall[idx];
  hands[0].push(dealerDraw);
  idx++;

  return {
    phase: 'playing',
    variant,
    wall: wall.slice(idx),
    hands,
    handSizes: hands.map(h => h.length),
    discards: [[], [], [], []],
    melds: [[], [], [], []],
    currentPlayer: 0,
    lastDiscard: null,
    lastDiscardPlayer: -1,
    drawnTile: dealerDraw,  // 庄家开局摸的牌
    dealer: 0,
    wind: 'east',
    round: 1,
    wallEnd: false,
    result: null,
    winners: [],
  };
}

/** 获取规则集 */
export function getRules(variant: RuleVariant): Ruleset {
  return RULES_MAP[variant];
}

/** 从牌墙摸一张牌 */
export function drawTile(state: MahjongState): { state: MahjongState; drawn?: Tile; error?: string } {
  if (state.phase !== 'playing') return { state, error: '游戏已结束' };
  if (state.wall.length === 0) {
    return { state: { ...state, wallEnd: true, phase: 'finished' }, error: '流局' };
  }
  const drawn = state.wall[0];
  const newWall = state.wall.slice(1);
  const newHands = state.hands.map(h => [...h]);
  newHands[state.currentPlayer].push(drawn);
  return {
    state: {
      ...state,
      wall: newWall,
      hands: newHands,
      handSizes: newHands.map(h => h.length),
      drawnTile: drawn,
    },
    drawn,
  };
}

/** 出牌 */
export function discardTile(
  state: MahjongState, player: number, tileIdx: number,
): { state: MahjongState; tile: Tile } | null {
  if (state.phase !== 'playing') return null;
  if (state.currentPlayer !== player) return null;

  const hand = state.hands[player];
  if (tileIdx < 0 || tileIdx >= hand.length) return null;

  const tile = hand[tileIdx];
  const newHands = state.hands.map(h => [...h]);
  newHands[player].splice(tileIdx, 1);

  const newDiscards = state.discards.map(d => [...d]);
  newDiscards[player].push(tile);

  return {
    state: {
      ...state,
      hands: newHands,
      handSizes: newHands.map(h => h.length),
      discards: newDiscards,
      lastDiscard: tile,
      lastDiscardPlayer: player,
      drawnTile: null,  // 出牌后清除摸牌标记
    },
    tile,
  };
}

/**
 * 检测其他玩家对 lastDiscard 的可用操作（吃碰杠胡）
 * 返回按优先级排序的操作列表（胡>杠>碰>吃）
 */
export function checkActions(state: MahjongState): AvailableAction[] | null {
  if (!state.lastDiscard || state.lastDiscardPlayer < 0) return null;
  const rules = getRules(state.variant);
  const actions: AvailableAction[] = [];
  const tile = state.lastDiscard;
  const from = state.lastDiscardPlayer;

  for (let seat = 0; seat < 4; seat++) {
    if (seat === from) continue;
    if (state.winners.includes(seat)) continue;  // 已胡玩家不参与

    const hand = state.hands[seat];
    const counts = tileCounts(hand);
    const key = tileKey(tile);
    const cnt = counts[key] || 0;

    // 胡牌检测（含 minFan 起胡门槛）
    if (rules.checkWin(hand, state.melds[seat], tile)) {
      const testHand = [...hand, tile];
      const fan = rules.calculateFan(testHand, state.melds[seat], tile, false, state.wind, seat);
      if (fan >= rules.minFan) {
        actions.push({ type: 'hu', tiles: [tile], seat });
      }
    }

    // 杠检测（明杠：手牌有3张+lastDiscard）
    if (cnt >= 3) {
      actions.push({ type: 'gang', tiles: [tile], seat });
    }

    // 碰检测（手牌有2张+lastDiscard）
    if (cnt >= 2) {
      actions.push({ type: 'peng', tiles: [tile], seat });
    }

    // 吃检测（仅上家出的牌可以吃）
    // 上家 = (from + 3) % 4，即 from 的上家
    // 但实际上，seat 能吃 from 的牌当且仅当 (seat + 1) % 4 === from
    // 即 from 是 seat 的下家 → seat 是 from 的上家
    if ((seat + 1) % 4 === from && tile.suit !== 'feng' && tile.suit !== 'jian') {
      const combos = getChiCombos(hand, tile);
      if (combos.length > 0) {
        actions.push({ type: 'chi', tiles: [tile], seat, chiCombos: combos });
      }
    }
  }

  if (actions.length === 0) return null;

  // 按优先级排序：胡 > 杠 > 碰 > 吃
  actions.sort((a, b) => (ACTION_PRIORITY[a.type] ?? 9) - (ACTION_PRIORITY[b.type] ?? 9));
  return actions;
}

/**
 * 检测当前玩家摸牌后的自摸胡和暗杠/加杠
 */
export function checkSelfDrawActions(state: MahjongState): AvailableAction[] | null {
  if (!state.drawnTile || state.phase !== 'playing') return null;
  const rules = getRules(state.variant);
  const seat = state.currentPlayer;
  if (state.winners.includes(seat)) return null;

  const hand = state.hands[seat];  // 手牌已包含 drawnTile（摸牌时已push）
  const melds = state.melds[seat];
  const drawn = state.drawnTile;
  const actions: AvailableAction[] = [];

  // 自摸胡检测：hand 已含 drawnTile，需移除后再传入 checkWin
  const handWithoutDrawn = [...hand];
  const drawIdx = handWithoutDrawn.findIndex(t => sameTile(t, drawn));
  if (drawIdx >= 0) handWithoutDrawn.splice(drawIdx, 1);
  if (rules.checkWin(handWithoutDrawn, melds, drawn)) {
    const fan = rules.calculateFan(hand, melds, drawn, true, state.wind, seat);
    if (fan >= rules.minFan) {
      actions.push({ type: 'hu', tiles: [drawn], seat });
    }
  }

  // 暗杠检测（手牌中有4张相同）
  const counts = tileCounts(hand);
  for (const [key, cnt] of Object.entries(counts)) {
    if (cnt >= 4) {
      const [suit, valueStr] = key.split('_');
      const gangTile: Tile = { suit: suit as Tile['suit'], value: parseInt(valueStr) };
      actions.push({ type: 'angang', tiles: [gangTile], seat });
    }
  }

  // 加杠检测（已碰的牌，手牌中又有第4张）
  for (const meld of melds) {
    if (meld.type === 'peng' && meld.tiles.length >= 3) {
      const pengTile = meld.tiles[0];
      if (hand.some(t => sameTile(t, pengTile))) {
        actions.push({ type: 'jiagang', tiles: [pengTile], seat });
      }
    }
  }

  if (actions.length === 0) return null;
  actions.sort((a, b) => (ACTION_PRIORITY[a.type] ?? 9) - (ACTION_PRIORITY[b.type] ?? 9));
  return actions;
}

/** 获取吃牌的所有可能组合 */
function getChiCombos(hand: Tile[], tile: Tile): Tile[][] {
  const combos: Tile[][] = [];
  const v = tile.value;
  const suit = tile.suit;

  // 三种吃法：[v-2,v-1], [v-1,v+1], [v+1,v+2]
  for (const [a, b] of [[v - 2, v - 1], [v - 1, v + 1], [v + 1, v + 2]]) {
    if (a >= 1 && b <= 9) {
      const tileA = hand.find(t => t.suit === suit && t.value === a);
      const tileB = hand.find(t => t.suit === suit && t.value === b && t !== tileA);
      if (tileA && tileB) {
        combos.push([tileA, tileB]);
      }
    }
  }
  return combos;
}

/**
 * 执行操作（吃碰杠胡）
 * 返回 { state, needsDiscard, error }
 * needsDiscard: 执行后该玩家是否需要出牌（碰/吃/杠补牌后需要出牌，胡不需要）
 */
export function applyAction(
  state: MahjongState, seat: number, action: AvailableAction,
): { state: MahjongState; needsDiscard: boolean } {
  const newState = structuredClone(state);
  const hand = newState.hands[seat];
  const tile = action.tiles[0];
  const rules = getRules(newState.variant);

  newState.lastDiscard = null;
  newState.lastDiscardPlayer = -1;

  if (action.type === 'peng') {
    // 碰：从手牌移除2张相同牌
    let removed = 0;
    newState.hands[seat] = hand.filter(t => {
      if (sameTile(t, tile) && removed < 2) { removed++; return false; }
      return true;
    });
    newState.melds[seat].push({ type: 'peng', tiles: [tile, tile, tile] });
    newState.currentPlayer = seat;
    newState.drawnTile = null;
    newState.handSizes = newState.hands.map(h => h.length);
    return { state: newState, needsDiscard: true };

  } else if (action.type === 'chi') {
    // 吃：从手牌移除配牌
    const combo = action.chiCombos?.[0] || getChiCombos(hand, tile)[0];
    if (combo) {
      for (const ft of combo) {
        const idx = newState.hands[seat].findIndex(t => sameTile(t, ft));
        if (idx >= 0) newState.hands[seat].splice(idx, 1);
      }
      newState.melds[seat].push({ type: 'chi', tiles: [...combo, tile] });
    }
    newState.currentPlayer = seat;
    newState.drawnTile = null;
    newState.handSizes = newState.hands.map(h => h.length);
    return { state: newState, needsDiscard: true };

  } else if (action.type === 'gang') {
    // 明杠：从手牌移除3张+lastDiscard组成杠
    let removed = 0;
    newState.hands[seat] = hand.filter(t => {
      if (sameTile(t, tile) && removed < 3) { removed++; return false; }
      return true;
    });
    newState.melds[seat].push({ type: 'gang', tiles: [tile, tile, tile, tile] });
    newState.currentPlayer = seat;
    newState.lastDiscard = null;
    newState.lastDiscardPlayer = -1;
    // 杠后补摸一张
    if (newState.wall.length > 0) {
      const supplement = newState.wall[0];
      newState.wall = newState.wall.slice(1);
      newState.hands[seat].push(supplement);
      newState.drawnTile = supplement;
    } else {
      newState.wallEnd = true;
      newState.drawnTile = null;
    }
    newState.handSizes = newState.hands.map(h => h.length);
    return { state: newState, needsDiscard: true };

  } else if (action.type === 'angang') {
    // 暗杠：从手牌移除4张
    let removed = 0;
    newState.hands[seat] = hand.filter(t => {
      if (sameTile(t, tile) && removed < 4) { removed++; return false; }
      return true;
    });
    newState.melds[seat].push({ type: 'concealed_gang', tiles: [tile, tile, tile, tile] });
    newState.currentPlayer = seat;
    // 杠后补摸一张
    if (newState.wall.length > 0) {
      const supplement = newState.wall[0];
      newState.wall = newState.wall.slice(1);
      newState.hands[seat].push(supplement);
      newState.drawnTile = supplement;
    } else {
      newState.wallEnd = true;
      newState.drawnTile = null;
    }
    newState.handSizes = newState.hands.map(h => h.length);
    return { state: newState, needsDiscard: true };

  } else if (action.type === 'jiagang') {
    // 加杠：将碰升级为杠，从手牌移除1张
    const meldIdx = newState.melds[seat].findIndex(m =>
      m.type === 'peng' && m.tiles.length >= 3 && sameTile(m.tiles[0], tile));
    if (meldIdx >= 0) {
      newState.melds[seat][meldIdx] = { type: 'gang', tiles: [tile, tile, tile, tile] };
      const handIdx = newState.hands[seat].findIndex(t => sameTile(t, tile));
      if (handIdx >= 0) newState.hands[seat].splice(handIdx, 1);
    }
    newState.currentPlayer = seat;
    // 杠后补摸一张
    if (newState.wall.length > 0) {
      const supplement = newState.wall[0];
      newState.wall = newState.wall.slice(1);
      newState.hands[seat].push(supplement);
      newState.drawnTile = supplement;
    } else {
      newState.wallEnd = true;
      newState.drawnTile = null;
    }
    newState.handSizes = newState.hands.map(h => h.length);
    return { state: newState, needsDiscard: true };

  } else if (action.type === 'hu') {
    // 胡牌
    const isSelf = seat === newState.currentPlayer;
    const winTile = isSelf ? newState.drawnTile! : tile;

    if (!isSelf) {
      // 点炮胡：把 lastDiscard 加入手牌
      newState.hands[seat].push(tile);
    }

    const fan = rules.calculateFan(newState.hands[seat], newState.melds[seat], winTile, isSelf, newState.wind, seat);

    newState.winners.push(seat);
    newState.result = {
      winner: seat,
      fan,
      reason: isSelf ? '自摸' : '点炮',
      hand: [...newState.hands[seat]],
      melds: [...newState.melds[seat]],
      winTile,
      loser: isSelf ? undefined : newState.currentPlayer,
    };

    if (!rules.allowSelfDrawOnly || newState.winners.length >= 3) {
      newState.phase = 'finished';
    } else {
      // 血战到底：胡了继续，轮到下家
      newState.currentPlayer = (seat + 1) % 4;
      newState.lastDiscard = null;
      newState.lastDiscardPlayer = -1;
      newState.drawnTile = null;
    }

    newState.handSizes = newState.hands.map(h => h.length);
    return { state: newState, needsDiscard: false };
  }

  return { state: newState, needsDiscard: false };
}

/**
 * 轮转到下家并摸牌
 * 用于：所有人都"过"后，下家摸牌
 */
export function advanceTurn(state: MahjongState): { state: MahjongState; error?: string } {
  if (state.phase !== 'playing') return { state, error: '游戏已结束' };

  const next = (state.currentPlayer + 1) % 4;
  // 跳过已胡的玩家
  let nextSeat = next;
  let tries = 0;
  while (state.winners.includes(nextSeat) && tries < 4) {
    nextSeat = (nextSeat + 1) % 4;
    tries++;
  }

  // 检查流局
  if (state.wall.length === 0) {
    return {
      state: { ...state, wallEnd: true, phase: 'finished', currentPlayer: nextSeat },
      error: '流局',
    };
  }

  // 摸牌
  const drawn = state.wall[0];
  const newWall = state.wall.slice(1);
  const newHands = state.hands.map(h => [...h]);
  newHands[nextSeat].push(drawn);

  return {
    state: {
      ...state,
      currentPlayer: nextSeat,
      wall: newWall,
      hands: newHands,
      handSizes: newHands.map(h => h.length),
      lastDiscard: null,
      lastDiscardPlayer: -1,
      drawnTile: drawn,
    },
  };
}

/** 检查是否流局 */
export function checkStalemate(state: MahjongState): MahjongState {
  if (state.winners.length === 0 && (state.wallEnd || state.wall.length === 0)) {
    return { ...state, phase: 'finished', wallEnd: true };
  }
  // 血战到底：只剩一人未胡
  const rules = getRules(state.variant);
  if (rules.allowSelfDrawOnly && state.winners.length >= 3 && state.phase === 'playing') {
    return { ...state, phase: 'finished' };
  }
  return state;
}

/** 为客户端生成可见状态（隐藏其他玩家手牌） */
export function renderForPlayer(state: MahjongState, seat: number, availableActions?: AvailableAction[]) {
  return {
    phase: state.phase,
    variant: state.variant,
    myHand: sortHand(state.hands[seat]),
    handSizes: state.hands.map(h => h.length),
    discards: state.discards,
    melds: state.melds,
    currentPlayer: state.currentPlayer,
    lastDiscard: state.lastDiscard,
    lastDiscardPlayer: state.lastDiscardPlayer,
    drawnTile: seat === state.currentPlayer ? state.drawnTile : null,
    dealer: state.dealer,
    wind: state.wind,
    round: state.round,
    wallEnd: state.wallEnd,
    wallCount: state.wall.length,
    result: state.result,
    winners: state.winners,
    availableActions: availableActions || [],
    seat,
  };
}
