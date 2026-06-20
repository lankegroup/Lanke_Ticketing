import { useState, useEffect } from 'react';

export interface RefundPreview {
  success: boolean;
  registration_id: string;
  session_name: string;
  ticket_code: string;
  payment_type: 'lcoin' | 'rmb' | 'mixed';
  rmb_pay_amount: number;
  lcoin_pay_amount: number;
  total_amount: number;
  penalty_rate: number;
  penalty_amount: number;
  lcoin_exchange_rate: number;
  refund_lcoin_amount: number;
  refund_rmb_amount: number;
  description: string;
  hours_before: number;
  can_release_seat: boolean;
  refund_fee: number;
  actual_refund_amount: number;
}

interface Props {
  role: 'user' | 'admin';
  title: string;
  preview: RefundPreview;
  isEn: boolean;
  onConfirm: (customPenalty?: number) => void;
  onCancel: () => void;
}

export default function CancelConfirmModal({ role, title, preview, isEn, onConfirm, onCancel }: Props) {
  const [customPenalty, setCustomPenalty] = useState<string>('');

  useEffect(() => {
    if (preview) {
      setCustomPenalty(String(preview.penalty_amount ?? 0));
    }
  }, [preview]);

  const adminPenaltyNum = parseFloat(customPenalty) || 0;
  
  const calculatedRefund = (penalty: number) => {
    const { lcoin_pay_amount, rmb_pay_amount, lcoin_exchange_rate } = preview;
    let refundLcoin = 0;
    let refundRmb = 0;
    
    if (lcoin_pay_amount >= penalty) {
      refundLcoin = lcoin_pay_amount - penalty;
      refundRmb = rmb_pay_amount;
    } else {
      refundLcoin = 0;
      refundRmb = rmb_pay_amount - ((penalty - lcoin_pay_amount) * lcoin_exchange_rate);
      if (refundRmb < 0) refundRmb = 0;
    }
    
    return {
      refundLcoin,
      refundRmb,
      total: refundLcoin + (refundRmb / lcoin_exchange_rate)
    };
  };

  const finalPenalty = role === 'admin' ? adminPenaltyNum : (preview.penalty_amount ?? 0);
  const finalRefund = calculatedRefund(finalPenalty);

  const showRmbSection = preview.payment_type === 'rmb' || preview.payment_type === 'mixed';
  const showLcoinSection = preview.payment_type === 'lcoin' || preview.payment_type === 'mixed';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-800 mb-4">{title}</h3>
        
        {preview.description && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
            {preview.description}
          </div>
        )}

        <div className="space-y-3 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">{isEn ? 'Session' : '场次'}</span>
            <span className="text-gray-700 font-medium">{preview.session_name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">{isEn ? 'Ticket Code' : '票号'}</span>
            <span className="text-gray-700 font-medium">{preview.ticket_code}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">{isEn ? 'Payment Type' : '支付方式'}</span>
            <span className="text-gray-700 font-medium">
              {preview.payment_type === 'lcoin' ? (isEn ? 'L-Coin' : '兰克币') : 
               preview.payment_type === 'rmb' ? (isEn ? 'RMB' : '人民币') : 
               (isEn ? 'Mixed' : '混合支付')}
            </span>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-3">{isEn ? 'Payment Details' : '支付详情'}</p>
          {showLcoinSection && (
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-500">{isEn ? 'L-Coin Paid' : '兰克币实付'}</span>
              <span className="text-gray-700 font-medium">{preview.lcoin_pay_amount.toFixed(2)} {isEn ? 'LC' : '兰克币'}</span>
            </div>
          )}
          {showRmbSection && (
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-500">{isEn ? 'RMB Paid' : '人民币实付'}</span>
              <span className="text-gray-700 font-medium">¥{preview.rmb_pay_amount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-medium pt-2 border-t border-gray-100">
            <span className="text-gray-700">{isEn ? 'Total' : '合计'}</span>
            <span className="text-gray-900 font-bold">{preview.total_amount.toFixed(2)} {isEn ? 'LC' : '兰克币'}</span>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-3">{isEn ? 'Refund Details' : '退款详情'}</p>
          
          {role === 'admin' && (
            <div className="mb-3">
              <label className="block text-sm text-gray-600 mb-1">{isEn ? 'Custom Penalty Amount' : '自定义手续费金额'}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={customPenalty}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomPenalty(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={isEn ? 'Enter penalty amount' : '输入手续费金额'}
              />
            </div>
          )}
          
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-500">{isEn ? 'Refund Fee' : '退票手续费'}</span>
            <span className="text-red-600 font-medium">-{finalPenalty.toFixed(2)} {isEn ? 'LC' : '兰克币'}</span>
          </div>
          
          {showLcoinSection && finalRefund.refundLcoin > 0 && (
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-500">{isEn ? 'Refund L-Coin' : '退还兰克币'}</span>
              <span className="text-emerald-600 font-medium">+{finalRefund.refundLcoin.toFixed(2)} {isEn ? 'LC' : '兰克币'}</span>
            </div>
          )}
          {showRmbSection && finalRefund.refundRmb > 0 && (
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-500">{isEn ? 'Refund RMB' : '退还人民币'}</span>
              <span className="text-emerald-600 font-medium">+¥{finalRefund.refundRmb.toFixed(2)}</span>
            </div>
          )}
          
          <div className="flex justify-between text-sm font-medium pt-2 border-t border-gray-100">
            <span className="text-gray-700">{isEn ? 'Actual Refund' : '实际退还金额'}</span>
            <span className="text-emerald-600 font-bold">{finalRefund.total.toFixed(2)} {isEn ? 'LC' : '兰克币'}</span>
          </div>
        </div>

        {!preview.can_release_seat && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-sm text-gray-600">
            {isEn ? 'Note: Seats will not be released as sales have ended.' : '注意：售票已截止，座位将不归还票池。'}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {isEn ? 'Cancel' : '取消'}
          </button>
          <button
            onClick={() => onConfirm(role === 'admin' ? adminPenaltyNum : undefined)}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
          >
            {isEn ? 'Confirm Cancellation' : '确认取消'}
          </button>
        </div>
      </div>
    </div>
  );
}