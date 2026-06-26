import type { ReactNode } from 'react';

/** 房间聊天消息（与 useRoom.ts 的 ChatMessage 保持一致） */
export interface ChatMsg {
  playerId: string;
  username: string;
  text: string;
  timestamp: number;
  /** 系统消息标记 */
  isSystem?: boolean;
  /** 需要在 text 中高亮显示的人名/关键词列表 */
  highlights?: string[];
}

/** 格式化聊天时间戳：今天 HH:MM，昨天"昨天 HH:MM"，更早 MM-DD HH:MM */
export function formatChatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hh}:${mm}`;
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`;
}

/** 判断是否为系统消息 */
export function isSystemMsg(msg: { playerId: string; username: string; isSystem?: boolean }): boolean {
  return msg.isSystem === true || msg.username === '系统' || msg.username === 'System' || !msg.playerId || msg.playerId === 'system';
}

/** 判断两条消息间是否需要插入时间分隔（间隔超过 5 分钟） */
export function shouldShowTimeDivider(cur: { timestamp: number }, prev?: { timestamp: number }): boolean {
  if (!prev) return true;
  return cur.timestamp - prev.timestamp > 5 * 60 * 1000;
}

/**
 * 将 text 中匹配 highlights 的片段渲染为高亮 span。
 * 用正则一次性切分，避免多次 split 导致的嵌套问题。
 */
export function renderHighlightedText(text: string, highlights: string[] = []): ReactNode[] {
  if (!highlights.length) return [text];
  const escaped = highlights.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const parts = text.split(re);
  return parts.map((part, i) =>
    highlights.includes(part)
      ? <span key={i} className="chat-highlight-name">{part}</span>
      : part
  );
}
