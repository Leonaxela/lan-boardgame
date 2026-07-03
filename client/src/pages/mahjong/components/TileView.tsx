import { memo } from 'react';

interface TileProps {
  suit: string; value: number;
  selected?: boolean; onClick?: () => void;
  small?: boolean; large?: boolean;
  gap?: boolean;       // 上家手牌空隙
  rotation?: number;    // 旋转角度
  hidden?: boolean; drawn?: boolean;
  className?: string;
}

const SUIT_PREFIX: Record<string,string> = { wan:'W', tiao:'T', tong:'B', feng:'F', jian:'J' };

function getSizes(small?:boolean, large?:boolean) {
  if(large) return { w:56, h:76, mr:-10 };
  if(small) return { w:30, h:40, mr:-7 };
  return { w:40, h:54, mr:2 };
}

function TileViewBase({ suit,value,selected,onClick,small,large,gap,rotation,hidden,drawn,className }: TileProps) {
  const { w,h,mr } = getSizes(small,large);
  const actualMr = gap ? 2 : mr;
  const prefix = hidden ? 'back' : (SUIT_PREFIX[suit]||'back')+(value||1);
  const src = `/mahjong-tiles/${prefix}.svg`;
  const shadow = selected ? 'drop-shadow(0 4px 6px rgba(241,196,15,0.45))' : drawn ? 'drop-shadow(0 2px 4px rgba(232,163,23,0.35))' : 'drop-shadow(1px 1px 1px rgba(0,0,0,0.2))';
  const outline = selected ? '2px solid #f1c40f' : drawn ? '2px solid #e8a317' : 'none';
  const off = selected||drawn ? '-1px' : '0';
  const base = rotation ? `rotate(${rotation}deg)` : '';
  const lift = selected ? 'translateY(-6px)' : '';
  const t = [base,lift].filter(Boolean).join(' ');

  return <span onClick={onClick} className={className} style={{
    display:'inline-block',width:w,height:h,flexShrink:0,marginRight:actualMr,
    cursor:onClick?'pointer':'default',transform:t||'none',
    transition:'transform 0.12s ease, filter 0.12s ease',
    filter:shadow,outline,outlineOffset:off,
    borderRadius:3,overflow:'hidden',background:'#fafaf0',border:'1px solid #c9b896',boxSizing:'border-box',
  }}>
    <img src={src} alt={hidden?'牌背':`${suit}${value}`} draggable={false}
      style={{width:'100%',height:'100%',display:'block',pointerEvents:'none',userSelect:'none'}}/>
  </span>;
}

const TileView = memo(TileViewBase);
export default TileView;
