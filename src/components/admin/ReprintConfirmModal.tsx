import { AlertTriangle } from 'lucide-react';

export default function ReprintConfirmModal({
  show,
  reprintCount,
  onConfirm,
  onCancel,
}: {
  show: boolean;
  reprintCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 text-center">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-2">补打确认</h3>
          <p className="text-gray-600 text-sm">
            当前是第 <span className="font-bold text-red-500">{reprintCount}</span> 次补打，是否继续？
          </p>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-3 bg-red-500 hover:bg-red-400 text-white rounded-xl text-sm font-bold transition-colors"
          >
            确认补打
          </button>
        </div>
      </div>
    </div>
  );
}