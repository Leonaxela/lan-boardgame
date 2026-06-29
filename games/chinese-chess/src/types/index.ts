import { GameConfig } from '@lan-boardgame/shared';

// ══════════════════════════════════════════════
//  颜色
// ══════════════════════════════════════════════

export const CC_COLORS = {
  RED: 'red',
  BLACK: 'black',
} as const;

/** 别名 */
export const CCColors = CC_COLORS;

export type CCColor = (typeof CC_COLORS)[keyof typeof CC_COLORS];

export function ccOpponent(color: CCColor): CCColor {
  return color === CC_COLORS.RED ? CC_COLORS.BLACK : CC_COLORS.RED;
}

// ══════════════════════════════════════════════
//  棋子类型
// ══════════════════════════════════════════════

export const CC_PIECES = {
  KING: 'king',       // 帅/将
  ADVISOR: 'advisor', // 仕/士
  BISHOP: 'bishop',   // 相/象
  KNIGHT: 'knight',   // 馬/马
  ROOK: 'rook',       // 車/车
  CANNON: 'cannon',   // 砲/炮
  PAWN: 'pawn',       // 兵/卒
} as const;

export type CCPieceType = (typeof CC_PIECES)[keyof typeof CC_PIECES];

/** 棋子标识：颜色_类型，如 'red_king', 'black_pawn' */
export type CCPiece = string;

export function pieceColor(piece: CCPiece): CCColor {
  return piece.startsWith('red_') ? CC_COLORS.RED : CC_COLORS.BLACK;
}

export function pieceType(piece: CCPiece): CCPieceType {
  return piece.replace('red_', '').replace('black_', '') as CCPieceType;
}

/** 棋子中文名 */
export function pieceName(piece: CCPiece): string {
  const c = pieceColor(piece);
  const t = pieceType(piece);
  const names: Record<string, Record<string, string>> = {
    king: { red: '帅', black: '将' },
    advisor: { red: '仕', black: '士' },
    bishop: { red: '相', black: '象' },
    knight: { red: '馬', black: '马' },
    rook: { red: '車', black: '车' },
    cannon: { red: '砲', black: '炮' },
    pawn: { red: '兵', black: '卒' },
  };
  return names[t]?.[c] || '?';
}

// ══════════════════════════════════════════════
//  棋子价值（AI 用）
// ══════════════════════════════════════════════

export const PIECE_VALUES: Record<CCPieceType, number> = {
  king: 10000,
  rook: 900,
  cannon: 450,
  knight: 400,
  bishop: 200,
  advisor: 200,
  pawn: 100,
};

// ══════════════════════════════════════════════
//  棋盘常量
// ══════════════════════════════════════════════

export const CC_ROWS = 10;
export const CC_COLS = 9;

// 九宫范围
export const RED_PALACE = { rowMin: 7, rowMax: 9, colMin: 3, colMax: 5 };
export const BLACK_PALACE = { rowMin: 0, rowMax: 2, colMin: 3, colMax: 5 };

// 河界（过河后的行范围）
export const RED_RIVER_ROWS = [0, 1, 2, 3, 4];
export const BLACK_RIVER_ROWS = [5, 6, 7, 8, 9];

// ══════════════════════════════════════════════
//  配置
// ══════════════════════════════════════════════

export interface CCExtraState {
  /** 被吃掉的棋子 */
  captured: CCPiece[];
  /** 当前是否被将军 */
  inCheck: boolean;
}

export function getCCExtra(extra: Record<string, unknown>): CCExtraState {
  return {
    captured: (extra.captured as CCPiece[]) ?? [],
    inCheck: (extra.inCheck as boolean) ?? false,
  };
}

export function createDefaultCCConfig(): GameConfig {
  return {
    gameType: 'chinese-chess' as any,
    rows: CC_ROWS,
    cols: CC_COLS,
    extra: {},
  };
}
