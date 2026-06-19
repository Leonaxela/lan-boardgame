import { GameConfig } from '@lan-boardgame/shared';

// ══════════════════════════════════════════════
//  颜色
// ══════════════════════════════════════════════

export const DRAUGHTS_COLORS = {
  WHITE: 'white',
  BLACK: 'black',
} as const;

export type DraughtsColor = (typeof DRAUGHTS_COLORS)[keyof typeof DRAUGHTS_COLORS];

export function draughtsOpponent(color: DraughtsColor): DraughtsColor {
  return color === DRAUGHTS_COLORS.WHITE ? DRAUGHTS_COLORS.BLACK : DRAUGHTS_COLORS.WHITE;
}

// ══════════════════════════════════════════════
//  棋子类型
// ══════════════════════════════════════════════

export const DRAUGHTS_PIECES = {
  MAN: 'man',
  KING: 'king',
} as const;

export type DraughtsPieceType = (typeof DRAUGHTS_PIECES)[keyof typeof DRAUGHTS_PIECES];

/** 棋子标识：颜色_类型，如 'white_man', 'black_king' */
export type DraughtsPiece = string;

export function draughtsPieceColor(piece: DraughtsPiece): DraughtsColor {
  return piece.startsWith('white_') ? DRAUGHTS_COLORS.WHITE : DRAUGHTS_COLORS.BLACK;
}

export function draughtsPieceType(piece: DraughtsPiece): DraughtsPieceType {
  return piece.replace('white_', '').replace('black_', '') as DraughtsPieceType;
}

// ══════════════════════════════════════════════
//  棋盘常量
// ══════════════════════════════════════════════

export const DRAUGHTS_ROWS = 10;
export const DRAUGHTS_COLS = 10;

// 升变行
export const WHITE_PROMO_ROW = 0;
export const BLACK_PROMO_ROW = 9;

// ══════════════════════════════════════════════
//  扩展状态
// ══════════════════════════════════════════════

export interface DraughtsExtraState {
  /** 当前是否存在强制吃子 */
  mustCapture: boolean;
  /** 当前是否被将军（用于检测将死） */
  inCheck: boolean;
}

export function getDraughtsExtra(extra: Record<string, unknown>): DraughtsExtraState {
  return {
    mustCapture: (extra.mustCapture as boolean) ?? false,
    inCheck: (extra.inCheck as boolean) ?? false,
  };
}

export function createDefaultDraughtsConfig(): GameConfig {
  return {
    gameType: 'draughts' as any,
    rows: DRAUGHTS_ROWS,
    cols: DRAUGHTS_COLS,
    extra: {},
  };
}
