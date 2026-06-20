import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export type CancelPreviewData = {
  original_lcoin: number;
  original_cash: number;
  penalty_rate: number;
  penalty_amount: number;
  refund_amount: number;
  description: string;
  hours_before: number;
  has_cash_payment: boolean;
  session_name?: string;
  ticket_code?: string;
};

type Props = {
  role: 'user' | 'admin';
  title?: string;
  preview: CancelPreviewData | null;
  isEn: boolean;
  onConfirm: (customPenaltyAmount?: number) => void;
  onCancel: () => void;
};

export default function CancelConfirmModal({ role, title, preview, isEn, onConfirm, onCancel }: Props) {
  const [customPenalty, setCustomPenalty] = useState<string>('');

  const displayPenalty = preview?.penalty_amount ?? 0;
  const displayOriginal = preview?.original_lcoin ?? 0;
  const displayRefund = preview?.refund_amount ?? 0;

  useEffect(() => {
    if (preview) {
      setCustomPenalty(String(preview.penalty_amount ?? 0));
    }
  }, [preview]);

  const adminPenaltyNum = parseFloat(customPenalty) || 0;
  const adminRefund = displayOriginal - adminPenaltyNum;

  const finalPenalty = role === 'admin' ? adminPenaltyNum : displayPenalty;
  const finalRefund = role === 'admin' ? adminRefund : displayRefund;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={20} className="text-amber-500" />
          <h3 className="text-lg font-semibold text-gray-900">
            {title || (isEn ? 'Cancel Booking' : '取消订单')}
          </h3>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          {isEn ? 'Are you sure you want to cancel this order? Please review the refund details below.' : '确认取消该订单吗？请查看以下退票费明细。'}
        </p>

        {preview && (
          <div className="bg-gray-50 rounded-xl p-4 space-y-3 mb-5">
            {/* Ticket info (admin only) */}
            {role === 'admin' && preview.ticket_code && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{isEn ? 'Ticket Code' : '订单号'}</span>
                <span className="font-mono text-gray-700">{preview.ticket_code}</span>
              </div>
            )}

            {/* Original amount */}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">{isEn ? 'Original Amount' : '订单原价'}</span>
              <span className="font-semibold text-gray-700">{displayOriginal.toFixed(2)} {isEn ? 'LC' : '兰克币'}</span>
            </div>

            {/* Penalty rate description */}
            {preview.description && (
              <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1.5">
                {preview.description}
              </div>
            )}

            {/* Penalty amount - user readonly / admin editable */}
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{isEn ? 'Deduction Fee' : '扣除退票费'}</span>
              {role === 'user' ? (
                <span className="font-semibold text-red-600">-{displayPenalty.toFixed(2)} {isEn ? 'LC' : '兰克币'}</span>
              ) : (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customPenalty}
                    onChange={e => setCustomPenalty(e.target.value)}
                    className="w-20 text-right text-sm border border-gray-200 rounded-lg px-2 py-1 text-red-600 font-semibold focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                  <span className="text-xs text-gray-400">{isEn ? 'LC' : '兰克币'}</span>
                </div>
              )}
            </div>

            {/* Refund amount */}
            <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
              <span className="text-gray-700 font-medium">{isEn ? 'Actual Refund' : '实际退还金额'}</span>
              <span className="font-bold text-emerald-600">{finalRefund.toFixed(2)} {isEn ? 'LC' : '兰克币'}</span>
            </div>

            {/* Cash payment warning */}
            {preview.has_cash_payment && (
              <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1.5">
                {isEn ? 'Cash payment requires manual refund processing by admin.' : '现金部分需联系管理员处理。'}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors"
          >
            {isEn ? 'Never Mind' : '我再想想'}
          </button>
          <button
            onClick={() => onConfirm(role === 'admin' ? finalPenalty : undefined)}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-medium text-sm hover:bg-red-600 transition-colors"
          >
            {isEn ? 'Confirm Cancel' : '确认取消'}
          </button>
        </div>
      </div>
    </div>
  );
}
