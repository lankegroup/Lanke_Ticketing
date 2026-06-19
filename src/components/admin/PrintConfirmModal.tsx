import { useState } from 'react';
import { X, Printer, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export interface PrintConfirmResult {
  serviceFee: number;
  paidAt: string;
  printedAt: string;
  paymentMethod: 'rmb' | 'lcoin';
}

export default function PrintConfirmModal({
  ticketCode,
  ticketPrice,
  defaultServiceFee = 0,
  userId,
  userBalance = 0,
  sessionId,
  onConfirm,
  onCancel,
}: {
  ticketCode?: string;
  ticketPrice?: number;
  defaultServiceFee?: number;
  userId?: string;
  userBalance?: number;
  sessionId?: string;
  onConfirm: (result: PrintConfirmResult) => void;
  onCancel: () => void;
}) {
  const [feeInput, setFeeInput] = useState(defaultServiceFee > 0 ? String(defaultServiceFee) : '0');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'rmb' | 'lcoin'>('rmb');
  const [deducting, setDeducting] = useState(false);
  const [deductError, setDeductError] = useState('');

  const fee = parseFloat(feeInput) || 0;
  const total = (ticketPrice ?? 0) + fee;
  const canUseLcoin = !!userId && userBalance >= total;

  async function handleConfirm() {
    if (!paymentConfirmed) return;
    setDeductError('');

    // 兰克币支付：先扣除兰克币
    if (paymentMethod === 'lcoin' && userId && total > 0) {
      if (userBalance < total) {
        setDeductError(`余额不足！当前余额 ${userBalance} LC，需支付 ${total} LC`);
        return;
      }
      setDeducting(true);
      const deductResult = await supabase.rpc('create_lcoin_transaction', {
        p_user_id: userId,
        p_transaction_type: 'purchase',
        p_amount: total,
        p_session_id: sessionId || null,
        p_operator_type: 'front_desk',
        p_description: `打印票面扣款：${ticketCode || ''}`,
        p_payment_method: 'lcoin',
      });
      setDeducting(false);
      const deductData = deductResult.data as any;
      if (!deductData?.success) {
        setDeductError(deductData?.error || '兰克币扣款失败，请重试');
        return;
      }
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    onConfirm({ serviceFee: fee, paidAt: ts, printedAt: ts, paymentMethod });
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
              <Printer size={16} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-white text-base leading-tight">收费确认</h2>
              <p className="text-white/70 text-[11px] mt-0.5">Payment & Print Confirmation</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/25 text-white transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {ticketCode && (
            <div className="bg-gray-50 rounded-xl px-4 py-2 text-center">
              <p className="text-xs text-gray-400 mb-0.5">票号</p>
              <p className="font-mono font-bold text-gray-700 tracking-widest">{ticketCode}</p>
            </div>
          )}

          {/* Price breakdown */}
          <div className="space-y-2">
            {ticketPrice !== undefined && ticketPrice > 0 && (
              <div className="flex items-center justify-between bg-sky-50 rounded-xl px-4 py-2.5">
                <span className="text-sm text-gray-600">票价</span>
                <span className="font-semibold text-sky-700">¥{ticketPrice.toFixed(2)}</span>
              </div>
            )}

            {/* Service fee input */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">手续费金额（元）</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">¥</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={feeInput}
                  onChange={e => setFeeInput(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl pl-8 pr-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Total */}
            {ticketPrice !== undefined && (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
                <span className="text-sm font-semibold text-gray-700">合计</span>
                <span className="font-bold text-emerald-700 text-lg">
                  {paymentMethod === 'lcoin' ? `${total.toFixed(2)} LC` : `¥${total.toFixed(2)}`}
                </span>
              </div>
            )}
          </div>

          {/* Payment method selection */}
          {userId && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-600">支付方式</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('rmb')}
                  className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
                    paymentMethod === 'rmb'
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  ¥ 人民币
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('lcoin')}
                  disabled={!canUseLcoin}
                  className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
                    paymentMethod === 'lcoin'
                      ? 'border-amber-400 bg-amber-50 text-amber-700'
                      : canUseLcoin
                        ? 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'
                        : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  LC 兰克币
                  <span className="block text-[10px] font-normal mt-0.5">
                    {canUseLcoin ? `余额 ${userBalance} LC` : '余额不足'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Payment confirmation */}
          <button
            type="button"
            onClick={() => setPaymentConfirmed(v => !v)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
              paymentConfirmed
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-gray-200 bg-gray-50 hover:border-gray-300'
            }`}
          >
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              paymentConfirmed ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'
            }`}>
              {paymentConfirmed && <CheckCircle2 size={12} className="text-white" />}
            </div>
            <span className={`text-sm font-medium ${paymentConfirmed ? 'text-emerald-700' : 'text-gray-600'}`}>
              {paymentMethod === 'lcoin' ? '确认从账户扣除兰克币' : '确认已收到付款'}
            </span>
          </button>

          {deductError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{deductError}</div>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!paymentConfirmed || deducting}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              paymentConfirmed && !deducting
                ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Printer size={14} />
            {deducting ? '扣款中...' : paymentMethod === 'lcoin' ? '确认扣款并生成' : '确认已付款并生成'}
          </button>
        </div>
      </div>
    </div>
  );
}
