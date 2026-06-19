import { GameConfig } from '@lan-boardgame/shared';

// ══════════════════════════════════════════════
//  颜色
// ══════════════════════════════════════════════

export const INTL_COLORS = {
  WHITE: 'white',
  BLACK: 'black',
} as const;

export type IntlColor = (typeof INTL_COLORS)[keyof typeof INTL_COLORS];

export function intlOpponent(color: IntlColor): IntlColor {
  return color === INTL_COLORS.WHITE ? INTL_COLORS.BLACK : INTL_COLORS.WHITE;
}

// ══════════════════════════════════════════════
//  棋子类型
// ══════════════════════════════════════════════

export const INTL_PIECES = {
  KING: 'king',
  QUEEN: 'queen',
  ROOK: 'rook',
  BISHOP: 'bishop',
  KNIGHT: 'knight',
  PAWN: 'pawn',
} as const;

export type IntlPieceType = (typeof INTL_PIECES)[keyof typeof INTL_PIECES];

/** 棋子标识：颜色_类型，如 'white_king', 'black_pawn' */
export type IntlPiece = string;

export function intlPieceColor(piece: IntlPiece): IntlColor {
  return piece.startsWith('white_') ? INTL_COLORS.WHITE : INTL_COLORS.BLACK;
}

export function intlPieceType(piece: IntlPiece): IntlPieceType {
  return piece.replace('white_', '').replace('black_', '') as IntlPieceType;
}

/** 棋子 Unicode 符号 */
export const PIECE_SYMBOLS: Record<string, Record<string, string>> = {
  king:   { white: '♔', black: '♚' },
  queen:  { white: '♕', black: '♛' },
  rook:   { white: '♖', black: '♜' },
  bishop: { white: '♗', black: '♝' },
  knight: { white: '♘', black: '♞' },
  pawn:   { white: '♙', black: '♟' },
};

// ══════════════════════════════════════════════
//  棋子价值（AI 用）
// ══════════════════════════════════════════════

export const INTL_PIECE_VALUES: Record<IntlPieceType, number> = {
  king: 10000,
  queen: 900,
  rook: 500,
  bishop: 330,
  knight: 320,
  pawn: 100,
};

// ══════════════════════════════════════════════
//  棋盘常量
// ══════════════════════════════════════════════

export const INTL_ROWS = 8;
export const INTL_COLS = 8;

// ══════════════════════════════════════════════
//  王车易位状态
// ══════════════════════════════════════════════

export interface CastlingRights {
  whiteKingSide: boolean;
  whiteQueenSide: boolean;
  blackKingSide: boolean;
  blackQueenSide: boolean;
}

// ══════════════════════════════════════════════
//  扩展状态
// ══════════════════════════════════════════════

export interface IntlExtraState {
  castling: CastlingRights;
  enPassantTarget: { row: number; col: number } | null;
  inCheck: boolean;
  halfMoveClock: number;
}

export function getIntlExtra(extra: Record<string, unknown>): IntlExtraState {
  return {
    castling: (extra.castling as CastlingRights) ?? {
      whiteKingSide: true, whiteQueenSide: true,
      blackKingSide: true, blackQueenSide: true,
    },
    enPassantTarget: (extra.enPassantTarget as { row: number; col: number } | null) ?? null,
    inCheck: (extra.inCheck as boolean) ?? false,
    halfMoveClock: (extra.halfMoveClock as number) ?? 0,
  };
}

export function createDefaultIntlConfig(): GameConfig {
  return {
    gameType: 'chess' as any,
    rows: INTL_ROWS,
    cols: INTL_COLS,
    extra: {},
  };
}
