import WebSocket from 'ws';
import { GameType, GamePhase } from '@lan-boardgame/shared';
import { Room, RoomPlayer, RoomActivity } from '../../room/Room.js';
import { saveActiveRoom } from '../../room/RoomPersistence.js';
import { getEngine, sendError } from '../utils.js';
import type { ClientMessage, DispatcherContext } from '../types.js';
import { logRoomActivity } from '../records/GameRecordSaver.js';

export function registerChallengeHandlers(ctx: DispatcherContext, handlers: Map<string, Function>): void {

  handlers.set('challenge', (ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room) => {
    if (player.isOwner) {
      sendError(ws, 'CANNOT_CHALLENGE', '房主不能挑战自己');
      return;
    }

    if (room.activity === RoomActivity.Playing || room.activity === RoomActivity.Idle2) {
      sendError(ws, 'OWNER_BUSY', '房主对局中，请稍后申请');
      return;
    }

    if (room.challenge) {
      sendError(ws, 'CHALLENGE_EXISTS', '已有挑战进行中');
      return;
    }

    room.challenge = { challengerId: player.id, createdAt: Date.now() };

    const challengeTimer = setTimeout(() => {
      if (room.challenge?.challengerId === player.id) {
        room.sendTo(room.owner!.id, {
          type: 'challenge_timeout',
          payload: { playerId: player.id, message: '申请超时，已自动取消' },
        });
        ws.send(JSON.stringify({
          type: 'challenge_timeout',
          payload: { message: '申请超时，已自动取消' },
        }));
        room.challenge = null;
        room.challengeTimer = null;
      }
    }, 60000);
    room.challengeTimer = challengeTimer;

    room.sendTo(room.owner!.id, {
      type: 'challenge_request',
      payload: {
        challenger: { id: player.id, username: player.username },
        timeout: 60,
      },
    });

    ws.send(JSON.stringify({
      type: 'challenge_sent',
      payload: { message: `已向 👑${room.owner?.username} 申请对局`, timeout: 60 },
    }));
  });

  handlers.set('challenge_response', (ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => {
    if (!player.isOwner) {
      sendError(ws, 'NOT_OWNER', '只有房主能回应挑战');
      return;
    }

    if (!room.challenge) {
      sendError(ws, 'NO_CHALLENGE', '没有待处理的挑战');
      return;
    }

    const accepted = msg.payload.accepted as boolean;
    if (room.challengeTimer) {
      clearTimeout(room.challengeTimer);
      room.challengeTimer = null;
    }
    const challenger = room.getAllPlayers().find(p => p.id === room.challenge!.challengerId);

    if (!challenger) {
      room.challenge = null;
      return;
    }

    if (accepted) {
      if (!room.players.some(p => p.id === challenger.id)) {
        room.players.push(challenger);
        room.spectators = room.spectators.filter(p => p.id !== challenger.id);
      }

      room.challenge = null;
      room.activity = RoomActivity.Playing;

      room.guessFirst = {
        challengerId: challenger.id,
        number: null,
        choice: null,
        phase: 'waiting_number',
      };

      room.broadcast({
        type: 'guess_first_start',
        payload: {
          challenger: { id: challenger.id, username: challenger.username },
          owner: { id: room.owner!.id, username: room.owner!.username },
        },
      });

      room.sendTo(challenger.id, {
        type: 'guess_first_prompt_number',
        payload: { message: '请输入一个 1-20 的数字' },
      });

      room.sendTo(room.owner!.id, {
        type: 'guess_first_prompt_choice',
        payload: { message: `${challenger.username} 填写数字中...`, waiting: true, challenger: challenger.username },
      });

      room.sendTo(room.owner!.id, {
        type: 'challenge_response',
        payload: { accepted: true, message: '已接受' },
      });
      room.broadcast({
        type: 'room_updated',
        payload: { room: room.toSnapshot() },
      });
    } else {
      room.challenge = null;
      room.sendTo(challenger.id, {
        type: 'challenge_response',
        payload: { accepted: false, message: `👑${player.username} 拒绝对局` },
      });
      ws.send(JSON.stringify({
        type: 'challenge_response',
        payload: { accepted: false, message: '已拒绝' },
      }));
    }
  });

  handlers.set('guess_first_number', (ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => {
    const gf = room.guessFirst;
    if (!gf || gf.phase !== 'waiting_number') {
      sendError(ws, 'INVALID_PHASE', '当前不是猜先阶段');
      return;
    }
    if (gf.challengerId !== player.id) {
      sendError(ws, 'NOT_CHALLENGER', '只有申请人可以出拳');
      return;
    }

    const isCC = room.gameType === GameType.ChineseChess;
    const isIC = room.gameType === GameType.Chess;
    const isD = room.gameType === GameType.Draughts;

    if (isCC || isIC || isD) {
      const rps = msg.payload.rps as string;
      if (!['rock', 'scissors', 'paper'].includes(rps)) {
        sendError(ws, 'INVALID_RPS', '请选择石头、剪刀或布');
        return;
      }
      gf.number = rps;
    } else {
      const number = msg.payload.number as number;
      if (!Number.isInteger(number) || number < 1 || number > 20) {
        sendError(ws, 'INVALID_NUMBER', '请输入 1-20 的整数');
        return;
      }
      gf.number = number;
    }

    gf.phase = 'waiting_choice';

    ws.send(JSON.stringify({
      type: 'guess_first_number_submitted',
      payload: { message: '已提交，等待对方选择' },
    }));

    room.sendTo(room.owner!.id, {
      type: 'guess_first_prompt_choice',
      payload: { message: `${player.username} 已选好，请选择`, challenger: player.username },
    });
  });

  handlers.set('guess_first_choice', (ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => {
    const gf = room.guessFirst;
    if (!gf || gf.phase !== 'waiting_choice') {
      sendError(ws, 'INVALID_PHASE', '当前不是猜先阶段');
      return;
    }
    if (!player.isOwner) {
      sendError(ws, 'NOT_OWNER', '只有房主可以回应');
      return;
    }

    const isCC = room.gameType === GameType.ChineseChess;
    const isIC = room.gameType === GameType.Chess;
    const isD = room.gameType === GameType.Draughts;
    let challengerColor: string, ownerColor: string;

    if (isCC || isIC || isD) {
      const choice = msg.payload.choice as string;
      if (!['rock', 'scissors', 'paper'].includes(choice)) {
        sendError(ws, 'INVALID_RPS', '请选择石头、剪刀或布');
        return;
      }

      const rps = gf.number as string;
      const rpsNames: Record<string, string> = { rock: '石头', scissors: '剪刀', paper: '布' };
      const winMap: Record<string, string> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
      const challengerWins = winMap[rps] === choice;
      const ownerWins = winMap[choice] === rps;

      const winFirstColor = (isIC || isD) ? 'white' : 'red';
      const winSecondColor = 'black';

      if (challengerWins) {
        challengerColor = winFirstColor;
        ownerColor = winSecondColor;
      } else if (ownerWins) {
        challengerColor = winSecondColor;
        ownerColor = winFirstColor;
      } else {
        challengerColor = winFirstColor;
        ownerColor = winSecondColor;
      }

      room.broadcast({
        type: 'guess_first_result',
        payload: {
          number: rpsNames[rps],
          choice: rpsNames[choice],
          challengerChoice: rps,
          ownerChoice: choice,
          isOdd: false,
          guessCorrect: challengerWins,
          challenger: { id: room.players.find(p => p.id === gf.challengerId)?.id, username: room.players.find(p => p.id === gf.challengerId)?.username, color: challengerColor },
          owner: { id: room.owner?.id, username: room.owner?.username, color: ownerColor },
        },
      });
    } else {
      const choice = msg.payload.choice as string;
      if (choice !== 'odd' && choice !== 'even') {
        sendError(ws, 'INVALID_CHOICE', '请选择单或双');
        return;
      }

      const isOdd = (gf.number as number) % 2 === 1;
      const guessCorrect = (choice === 'odd' && isOdd) || (choice === 'even' && !isOdd);

      challengerColor = guessCorrect ? 'white' : 'black';
      ownerColor = guessCorrect ? 'black' : 'white';

      room.broadcast({
        type: 'guess_first_result',
        payload: {
          number: gf.number,
          choice: choice === 'odd' ? '单' : '双',
          isOdd,
          guessCorrect,
          challenger: { id: room.players.find(p => p.id === gf.challengerId)?.id, username: room.players.find(p => p.id === gf.challengerId)?.username, color: challengerColor },
          owner: { id: room.owner?.id, username: room.owner?.username, color: ownerColor },
        },
      });
    }

    const challenger = room.players.find(p => p.id === gf.challengerId);
    if (challenger) challenger.color = challengerColor;
    if (room.owner) room.owner.color = ownerColor;

    room.guessFirst = null;

    setTimeout(() => {
      startPvpGame(room);
    }, 2500);
  });

  handlers.set('rematch', (_ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room) => {
    room.rematchPlayers = room.rematchPlayers || [];
    if (!room.rematchPlayers.includes(player.id)) {
      room.rematchPlayers.push(player.id);
    }

    const allPlayers = [...room.players];
    for (const p of allPlayers) {
      if (p.id !== player.id && p.ws && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(JSON.stringify({
          type: room.rematchPlayers.includes(p.id) ? 'rematch_self' : 'rematch_notify',
          payload: { playerId: player.id, bothReady: room.rematchPlayers.length >= 2 },
        }));
      }
    }
    player.ws?.send(JSON.stringify({
      type: 'rematch_self',
      payload: { playerId: player.id },
    }));

    if (room.rematchPlayers.length >= 2) {
      const humanPlayers = room.players.filter(p => !p.id.startsWith('ai-'));
      if (!room.katagoGame) {
        if (!humanPlayers.some(p => p.id.startsWith('ai-'))) {
          for (const pid of room.rematchPlayers) {
            const p = room.players.find(pl => pl.id === pid);
            if (p && p.id.startsWith('ai-')) {
              room.players = room.players.filter(pl => pl.id !== pid);
            }
          }
        }
      }
      room.rematchPlayers = [];
      startPvpGame(room);
    }
  });

  handlers.set('rematch_response', (ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => {
    room.rematchPlayers = room.rematchPlayers || [];

    room.activity = RoomActivity.Idle0;
    const allPlayers = [...room.players];
    for (const p of allPlayers) {
      if (p.id.startsWith('ai-')) {
        room.players = room.players.filter(pl => pl.id !== p.id);
      } else if (!p.isOwner) {
        room.spectators.push({ ...p, ws: p.ws, isOwner: false } as RoomPlayer);
        room.players = room.players.filter(pl => pl.id !== p.id);
      }
    }

    room.gameState = null;
    room.moveHistory = [];

    room.broadcast({
      type: 'room_updated',
      payload: { room: room.toSnapshot() },
    });

    ws.send(JSON.stringify({
      type: 'room_updated',
      payload: { room: room.toSnapshot() },
    }));
  });

  handlers.set('chat', (_ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => {
    const text = msg.payload.text as string;
    if (!text || !text.trim()) return;
    ctx.chatHandler.addMessage(room, player, text);
  });
}

function startPvpGame(room: Room): void {
  const engine = getEngine(room.gameType, room.config);
  room.gameState = engine.createInitialState(room.config, []);
  room.moveHistory = [];
  logRoomActivity(room, 0);
  saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
    room.gameType, room.config, 'playing', room.players.map(p => p.id));

  if (room.gameType === GameType.Go) {
    room.gameStartedAt = Date.now();
    room.gameState = {
      ...room.gameState,
      clock: {
        black: { moveTime: 0, totalTime: 0 },
        white: { moveTime: 0, totalTime: 0 },
        lastMoveAt: room.gameStartedAt,
        blackTurnAt: room.gameStartedAt,
        whiteTurnAt: room.gameStartedAt,
      },
    };
  }

  room.broadcast({
    type: 'game_started',
    payload: {
      gameState: room.gameState,
      players: room.players.map(p => ({
        id: p.id, username: p.username, color: p.color, isAi: p.id.startsWith('ai-'),
      })),
    },
  });
}
