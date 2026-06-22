/**
 * 难度字典
 * 数字存入数据库，字典控制显示文字
 *
 * 内置 AI: 1=简单, 2=普通, 3=中等, 4=困难
 * KataGo: 11=简单, 12=普通, 13=困难, 14=顶级
 */

export const BUILTIN_DIFFICULTY = {
  1: '简单',
  2: '普通',
  3: '中等',
  4: '困难',
} as const;

export const KATAGO_DIFFICULTY = {
  11: { label: '简单', visits: 30, time: 5 },
  12: { label: '普通', visits: 100, time: 15 },
  13: { label: '困难', visits: 500, time: 30 },
  14: { label: '顶级', visits: 2000, time: 60 },
} as const;

/** 从数字难度获取显示文字 */
export function getDifficultyLabel(difficulty: number): string {
  if (difficulty in KATAGO_DIFFICULTY) {
    const d = KATAGO_DIFFICULTY[difficulty as keyof typeof KATAGO_DIFFICULTY];
    return `${d.label} (${d.visits}v/${d.time}s)`;
  }
  if (difficulty in BUILTIN_DIFFICULTY) {
    return BUILTIN_DIFFICULTY[difficulty as keyof typeof BUILTIN_DIFFICULTY];
  }
  return '';
}
