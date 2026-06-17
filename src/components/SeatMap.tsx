import { useEffect, useRef, useState } from 'react';
import { Wrench } from 'lucide-react';
import type { SeatMapRow, TicketType } from '../lib/supabase';

interface SeatMapProps {
  seats: SeatMapRow[];
  rows: number;
  seatsPerRow: number;
  screenDirection: 'top' | 'bottom' | 'left' | 'right';
  selectedSeatId: string | null;
  selectedSeatIds?: string[];
  /** Map of selected seatId → ticket type, for color-coded multi-select */
  selectedSeatTypes?: Record<string, TicketType>;
  onSeatClick: (seat: SeatMapRow) => void;
  readonly?: boolean;
  lockExpiresAt?: string | null;
  isEn?: boolean;
  adminBlockMode?: boolean;
  adminSelectedIds?: Set<string>;
  onAdminSeatClick?: (seat: SeatMapRow) => void;
  stageCenterCol?: number;
  adminProxyMode?: boolean;
}

// ── Ticket-type color maps ────────────────────────────────────────────────────
const TICKET_SELECTED_CLS: Record<TicketType, string> = {
  adult:      'bg-sky-500 text-white shadow-md scale-105',
  child:      'bg-emerald-500 text-white shadow-md scale-105',
  concession: 'bg-amber-500 text-white shadow-md scale-105',
};

const TICKET_DOT_CLS: Record<TicketType, string> = {
  adult:      'bg-sky-400',
  child:      'bg-emerald-400',
  concession: 'bg-amber-400',
};

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [secs, setSecs] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return (
    <span className={`font-mono font-bold ${secs <= 60 ? 'text-red-500' : 'text-amber-600'}`}>
      {m}:{s}
    </span>
  );
}

function PinchPanContainer({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scale = useRef(1);
  const translateX = useRef(0);
  const translateY = useRef(0);
  const lastPinchDist = useRef<number | null>(null);
  const lastPanPos = useRef<{ x: number; y: number } | null>(null);
  const baseScale = useRef(1);
  const baseX = useRef(0);
  const baseY = useRef(0);

  function applyTransform() {
    const el = containerRef.current?.querySelector('.pinch-inner') as HTMLElement | null;
    if (!el) return;
    el.style.transform = `translate(${translateX.current}px, ${translateY.current}px) scale(${scale.current})`;
  }
  function clampTranslate() {
    if (scale.current <= 1.01) { translateX.current = 0; translateY.current = 0; }
  }
  function dist(t: TouchList) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function midpoint(t: TouchList) {
    return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
  }
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      lastPinchDist.current = dist(e.touches);
      baseScale.current = scale.current;
      baseX.current = translateX.current;
      baseY.current = translateY.current;
      lastPanPos.current = null;
    } else if (e.touches.length === 1 && scale.current > 1.01) {
      lastPanPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && lastPinchDist.current !== null) {
      e.preventDefault();
      const newDist = dist(e.touches);
      const ratio = newDist / lastPinchDist.current;
      scale.current = Math.min(4, Math.max(1, baseScale.current * ratio));
      const mid = midpoint(e.touches);
      const rect = containerRef.current!.getBoundingClientRect();
      const originX = mid.x - rect.left - rect.width / 2;
      const originY = mid.y - rect.top - rect.height / 2;
      translateX.current = originX - (originX - baseX.current) * (scale.current / baseScale.current);
      translateY.current = originY - (originY - baseY.current) * (scale.current / baseScale.current);
      clampTranslate();
      applyTransform();
    } else if (e.touches.length === 1 && lastPanPos.current && scale.current > 1.01) {
      e.preventDefault();
      translateX.current += e.touches[0].clientX - lastPanPos.current.x;
      translateY.current += e.touches[0].clientY - lastPanPos.current.y;
      lastPanPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      applyTransform();
    }
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) {
      lastPinchDist.current = null;
      if (scale.current <= 1.01) {
        scale.current = 1; translateX.current = 0; translateY.current = 0; applyTransform();
      }
    }
    if (e.touches.length === 0) lastPanPos.current = null;
  }

  return (
    <div ref={containerRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      style={{ touchAction: 'pan-y', overflow: 'hidden' }}>
      <div className="pinch-inner" style={{ transformOrigin: 'center center', transition: 'none', willChange: 'transform' }}>
        {children}
      </div>
    </div>
  );
}

export default function SeatMap({
  seats, rows, seatsPerRow, screenDirection,
  selectedSeatId, selectedSeatIds, selectedSeatTypes,
  onSeatClick, readonly = false, lockExpiresAt, isEn = false,
  adminBlockMode = false, adminSelectedIds, onAdminSeatClick,
  stageCenterCol, adminProxyMode = false,
}: SeatMapProps) {
  const rowGroups: SeatMapRow[][] = [];
  for (let r = 1; r <= rows; r++) {
    rowGroups.push(seats.filter(s => s.row_index === r).sort((a, b) => a.col_index - b.col_index));
  }

  const stageCenterColNum = stageCenterCol ? Number(stageCenterCol) : null;
  const effectiveStageCenterCol = stageCenterColNum ?? (seatsPerRow + 1) / 2;

  const hasAnySelection = !!selectedSeatId || (selectedSeatIds && selectedSeatIds.length > 0);
  const lockBanner = lockExpiresAt && hasAnySelection ? (
    <div className="mb-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
      <span className="text-xs text-amber-700">{isEn ? 'Seats held, expires in' : '座位已锁定，剩余'}</span>
      <Countdown expiresAt={lockExpiresAt} />
      <span className="text-xs text-amber-700">{isEn ? '' : '后自动释放'}</span>
    </div>
  ) : null;

  // Fixed layout constants for consistent alignment
  const rowLabelWidth = 20; // w-5 = 20px for row letter
  const seatWidth = 32; // w-8 = 32px for each seat button
  const seatGap = 4; // gap-1 = 4px between seats
  const stageGap = 4; // gap between row labels and stage bar
  
  // Calculate grid width: row label + gap + all seats
  const gridWidth = rowLabelWidth + stageGap + seatsPerRow * (seatWidth + seatGap) - seatGap;
  
  // Calculate stage position: center of the effective stage column
  const stagePosX = rowLabelWidth + stageGap + (effectiveStageCenterCol - 0.5) * (seatWidth + seatGap) - seatGap / 2;

  const screenBar = (
    <div className="relative h-8 mb-2" style={{ width: `${gridWidth}px` }}>
      <div className="absolute" style={{ bottom: 0, left: `${stagePosX}px`, transform: 'translateX(-50%)' }}>
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-full border border-gray-300 whitespace-nowrap">
          <svg width="14" height="13" viewBox="0 0 14 13" className="flex-shrink-0">
            <rect x="1" y="1" width="12" height="8" rx="1.2" fill="none" stroke="rgb(107, 114, 128)" strokeWidth="1.1" />
            <line x1="7" y1="9" x2="7" y2="11" stroke="rgb(107, 114, 128)" strokeWidth="1" />
            <line x1="4" y1="11" x2="10" y2="11" stroke="rgb(107, 114, 128)" strokeWidth="1" />
          </svg>
          <span className="text-xs font-medium text-gray-600">{isEn ? 'Stage' : '舞台'}</span>
        </div>
      </div>
    </div>
  );

  // Whether any selected seat has a non-default ticket type (for showing legend)
  const hasTicketTypes = selectedSeatTypes && Object.keys(selectedSeatTypes).length > 0;

  const grid = (
    <div className="overflow-x-auto text-center">
      <div className="inline-block text-left">
        {screenDirection === 'top' && screenBar}
        {rowGroups.map((rowSeats, idx) => {
          const rowLetter = String.fromCharCode(65 + idx);
          return (
            <div key={idx} className="flex items-center gap-1 mb-1">
              <span className="w-5 text-center text-[10px] font-bold text-gray-400 flex-shrink-0">{rowLetter}</span>
              <div className="flex gap-1 flex-nowrap">
                {rowSeats.map(seat => {
                  if (adminBlockMode) {
                    const isAdminSelected = adminSelectedIds?.has(seat.id) ?? false;
                    const blockBookedType = seat.booked_ticket_type;
                    const BLOCK_BOOKED_CLS: Record<TicketType, string> = {
                      adult: 'bg-sky-400 text-white',
                      child: 'bg-teal-500 text-white',
                      concession: 'bg-amber-400 text-white',
                    };
                    const BLOCK_BOOKED_LBL: Record<TicketType, string> = { adult: '成', child: '童', concession: '优' };
                    let cls = 'w-8 h-8 rounded-lg text-[9px] font-bold flex items-center justify-center transition-all select-none flex-shrink-0 cursor-pointer ';
                    if (isAdminSelected) cls += 'bg-orange-400 text-white ring-2 ring-orange-500 scale-105';
                    else if (seat.is_blocked) cls += 'bg-gray-400 text-white';
                    else if (seat.is_booked && blockBookedType) cls += BLOCK_BOOKED_CLS[blockBookedType];
                    else if (seat.is_booked) cls += 'bg-slate-400 text-white';
                    else cls += 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200';
                    return (
                      <button key={seat.id} type="button" onClick={() => onAdminSeatClick?.(seat)}
                        title={seat.is_booked ? `${seat.seat_name}（${blockBookedType === 'adult' ? '成人票' : blockBookedType === 'child' ? '儿童票' : blockBookedType === 'concession' ? '优待票' : '已售'}）` : seat.seat_name}
                        className={cls}>
                        {seat.is_blocked && !isAdminSelected ? '×' : seat.is_booked && blockBookedType ? BLOCK_BOOKED_LBL[blockBookedType] : seat.col_index}
                      </button>
                    );
                  }

                  const isSelected = seat.id === selectedSeatId || selectedSeatIds?.includes(seat.id);
                  const isDisabled = seat.is_booked || (!adminProxyMode && seat.is_blocked) || (seat.is_locked && !isSelected);

                  // Determine selected ticket type color
                  const selType: TicketType = (selectedSeatTypes?.[seat.id] ?? 'adult') as TicketType;
                  const selCls = isSelected ? TICKET_SELECTED_CLS[selType] : '';

                  // Booked seat type dot color
                  const bookedType = seat.booked_ticket_type;
                  const dotCls = (seat.is_booked && bookedType) ? TICKET_DOT_CLS[bookedType] : null;

                  let cls = 'relative w-8 h-8 rounded-lg text-[9px] font-bold flex items-center justify-center transition-all select-none flex-shrink-0 ';
                  if (isSelected) {
                    cls += selCls;
                  } else if (seat.is_blocked && adminProxyMode) {
                    cls += 'bg-amber-200 text-amber-700 hover:bg-amber-300 cursor-pointer active:scale-95 ring-1 ring-amber-400';
                  } else if (seat.is_blocked) {
                    cls += 'bg-slate-500 text-slate-200 cursor-not-allowed';
                  } else if (seat.is_booked) {
                    cls += 'bg-gray-200 text-gray-400 cursor-not-allowed';
                  } else if (seat.is_locked && !seat.locked_by_me) {
                    cls += 'bg-amber-400 text-white cursor-not-allowed';
                  } else if (seat.locked_by_me) {
                    cls += 'bg-amber-300 text-amber-900 cursor-not-allowed';
                  } else if (readonly) {
                    cls += 'bg-emerald-100 text-emerald-700';
                  } else {
                    cls += 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer active:scale-95';
                  }

                  return (
                    <button key={seat.id} type="button"
                      disabled={isDisabled || readonly}
                      onClick={() => { if (!isDisabled && !readonly) onSeatClick(seat); }}
                      title={seat.is_blocked ? (isEn ? 'Unavailable' : '暂不可用') : seat.seat_name}
                      className={cls}
                    >
                      {seat.is_blocked ? <Wrench size={10} /> : seat.col_index}
                      {/* Ticket-type dot on booked seats */}
                      {dotCls && (
                        <span className={`absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full ${dotCls}`} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {screenDirection === 'bottom' && screenBar}
      </div>
    </div>
  );

  return (
    <div>
      {lockBanner}
      <PinchPanContainer>{grid}</PinchPanContainer>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {!adminBlockMode && (
          <>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-emerald-100" />
              <span className="text-[10px] text-gray-500">{isEn ? 'Available' : '可选'}</span>
            </div>
            {hasTicketTypes ? (
              <>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-sky-500" />
                  <span className="text-[10px] text-gray-500">{isEn ? 'Adult' : '成人'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-emerald-500" />
                  <span className="text-[10px] text-gray-500">{isEn ? 'Child' : '儿童'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-amber-500" />
                  <span className="text-[10px] text-gray-500">{isEn ? 'Concession' : '优待'}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded bg-sky-500" />
                <span className="text-[10px] text-gray-500">{isEn ? 'Selected' : '已选'}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-gray-200" />
              <span className="text-[10px] text-gray-500">{isEn ? 'Sold' : '已售'}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-amber-400" />
              <span className="text-[10px] text-gray-500">{isEn ? 'Held' : '锁定中'}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-slate-500 flex items-center justify-center"><Wrench size={8} className="text-slate-200" /></div>
              <span className="text-[10px] text-gray-500">{isEn ? 'Unavailable' : '暂不可用'}</span>
            </div>
            {/* Ticket type dot legend — only when booked seats have type info */}
            {seats.some(s => s.is_booked && s.booked_ticket_type) && (
              <div className="flex items-center gap-2 ml-1 pl-2 border-l border-gray-200">
                <span className="text-[10px] text-gray-400">{isEn ? 'Type:' : '票种:'}</span>
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" /><span className="text-[10px] text-gray-400">{isEn ? 'Adult' : '成人'}</span></div>
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /><span className="text-[10px] text-gray-400">{isEn ? 'Child' : '儿童'}</span></div>
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /><span className="text-[10px] text-gray-400">{isEn ? 'Concession' : '优待'}</span></div>
              </div>
            )}
          </>
        )}
        {adminBlockMode && (
          <>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded bg-emerald-100" /><span className="text-[10px] text-gray-500">可用</span></div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded bg-gray-400 flex items-center justify-center text-[8px] text-white font-bold">×</div><span className="text-[10px] text-gray-500">已屏蔽</span></div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded bg-orange-400" /><span className="text-[10px] text-gray-500">选中中</span></div>
            <div className="flex items-center gap-1 border-l border-gray-200 pl-2 ml-1">
              <div className="w-4 h-4 rounded bg-sky-400 flex items-center justify-center text-[8px] text-white font-bold">成</div><span className="text-[10px] text-gray-500">成人</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-teal-500 flex items-center justify-center text-[8px] text-white font-bold">童</div><span className="text-[10px] text-gray-500">儿童</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-amber-400 flex items-center justify-center text-[8px] text-white font-bold">优</div><span className="text-[10px] text-gray-500">优待</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
