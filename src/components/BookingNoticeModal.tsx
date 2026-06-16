import { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';

const COUNTDOWN = 3;

export default function BookingNoticeModal({
  notice,
  onConfirm,
  onAbort,
}: {
  notice: string;
  onConfirm: () => void;
  onAbort: () => void;
}) {
  const [secs, setSecs] = useState(COUNTDOWN);

  useEffect(() => {
    if (secs <= 0) return;
    const id = setTimeout(() => setSecs(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secs]);

  const canProceed = secs === 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onAbort}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-sky-500 to-cyan-500 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <FileText size={16} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-white text-base leading-tight">订票须知</h2>
              <p className="text-white/70 text-[11px] mt-0.5">Booking Notice</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onAbort}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/25 text-white transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Notice content */}
        <div className="px-5 pt-4 pb-2 max-h-[45vh] overflow-y-auto">
          {notice.includes('<') ? (
            <div className="quill-content text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: notice }} />
          ) : (
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{notice}</p>
          )}
        </div>

        {/* Progress bar */}
        <div className="mx-5 mt-3 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-sky-400 rounded-full transition-all duration-1000 ease-linear"
            style={{ width: canProceed ? '100%' : `${((COUNTDOWN - secs) / COUNTDOWN) * 100}%` }}
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-4">
          <button
            type="button"
            onClick={canProceed ? onConfirm : undefined}
            disabled={!canProceed}
            className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
              canProceed
                ? 'bg-sky-500 hover:bg-sky-400 active:scale-[0.98] text-white shadow-sm cursor-pointer'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed select-none'
            }`}
          >
            {canProceed ? '我已阅读，继续下单' : `请仔细阅读（${secs}s）`}
          </button>
          <p className="text-center text-[11px] text-gray-400 mt-2">
            点击右上角 × 或此页以外区域可退出下单流程
          </p>
        </div>
      </div>
    </div>
  );
}
