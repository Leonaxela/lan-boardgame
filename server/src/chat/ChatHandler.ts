import { Room, ChatMessage, RoomPlayer } from '../room/Room.js';

const MAX_CHAT_HISTORY = 100;

/**
 * 处理房间内的聊天消息。
 * 消息存储在房间内存中，不持久化到数据库。
 * 后进入房间者只能看到自己进入后的消息。
 */
export class ChatHandler {
  /**
   * 添加并广播聊天消息。
   * @returns 生成的 ChatMessage
   */
  addMessage(room: Room, player: RoomPlayer, text: string): ChatMessage {
    const msg: ChatMessage = {
      playerId: player.id,
      username: player.username,
      text: text.trim(),
      timestamp: Date.now(),
    };

    // 存到房间历史
    room.chatMessages.push(msg);

    // 控制历史长度
    if (room.chatMessages.length > MAX_CHAT_HISTORY) {
      room.chatMessages = room.chatMessages.slice(-MAX_CHAT_HISTORY);
    }

    // 广播给房间所有人
    room.broadcast({
      type: 'chat',
      payload: msg,
    });

    return msg;
  }

  /**
   * 发送系统消息（玩家加入/离开/挑战等关键事件）。
   * 系统消息 playerId='system', username='系统'，前端按系统样式渲染。
   * @param highlights text 中需要高亮的关键词（通常是人名）
   */
  sendSystemMessage(room: Room, text: string, highlights: string[] = []): ChatMessage {
    const msg: ChatMessage = {
      playerId: 'system',
      username: '系统',
      text,
      timestamp: Date.now(),
      isSystem: true,
      highlights,
    };

    room.chatMessages.push(msg);

    if (room.chatMessages.length > MAX_CHAT_HISTORY) {
      room.chatMessages = room.chatMessages.slice(-MAX_CHAT_HISTORY);
    }

    room.broadcast({
      type: 'chat',
      payload: msg,
    });

    return msg;
  }
}
