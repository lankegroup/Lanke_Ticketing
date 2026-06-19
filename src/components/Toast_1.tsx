type Props = {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  onClose?: () => void;
};

const colors = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

export default function Toast({ message, type = 'info', onClose }: Props) {
  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90vw] px-4 py-3 rounded-xl border shadow-lg flex items-center gap-2 text-sm font-medium animate-fade-in ${colors[type]}`}>
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100 text-lg leading-none">&times;</button>
      )}
    </div>
  );
}
