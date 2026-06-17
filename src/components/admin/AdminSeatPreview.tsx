import { useState, useEffect } from 'react';
import type { TicketType } from '../lib/supabase';

interface AdminSeatPreviewProps {
  rows: number;
  cols: number;
  screenDirection: 'top' | 'bottom';
  stageCenterCol: number;
  previewBlocked: Set<string>;
  previewBooked: Set<string>;
  previewTicketTypes: Record<string, TicketType>;
  onSeatClick: (row: number, col: number) => void;
  disabled?: boolean;
}

const PREVIEW_BOOKED_CLS: Record<TicketType, string> = {
  adult: 'bg-sky-400 text-white',
  child: 'bg-teal-500 text-white',
  concession: 'bg-amber-400 text-white',
};

const PREVIEW_BOOKED_LABEL: Record<TicketType, string> = {
  adult: '成',
  child: '童',
  concession: '优',
};

const SEAT_WIDTH = 32;
const SEAT_HEIGHT = 32;
const SEAT_GAP = 4;
const ROW_LABEL_WIDTH = 20;

export default function AdminSeatPreview({
  rows,
  cols,
  screenDirection,
  stageCenterCol,
  previewBlocked,
  previewBooked,
  previewTicketTypes,
  onSeatClick,
  disabled = false,
}: AdminSeatPreviewProps) {
  const totalWidth = ROW_LABEL_WIDTH + SEAT_GAP + cols * (SEAT_WIDTH + SEAT_GAP) - SEAT_GAP;
  const stageX = ROW_LABEL_WIDTH + SEAT_GAP + (stageCenterCol - 1) * (SEAT_WIDTH + SEAT_GAP) + SEAT_WIDTH / 2;

  const [hoveredSeat, setHoveredSeat] = useState<{ row: number; col: number } | null>(null);

  const renderStage = () => (
    <div className="relative h-8 mb-3" style={{ width: `${totalWidth}px` }}>
      <div
        className="absolute flex items-center gap-1.5 px-3 py-1 bg-gray-100 rounded-full border border-gray-300 whitespace-nowrap"
        style={{
          left: `${stageX}px`,
          bottom: 0,
          transform: 'translateX(-50%)',
        }}
      >
        <svg width="14" height="13" viewBox="0 0 14 13" className="flex-shrink-0">
          <rect x="1" y="1" width="12" height="8" rx="1.2" fill="none" stroke="rgb(107, 114, 128)" strokeWidth="1.1" />
          <line x1="7" y1="9" x2="7" y2="11" stroke="rgb(107, 114, 128)" strokeWidth="1" />
          <line x1="4" y1="11" x2="10" y2="11" stroke="rgb(107, 114, 128)" strokeWidth="1" />
        </svg>
        <span className="text-xs font-medium text-gray-600">舞台</span>
      </div>
    </div>
  );

  const renderStageBottom = () => (
    <div className="relative h-8 mt-3" style={{ width: `${totalWidth}px` }}>
      <div
        className="absolute flex items-center gap-1.5 px-3 py-1 bg-gray-100 rounded-full border border-gray-300 whitespace-nowrap"
        style={{
          left: `${stageX}px`,
          top: 0,
          transform: 'translateX(-50%)',
        }}
      >
        <svg width="14" height="13" viewBox="0 0 14 13" className="flex-shrink-0">
          <rect x="1" y="1" width="12" height="8" rx="1.2" fill="none" stroke="rgb(107, 114, 128)" strokeWidth="1.1" />
          <line x1="7" y1="9" x2="7" y2="11" stroke="rgb(107, 114, 128)" strokeWidth="1" />
          <line x1="4" y1="11" x2="10" y2="11" stroke="rgb(107, 114, 128)" strokeWidth="1" />
        </svg>
        <span className="text-xs font-medium text-gray-600">舞台</span>
      </div>
    </div>
  );

  const getSeatClass = (row: number, col: number) => {
    const key = `R${row}-C${col}`;
    const blocked = previewBlocked.has(key);
    const booked = !blocked && previewBooked.has(key);
    const bookedType = booked ? (previewTicketTypes[key] ?? 'adult') : null;
    const isHovered = hoveredSeat?.row === row && hoveredSeat?.col === col;

    let baseCls = 'relative flex items-center justify-center transition-all select-none cursor-pointer ';

    if (blocked) {
      baseCls += 'bg-red-400 text-white hover:bg-red-500';
    } else if (bookedType) {
      baseCls += `${PREVIEW_BOOKED_CLS[bookedType]} hover:brightness-110`;
    } else {
      baseCls += 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200';
    }

    if (isHovered && !disabled) {
      baseCls += ' scale-105';
    }

    return baseCls;
  };

  const getSeatContent = (row: number, col: number) => {
    const key = `R${row}-C${col}`;
    const blocked = previewBlocked.has(key);
    const booked = !blocked && previewBooked.has(key);
    const bookedType = booked ? (previewTicketTypes[key] ?? 'adult') : null;

    if (blocked) return '×';
    if (bookedType) return PREVIEW_BOOKED_LABEL[bookedType];
    return col + 1;
  };

  return (
    <div className="flex justify-center">
      <div className="border border-gray-100 rounded-xl p-4 bg-gray-50">
        <div className="overflow-x-auto">
          <div className="inline-block">
            {screenDirection === 'top' && renderStage()}
            <div className="space-y-1">
              {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="flex items-center" style={{ gap: `${SEAT_GAP}px` }}>
                  <span
                    className="text-[10px] font-bold text-gray-400 flex-shrink-0 flex items-center justify-center"
                    style={{ width: `${ROW_LABEL_WIDTH}px`, height: `${SEAT_HEIGHT}px` }}
                  >
                    {String.fromCharCode(65 + r)}
                  </span>
                  <div className="flex" style={{ gap: `${SEAT_GAP}px` }}>
                    {Array.from({ length: cols }, (_, c) => {
                      const key = `R${r}-C${c}`;
                      const blocked = previewBlocked.has(key);
                      const booked = !blocked && previewBooked.has(key);
                      const bookedType = booked ? (previewTicketTypes[key] ?? 'adult') : null;

                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => !disabled && onSeatClick(r, c)}
                          disabled={disabled}
                          onMouseEnter={() => setHoveredSeat({ row: r, col: c })}
                          onMouseLeave={() => setHoveredSeat(null)}
                          onTouchStart={() => !disabled && setHoveredSeat({ row: r, col: c })}
                          onTouchEnd={() => setHoveredSeat(null)}
                          title={
                            blocked
                              ? '已屏蔽，点击解除'
                              : booked
                              ? `已售出（${bookedType === 'adult' ? '成人票' : bookedType === 'child' ? '儿童票' : '优待票'}），点击管理`
                              : '点击屏蔽'
                          }
                          className={`${getSeatClass(r, c)} text-[10px] font-bold rounded-lg shadow-sm`}
                          style={{
                            width: `${SEAT_WIDTH}px`,
                            height: `${SEAT_HEIGHT}px`,
                          }}
                        >
                          {getSeatContent(r, c)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {screenDirection === 'bottom' && renderStageBottom()}
          </div>
        </div>
      </div>
    </div>
  );
}