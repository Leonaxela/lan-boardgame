import React, { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import TileView from './components/TileView';
import Dropdown from '../../components/Dropdown';
import { formatChatTime } from '../../utils/chat';
import { speakDiscard, speakChi, speakPeng, speakGang, speakHu } from '../../utils/sound';
import '../../styles/mahjong-room.css';

type Phase = 'playing'|'result';
interface TileData { suit:string;value:number }
interface MeldData { type:string;tiles:TileData[] }
interface PlayerInfo { username:string;seat:number|null;isAI:boolean }
interface SpectatorInfo { username:string }
interface MahjongResult { winner:number;fan:number;reason:string;hand:TileData[];melds:MeldData[];winTile:TileData;loser?:number }
interface ClientState { phase:string;variant:string;myHand:TileData[];handSizes:number[];discards:TileData[][];melds:MeldData[][];currentPlayer:number;lastDiscard:TileData|null;lastDiscardPlayer:number;drawnTile:TileData|null;dealer:number;wind:string;round:number;wallEnd:boolean;wallCount:number;result:MahjongResult|null;winners:number[];seat:number }
interface AvailableAction { type:string;tiles:TileData[];seat:number;chiCombos?:TileData[][] }

const SEAT_NAMES=['东','南','西','北']; const SEAT_COLORS=['#e74c3c','#3498db','#2ecc71','#f39c12'];

export default function MahjongPage() {
  const ws=useWebSocket();
  const [phase,setPhase]=useState<Phase>('playing');
  const [players,setPlayers]=useState<PlayerInfo[]>([]);
  const [spectators,setSpectators]=useState<SpectatorInfo[]>([]);
  const [roomId,setRoomId]=useState('');
  const [gs,setGs]=useState<ClientState|null>(null);
  const [mySeat,setMySeat]=useState<number|null>(null);
  const [sel,setSel]=useState(-1);
  const [acts,setActs]=useState<AvailableAction[]|null>(null);
  const [isOwner,setIsOwner]=useState(false);
  const [variant,setVariant]=useState('sichuan');
  const [chatMsg,setChatMsg]=useState('');
  const [chatLog,setChatLog]=useState<{username:string;text:string;isSystem?:boolean;timestamp?:number}[]>([]);
  const [showHelp,setShowHelp]=useState(false);
  const [lastTile,setLastTile]=useState<TileData|null>(null);
  const [rematchCount,setRematchCount]=useState(0);
  const [discarding,setDiscarding]=useState(false);
  const cr=useRef<HTMLDivElement>(null);

  useEffect(()=>{if(!ws.connected)return;const u:(()=>void)[]=[];
    u.push(ws.onMessage('mahjong_room_created',(p:any)=>{setRoomId(p.roomId);setPlayers(p.players||[]);setSpectators(p.spectators||[]);setIsOwner(true);setVariant(p.variant||'sichuan');setMySeat(0);}));
    u.push(ws.onMessage('mahjong_room_joined',(p:any)=>{setRoomId(p.roomId);setPlayers(p.players||[]);setSpectators(p.spectators||[]);setIsOwner(false);setVariant(p.variant||'sichuan');setMySeat(null);}));
    u.push(ws.onMessage('mahjong_seat_changed',(p:any)=>{setPlayers(p.players||[]);setSpectators(p.spectators||[]);const me=(p.players||[]).find((pl:any)=>pl.username===localStorage.getItem('username'));setMySeat(me?me.seat:null);}));
    u.push(ws.onMessage('mahjong_game_started',(p:any)=>{setGs(p.state);setPlayers(p.players||[]);setPhase('playing');}));
    u.push(ws.onMessage('mahjong_game_state',(p:ClientState)=>{setGs(p);setMySeat(p.seat??mySeat);setActs(null);setSel(-1);setDiscarding(false);}));
    u.push(ws.onMessage('mahjong_discarded',(p:any)=>{speakDiscard();setLastTile(p.tile||null);setDiscarding(false);if(p.state)setGs(p.state);}));
    u.push(ws.onMessage('mahjong_actions',(p:any)=>{setGs(p.state);setActs(p.actions||null);}));
    u.push(ws.onMessage('mahjong_game_over',(p:any)=>{setGs(p.state);setPhase('result');setActs(null);}));
    u.push(ws.onMessage('mahjong_rematch_count',(p:any)=>{setRematchCount(p.count||0);}));
    u.push(ws.onMessage('mahjong_game_ended',()=>{setGs(null);setSel(-1);setActs(null);setLastTile(null);setRematchCount(0);setDiscarding(false);setPhase('playing');}));
    u.push(ws.onMessage('mahjong_variant_updated',(p:any)=>{setVariant(p.variant||'sichuan');}));
    u.push(ws.onMessage('mahjong_chat',(p:any)=>{setChatLog(prev=>[...prev,p]);}));
    u.push(ws.onMessage('mahjong_spectator_joined',(p:any)=>{setSpectators(p.spectators||[]);}));
    u.push(ws.onMessage('mahjong_action_performed',(p:any)=>{switch(p.action){case'chi':speakChi();break;case'peng':speakPeng();break;case'gang':case'angang':case'jiagang':speakGang();break;case'hu':speakHu();break;}}));
    u.push(ws.onMessage('room_destroyed',()=>{window.location.href='/';}));
    return ()=>u.forEach(fn=>fn());
  },[ws.connected]);

  useEffect(()=>{cr.current?.scrollIntoView();},[chatLog]);
  const send=useCallback((t:string,p?:any)=>{ws.send(t,p||{});},[ws.send]);
  const uname=localStorage.getItem('username')||'玩家'; const s=gs;
  const exit=useCallback(()=>{send('mahjong_leave_room');window.location.href='/';},[send]);
  const endGame=useCallback(()=>{setGs(null);setPhase('playing');send('mahjong_end_game');},[send]);
  const sit=useCallback((seat:number)=>{send('mahjong_sit',{seat});},[send]);
  const stand=useCallback(()=>{send('mahjong_stand',{});},[send]);
  const chVar=useCallback((v:string)=>{setVariant(v);send('mahjong_set_variant',{variant:v});},[send]);
  const chat=useCallback(()=>{if(!chatMsg.trim())return;send('mahjong_chat',{text:chatMsg.trim()});setChatMsg('');},[chatMsg,send]);
  const discard=useCallback(()=>{if(sel<0||discarding)return;setDiscarding(true);send('mahjong_discard',{tileIndex:sel});setSel(-1);},[sel,send,discarding]);
  const humanCount=players.filter(p=>!p.isAI).length;

  const topS=((mySeat||0)+2)%4; const leftS=((mySeat||0)+3)%4; const rightS=((mySeat||0)+1)%4;
  const gn=(seat:number)=>{const p=players.find(x=>x.seat===seat);return p?(p.isAI?'🤖':'')+p.username:'';};
  const pl=(seat:number)=>{const p=players.find(x=>x.seat===seat);if(!p)return '';const icon=p.isAI?'🤖':(p.username===players[0]?.username?'👑':'👨');const name=p.isAI?'电脑':p.username;return `${SEAT_NAMES[seat]} ${icon} ${name}`;};
  const isMyTurn=s?.currentPlayer===mySeat&&!acts;

  const Empty=({v,seat}:{v?:boolean;seat:number})=><span onClick={()=>sit(seat)} style={{border:'1px dashed rgba(255,255,255,0.2)',borderRadius:6,padding:'2px 10px',color:'rgba(255,255,255,0.25)',fontSize:12,writingMode:v?'vertical-rl':'horizontal-tb',cursor:'pointer'}}>{SEAT_NAMES[seat]} 空位</span>;

  const OppH=({seat}:{seat:number})=>{const c=s?.handSizes?.[seat]||0;if(!c)return null;return <div style={{display:'flex'}}>{Array.from({length:Math.min(c,14)}).map((_,i)=><TileView key={i} suit="wan" value={1} hidden small gap/>)}</div>;};
  const OppV=({seat,mirror}:{seat:number;mirror?:boolean})=>{const c=s?.handSizes?.[seat]||0;if(!c)return null;return <div className="mj-side-tiles">{Array.from({length:Math.min(c,14)}).map((_,i)=><TileView key={i} suit="wan" value={1} hidden small rotation={mirror?-90:90}/>)}</div>;};
  const Melds=({seat,side,rot,lastClaim}:{seat:number;side?:boolean;rot?:number;lastClaim?:TileData|null})=>{const m=s?.melds?.[seat];if(!m?.length)return null;return <div className={side?'mj-side-melds':''} style={!side?{display:'flex'}:{}}>{m.map((g:MeldData,i:number)=><div key={i} className="mj-meld-group" style={{display:'flex',flexDirection:side?'column':'row'}}>{g.type==='concealed_gang'?<><TileView suit={g.tiles[0].suit} value={g.tiles[0].value} small rotation={rot}/><TileView suit="wan" value={1} hidden small rotation={rot}/><TileView suit="wan" value={1} hidden small rotation={rot}/><TileView suit={g.tiles[3].suit} value={g.tiles[3].value} small rotation={rot}/></>:g.tiles.map((t,j)=><TileView key={j} suit={t.suit} value={t.value} small rotation={rot} className={lastClaim&&t.suit===lastClaim.suit&&t.value===lastClaim.value?'mj-meld-last':undefined}/>)}</div>)}</div>;};
  const Discards=({seat,lastTile}:{seat:number;lastTile?:TileData|null})=>{const d=s?.discards?.[seat]||[];if(!d.length)return <div style={{minWidth:40,minHeight:30}}/>;const last=s?.lastDiscardPlayer===seat&&s?.lastDiscard;return <div style={{display:'flex',flexWrap:'wrap',gap:1,maxWidth:180,justifyContent:'center'}}>{d.slice(-18).map((t,i)=>{const isLast=last?i===d.slice(-18).length-1&&t.suit===s!.lastDiscard!.suit&&t.value===s!.lastDiscard!.value:lastTile?i===d.slice(-18).length-1&&t.suit===lastTile.suit&&t.value===lastTile.value:false;return isLast?<div key={i} className="mj-discard-last"><div className="mj-discard-arrow">▼</div><TileView suit={t.suit} value={t.value} small/></div>:<TileView key={i} suit={t.suit} value={t.value} small/>;})}</div>;}
  const MyHand=()=>{if(!s?.myHand)return null;return s.myHand.map((t,i)=><TileView key={i} suit={t.suit} value={t.value} selected={i===sel} onClick={()=>{if(isMyTurn)setSel(prev=>prev===i?-1:i);}}/>);};

  if(phase==='result'&&s?.result){const r=s.result;
  if(r.winner===-1){const isAIGame=players.some(p=>p.isAI);const reMatch=()=>{if(isAIGame)send('mahjong_start_solo',{variant});else send('mahjong_rematch_vote',{});};const drawExit=()=>{if(!isOwner)send('mahjong_stand',{});send('mahjong_end_game',{});};return(<div className="room-page" style={{background:'#1a2530'}}><div className="mj-result-overlay"><h1 className="mj-result-title" style={{color:'#95a5a6'}}>🀄 无人胡牌，流局了！</h1><div className="mj-result-card">{!isAIGame&&<div className="mj-rematch-bar">再战一局 {rematchCount}/{players.filter(p=>p.seat!==null).length}</div>}</div><div className="mj-result-btns"><button className="mj-result-btn" onClick={reMatch}>再战一局</button><button className="mj-result-btn-secondary" onClick={drawExit}>退出</button></div></div></div>);}
  const wn=players.find(p=>p.seat===r.winner)?.username||'未知';return(<div className="room-page" style={{background:'#1a2530'}}><div className="mj-result-overlay"><h1 className="mj-result-title" style={{color:r.winner===mySeat?'#f1c40f':'#e74c3c'}}>{r.winner===mySeat?'胡了！':`${wn} 胡牌`}</h1><div className="mj-result-card"><div>番数: <span className="mj-result-fan">{r.fan}</span></div></div><button className="mj-result-btn" onClick={endGame}>返回房间</button></div></div>);}

  const Position=({seat,h}:{seat:number;h:boolean})=>{
    const nm=gn(seat); const hasM=!!s?.melds?.[seat]?.length;
    const md=<Melds seat={seat} side={!h} rot={seat===leftS?90:seat===rightS?-90:undefined} lastClaim={lastTile}/>;
    const hd=s?h?<OppH seat={seat}/>:<OppV seat={seat} mirror={seat===rightS}/>:null;
    const r3=seat===topS?'top-row-3':'bottom-row-3';const r2=seat===topS?'top-row-2':'bottom-row-2';const r1=seat===topS?'top-row-1':'bottom-row-1';
    const c3=seat===leftS?'left-col-3':'right-col-3';const c2=seat===leftS?'left-col-2':'right-col-2';const c1=seat===leftS?'left-col-1':'right-col-1';
    if(!s) {
      const owner=players[0]; const isOs=owner&&owner.seat===seat;
      const isMe=nm&&nm===uname; const canStand2=isMe&&!isOwner;
      const label=nm?<>{isOs?'👑 ':'👨 '}{SEAT_NAMES[seat]} {nm}</>:<Empty seat={seat}/>;
      const n=<div onClick={canStand2?stand:undefined} style={{cursor:canStand2?'pointer':'default',flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#ecf0f1',fontSize:14,fontWeight:600,writingMode:h?undefined:'vertical-rl'}}>{label}</div>;
      if(!h) {const isRight=seat===rightS; const r=[<div key="x" style={{flex:1}}/>,<div key="y" style={{flex:1}}/>,<div key="z" style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>{n}</div>]; return <>{isRight?r.reverse():r}</>;}
      return <><div style={{flex:1}}/><div style={{flex:1}}/><div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>{n}</div></>;
    }
    if(!h) {const isRight=seat===rightS; const cols=[<div key="c" data-alias={c3} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#ecf0f1',fontSize:14,fontWeight:600,writingMode:'vertical-rl'}}>{pl(seat)}</div>,<div key="b" data-alias={c2} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>{hasM?md:null}</div>,<div key="a" data-alias={c1} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>{hd}</div>]; return <>{isRight?cols.reverse():cols}</>;}
    return <><div data-alias={r3} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#ecf0f1',fontSize:14,fontWeight:600}}>{pl(seat)}</div><div data-alias={r2} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>{hasM?md:null}</div><div data-alias={r1} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>{hd}</div></>;
  };

  return (<>
    {showHelp&&<div className="modal-overlay" onClick={()=>setShowHelp(false)}><div className="modal-content mj-help-modal" onClick={e=>e.stopPropagation()}><h2>规则说明</h2><button className="btn-close" onClick={()=>setShowHelp(false)} style={{marginTop:16}}>关闭</button></div></div>}
    <div className="room-page" style={{background:'#2c6e49'}}>
    <aside className="room-sidebar">
      <div className="room-header"><button className="btn-room-id">{'🀄 麻将 · '+(roomId?.slice(0,6)||'')}</button><button className="btn-exit-room" onClick={exit}>退出</button></div>
      <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginBottom:8,display:'flex',alignItems:'center',gap:4}}><span>规则:</span>{!s&&isOwner?<Dropdown options={[{value:'sichuan',label:'四川'},{value:'wuhan',label:'武汉'},{value:'guobiao',label:'国标'}]} value={variant} onChange={chVar} noBorder/>:<span style={{color:'#e0e0e0',fontSize:13}}>{variant==='sichuan'?'四川':variant==='wuhan'?'武汉':'国标'}</span>}</div>
      <div className="player-list"><h3>玩家 ({humanCount}/4)</h3>
        {[0,1,2,3].map(seat=>{const p=players.find(x=>x.seat===seat);const im=p&&p.username===uname;const isOwnerPlayer=p&&p.username===players[0]?.username;const canStand=im&&!isOwner;const click=()=>{if(canStand)stand();else if(!im&&!s)sit(seat);};
        if(!p)return<div key={seat} className="player-item empty" onClick={click} style={{cursor:'pointer'}}><span className="mj-seat-badge" style={{background:SEAT_COLORS[seat],marginRight:8}}>{SEAT_NAMES[seat]}</span><span style={{color:'rgba(255,255,255,0.25)'}}>{SEAT_NAMES[seat]} 空位</span></div>;
        return <div key={seat} className={'player-item'+(im?' is-me':'')} onClick={click} style={{cursor:canStand?'pointer':'default',display:'flex',alignItems:'center'}}><span className={'mj-seat-badge'+(s?.dealer===seat?' mj-seat-dealer':'')} style={{background:SEAT_COLORS[seat],marginRight:8}}>{SEAT_NAMES[seat]}</span><span>{isOwnerPlayer?'👑 ':p.isAI?'🤖 ':'👨 '}{p.isAI?'电脑':p.username}{s?.currentPlayer===seat?<span style={{marginLeft:'auto',color:'#dcb35c',fontSize:11}}>● 出牌中</span>:null}</span></div>;})}
      </div>
      <div className="spectator-divider">👤 观战 ({spectators.length})</div>
      {spectators.map((sp,i)=><div key={i} className="player-item" style={{color:'rgba(255,255,255,0.5)',fontSize:13}}>👤 {sp.username}</div>)}
      {!s?<div style={{marginTop:'auto',paddingTop:12,display:'flex',gap:8}}>{isOwner?<><button className="btn-sidebar" style={{flex:1}} onClick={()=>send('mahjong_start_solo',{variant})}>🤖 单机模式</button><button className="btn-sidebar" style={{flex:1}} onClick={()=>setShowHelp(true)}>📒 规则说明</button></>:<><span style={{flex:1,textAlign:'center',color:'#dcb35c',fontSize:15,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center'}}>{uname}</span><button className="btn-sidebar" style={{flex:1}} onClick={()=>setShowHelp(true)}>📒 规则说明</button></>}</div>:<div style={{marginTop:'auto',paddingTop:12,display:'flex',gap:8}}>{isOwner?<button className="btn-sidebar" style={{flex:1}} onClick={endGame}>🔄 退出本局</button>:<span style={{flex:1,textAlign:'center',color:'#dcb35c',fontSize:15,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center'}}>{uname}</span>}<button className="btn-sidebar" style={{flex:1}} onClick={()=>setShowHelp(true)}>📒 规则说明</button></div>}
    </aside>

    <main className="room-board" style={{background:'#2c6e49',display:'flex',flexDirection:'column',alignItems:'center'}}>
      <div style={{width:'55%',flex:1,display:'flex',flexDirection:'column'}}><Position seat={topS} h/></div>
      <div style={{display:'flex',width:'100%'}}>
        <div style={{flex:1,display:'flex',flexDirection:'row'}}><Position seat={leftS} h={false}/></div>
        <div style={{width:'55%',aspectRatio:'7/4',background:'radial-gradient(ellipse at center,#1e6e42 0%,#155332 70%,#0d3d20 100%)',borderRadius:16,border:'3px solid #0a2e18',boxShadow:'0 0 30px rgba(0,0,0,0.3),inset 0 0 60px rgba(0,0,0,0.2)',display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',position:'relative'}}>
          {!s&&isOwner&&humanCount>=4&&<button onClick={()=>send('mahjong_start_game',{variant})} style={{padding:'10px 28px',fontSize:16,fontWeight:700,background:'#f1c40f',color:'#1a2530',border:'none',borderRadius:10,cursor:'pointer',zIndex:5}}>🎮 开始对局</button>}
          {s&&<div style={{position:'absolute',top:4,left:'50%',transform:'translateX(-50%)',fontSize:11,color:'rgba(255,255,255,0.5)'}}>{['东','南','西','北'][s.wind==='east'?0:s.wind==='south'?1:s.wind==='west'?2:3]||'东'} {s.round||0}局 · 余{s.wallCount??0}张</div>}
<div className={`mj-flow-strip ${s?.currentPlayer===topS?'active':''}`} style={{position:'absolute',top:0,left:'20%',right:'20%',height:3}}/>
<div className={`mj-flow-strip ${s?.currentPlayer===(mySeat||0)?'active':''}`} style={{position:'absolute',bottom:0,left:'20%',right:'20%',height:3}}/>
<div className={`mj-flow-strip-v ${s?.currentPlayer===leftS?'active':''}`} style={{position:'absolute',left:0,top:'20%',bottom:'20%',width:3}}/>
<div className={`mj-flow-strip-v ${s?.currentPlayer===rightS?'active':''}`} style={{position:'absolute',right:0,top:'20%',bottom:'20%',width:3}}/>
          {s&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,width:'90%',marginTop:20}}><Discards seat={topS} lastTile={lastTile}/><Discards seat={rightS} lastTile={lastTile}/><Discards seat={leftS} lastTile={lastTile}/><Discards seat={mySeat||0} lastTile={lastTile}/></div>}
        </div>
        <div style={{flex:1,display:'flex',flexDirection:'row'}}><Position seat={rightS} h={false}/></div>
      </div>
      <div style={{width:'55%',flex:1,display:'flex',flexDirection:'column'}}>
        {!s?<>
          <div onClick={gn(mySeat||0)===uname&&!isOwner?stand:undefined} style={{cursor:gn(mySeat||0)===uname&&!isOwner?'pointer':'default',flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#ecf0f1',fontSize:14,fontWeight:600}}>{gn(mySeat||0)?<>{(()=>{const sp=players.find(x=>x.seat===(mySeat||0));return sp&&sp.username===players[0]?.username?'👑 ':'👨 ';})()}{SEAT_NAMES[(mySeat||0)]} {gn(mySeat||0)}</>:<Empty seat={mySeat||0}/>}</div>
          <div style={{flex:1}}/><div style={{flex:1}}/>
        </>:<>
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}><Melds seat={mySeat||0} lastClaim={lastTile}/></div>
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}><MyHand/></div>
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
            {isMyTurn&&<button className="mj-btn-discard" style={{fontSize:12,padding:'4px 14px'}} onClick={discard} disabled={sel<0}>出牌</button>}
            {acts?.map((a,i)=><button key={i} className={`mj-btn-action ${a.type==='hu'?'mj-btn-hu':a.type==='gang'||a.type==='angang'||a.type==='jiagang'?'mj-btn-gang':a.type==='peng'?'mj-btn-peng':a.type==='chi'?'mj-btn-chi':'mj-btn-pass'}`} style={{fontSize:12,padding:'4px 14px'}} onClick={()=>send(`mahjong_${a.type}`,{})}>{a.type==='hu'?'🀄 胡！':a.type==='gang'?'杠':a.type==='angang'?'暗杠':a.type==='jiagang'?'加杠':a.type==='peng'?'碰':a.type==='chi'?'吃':a.type}</button>)}
            {acts&&acts.length>0&&<button className="mj-btn-action mj-btn-pass" style={{fontSize:12,padding:'4px 14px'}} onClick={()=>send('mahjong_pass',{})}>过</button>}
          </div>
        </>}
      </div>
    </main>
    <aside className="room-chat"><h3>聊天</h3><div className="chat-messages">{chatLog.length===0?<p className="text-muted chat-empty-hint">暂无消息 ✦</p>:chatLog.map((msg,i)=>{const prev=chatLog[i-1];const showDivider=!prev||(msg.timestamp&&prev.timestamp&&msg.timestamp-prev.timestamp>300000);return <React.Fragment key={i}>{showDivider&&msg.timestamp?<div className="chat-time-divider"><span>{formatChatTime(msg.timestamp)}</span></div>:null}{msg.isSystem||msg.username==='系统'?<div className="chat-msg system"><span className="chat-system-text">{msg.text}</span></div>:<div className={'chat-msg '+(msg.username===uname?'me':'other')}>{msg.username!==uname?<span className="chat-user">{msg.username}</span>:null}<div className="chat-bubble">{msg.text}</div></div>}</React.Fragment>;})}<div ref={cr}/></div><div className="chat-input"><input placeholder="输入消息..." value={chatMsg} onChange={e=>setChatMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&chat()}/><button onClick={chat}>发送</button></div></aside>
    </div></>
  );
}
