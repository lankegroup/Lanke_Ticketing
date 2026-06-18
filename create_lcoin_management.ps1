$content = @'
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { X, Search, Plus, Minus, User, Package, History, Save, Trash2, AlertCircle } from 'lucide-react';

type Tab = 'users' | 'packages' | 'transactions';

export default function LcoinManagement({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [userBalances, setUserBalances] = useState<Map<string, number>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustType, setAdjustType] = useState<'add' | 'subtract'>('add');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);

  const [packages, setPackages] = useState<any[]>([]);
  const [newPackage, setNewPackage] = useState({ name: '', price: '', lcoin_amount: '', description: '' });
  const [editingPackage, setEditingPackage] = useState<any>(null);
  const [savingPackage, setSavingPackage] = useState(false);

  const [transactions, setTransactions] = useState<any[]>([]);
  const [transactionUser, setTransactionUser] = useState('');
  const [loadingTransactions, setLoadingTransactions] = useState(true);

  useEffect(() => {
    fetchUsers();
    fetchPackages();
    fetchTransactions();
  }, []);

  async function fetchUsers() {
    const { data } = await supabase.from('user_profiles').select('id, display_name, phone, email');
    setUsers(data || []);
    fetchBalances(data || []);
  }

  async function fetchBalances(userList: any[]) {
    const balances = new Map<string, number>();
    for (const user of userList) {
      const { data } = await supabase.rpc('get_user_balance', { p_user_id: user.id });
      balances.set(user.id, data ? Number(data) : 0);
    }
    setUserBalances(balances);
  }

  async function fetchPackages() {
    const { data } = await supabase.from('recharge_packages').select('*').order('price');
    setPackages(data || []);
  }

  async function fetchTransactions() {
    setLoadingTransactions(true);
    let query = supabase.from('balance_transactions').select('*, user_profiles(display_name, phone)').order('created_at', { ascending: false });
    if (transactionUser) {
      query = query.eq('user_id', transactionUser);
    }
    const { data } = await query.limit(100);
    setTransactions(data || []);
    setLoadingTransactions(false);
  }

  async function handleAdjust() {
    if (!selectedUser || !adjustAmount || parseFloat(adjustAmount) <= 0) return;
    setAdjusting(true);
    try {
      const amount = parseFloat(adjustAmount);
      const actualAmount = adjustType === 'subtract' ? -amount : amount;
      if (adjustType === 'add') {
        await supabase.rpc('admin_recharge_lcoin', {
          p_user_id: selectedUser.id,
          p_amount: amount,
          p_description: adjustReason || '管理员充值',
        });
      } else {
        const deductResult = await supabase.rpc('deduct_lcoin', {
          p_user_id: selectedUser.id,
          p_amount: amount,
          p_description: adjustReason || '管理员扣款',
        });
        if (!deductResult.data) throw new Error('余额不足');
      }
      userBalances.set(selectedUser.id, (userBalances.get(selectedUser.id) || 0) + actualAmount);
      setUserBalances(new Map(userBalances));
      alert(adjustType === 'add' ? '充值成功' : '扣款成功');
      setShowAdjustModal(false);
      setAdjustAmount('');
      setAdjustReason('');
    } catch (err: any) {
      alert(err.message || '操作失败');
    }
    setAdjusting(false);
  }

  async function savePackage() {
    setSavingPackage(true);
    try {
      if (editingPackage) {
        await supabase.from('recharge_packages').update({
          name: newPackage.name,
          price: parseFloat(newPackage.price),
          lcoin_amount: parseFloat(newPackage.lcoin_amount),
          description: newPackage.description,
        }).eq('id', editingPackage.id);
      } else {
        await supabase.from('recharge_packages').insert({
          name: newPackage.name,
          price: parseFloat(newPackage.price),
          lcoin_amount: parseFloat(newPackage.lcoin_amount),
          description: newPackage.description,
          is_active: true,
        });
      }
      fetchPackages();
      setNewPackage({ name: '', price: '', lcoin_amount: '', description: '' });
      setEditingPackage(null);
      alert('保存成功');
    } catch {
      alert('保存失败');
    }
    setSavingPackage(false);
  }

  async function deletePackage(id: string) {
    if (!confirm('确定删除该套餐？')) return;
    await supabase.from('recharge_packages').delete().eq('id', id);
    fetchPackages();
  }

  const filteredUsers = users.filter(u =>
    u.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.phone?.includes(searchTerm) ||
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10 border-b border-gray-100">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <X size={18} className="text-gray-600" />
        </button>
        <span className="font-semibold text-gray-900">兰克币管理</span>
      </div>

      <div className="flex border-b border-gray-200 bg-white">
        <button onClick={() => setTab('users')} className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${tab === 'users' ? 'text-amber-600 border-b-2 border-amber-500' : 'text-gray-500 hover:text-gray-700'}`}>
          <User size={16} /> 用户管理
        </button>
        <button onClick={() => setTab('packages')} className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${tab === 'packages' ? 'text-amber-600 border-b-2 border-amber-500' : 'text-gray-500 hover:text-gray-700'}`}>
          <Package size={16} /> 充值套餐
        </button>
        <button onClick={() => setTab('transactions')} className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${tab === 'transactions' ? 'text-amber-600 border-b-2 border-amber-500' : 'text-gray-500 hover:text-gray-700'}`}>
          <History size={16} /> 交易流水
        </button>
      </div>

      {tab === 'users' && (
        <div className="p-4 space-y-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="搜索用户名/手机号/邮箱" className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div className="space-y-2">
            {filteredUsers.map(user => (
              <div key={user.id} className="bg-white rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{user.display_name || '未设置昵称'}</p>
                  <p className="text-xs text-gray-400">{user.phone || user.email || '无联系方式'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-lg font-bold text-amber-500">{userBalances.get(user.id) || 0}</p>
                    <p className="text-xs text-gray-400">兰克币</p>
                  </div>
                  <button onClick={() => { setSelectedUser(user); setShowAdjustModal(true); }} className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                    充值/扣款
                  </button>
                </div>
              </div>
            ))}
            {filteredUsers.length === 0 && (
              <div className="bg-white rounded-xl p-8 text-center text-gray-400">
                <User size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无用户</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'packages' && (
        <div className="p-4 space-y-4">
          <button onClick={() => { setEditingPackage(null); setNewPackage({ name: '', price: '', lcoin_amount: '', description: '' }); }} className="w-full bg-amber-500 hover:bg-amber-400 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            <Plus size={16} /> 新增套餐
          </button>
          <div className="space-y-2">
            {packages.map(pkg => (
              <div key={pkg.id} className="bg-white rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-900">{pkg.name}</h4>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setEditingPackage(pkg); setNewPackage({ name: pkg.name, price: String(pkg.price), lcoin_amount: String(pkg.lcoin_amount), description: pkg.description || '' }); }} className="text-sky-500 text-sm hover:text-sky-600">编辑</button>
                    <button onClick={() => deletePackage(pkg.id)} className="text-red-500 text-sm hover:text-red-600 flex items-center gap-1"><Trash2 size={14} /> 删除</button>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500">价格：<span className="font-medium text-gray-900">{pkg.price}</span> 元</span>
                  <span className="text-gray-500">兰克币：<span className="font-bold text-amber-500">{pkg.lcoin_amount}</span></span>
                </div>
                {pkg.description && <p className="text-xs text-gray-400 mt-2">{pkg.description}</p>}
              </div>
            ))}
            {packages.length === 0 && (
              <div className="bg-white rounded-xl p-8 text-center text-gray-400">
                <Package size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无充值套餐</p>
              </div>
            )}
          </div>
          {(editingPackage || newPackage.name || newPackage.price) && (
            <div className="bg-white rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-gray-900">{editingPackage ? '编辑套餐' : '新增套餐'}</h3>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">套餐名称</label><input value={newPackage.name} onChange={e => setNewPackage({ ...newPackage, name: e.target.value })} placeholder="如：100兰克币套餐" className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-gray-500 mb-1">价格（元）</label><input type="number" value={newPackage.price} onChange={e => setNewPackage({ ...newPackage, price: e.target.value })} placeholder="0" className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" /></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">兰克币数量</label><input type="number" value={newPackage.lcoin_amount} onChange={e => setNewPackage({ ...newPackage, lcoin_amount: e.target.value })} placeholder="0" className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" /></div>
              </div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">描述</label><textarea value={newPackage.description} onChange={e => setNewPackage({ ...newPackage, description: e.target.value })} placeholder="套餐说明..." rows={2} className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" /></div>
              <button onClick={savePackage} disabled={savingPackage} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2">
                <Save size={14} /> {savingPackage ? '保存中...' : '保存'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'transactions' && (
        <div className="p-4 space-y-4">
          <select value={transactionUser} onChange={e => { setTransactionUser(e.target.value); fetchTransactions(); }} className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
            <option value="">全部用户</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.phone || u.email}</option>)}
          </select>
          {loadingTransactions ? (
            <div className="py-8 text-center text-gray-400 text-sm">加载中...</div>
          ) : (
            <div className="space-y-2">
              {transactions.map(t => (
                <div key={t.id} className="bg-white rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${t.transaction_type === 'recharge' ? 'bg-emerald-100 text-emerald-700' : t.transaction_type === 'purchase' ? 'bg-red-100 text-red-700' : t.transaction_type === 'refund' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                      {t.transaction_type === 'recharge' ? '充值' : t.transaction_type === 'purchase' ? '消费' : t.transaction_type === 'refund' ? '退款' : '管理员调整'}
                    </span>
                    <span className={`text-lg font-bold ${(t.transaction_type === 'recharge' || t.transaction_type === 'refund') ? 'text-emerald-500' : 'text-red-500'}`}>
                      {(t.transaction_type === 'recharge' || t.transaction_type === 'refund') ? '+' : '-'}
                      {t.amount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{t.user_profiles?.display_name || '未知用户'}</span>
                    <span>{new Date(t.created_at).toLocaleString()}</span>
                  </div>
                  {t.description && <p className="text-xs text-gray-500 mt-1">{t.description}</p>}
                  <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
                    <span>余额变动：{t.balance_before} → {t.balance_after}</span>
                  </div>
                </div>
              ))}
              {transactions.length === 0 && (
                <div className="bg-white rounded-xl p-8 text-center text-gray-400">
                  <History size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无交易记录</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showAdjustModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">充值/扣款</h3>
              <button onClick={() => setShowAdjustModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="bg-amber-50 rounded-xl p-4">
              <p className="text-sm text-gray-500 mb-1">当前用户</p>
              <p className="font-semibold text-gray-900">{selectedUser.display_name || '未设置昵称'}</p>
              <p className="text-xs text-gray-400">{selectedUser.phone || selectedUser.email}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-sm text-gray-500 mb-1">当前余额</p>
              <p className="text-2xl font-bold text-amber-500">{userBalances.get(selectedUser.id) || 0} 兰克币</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAdjustType('add')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1 ${adjustType === 'add' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                <Plus size={14} /> 充值
              </button>
              <button onClick={() => setAdjustType('subtract')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1 ${adjustType === 'subtract' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                <Minus size={14} /> 扣款
              </button>
            </div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">金额</label><input type="number" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder="输入兰克币数量" className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" /></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">备注</label><input value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="可选，如：客服处理" className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" /></div>
            {adjustType === 'subtract' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">扣款将直接从用户余额中扣除，请确保余额充足</p>
              </div>
            )}
            <button onClick={handleAdjust} disabled={adjusting || !adjustAmount || parseFloat(adjustAmount) <= 0} className={`w-full py-3 rounded-xl font-semibold transition-colors ${adjustType === 'add' ? 'bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-300' : 'bg-red-500 hover:bg-red-400 disabled:bg-gray-300'} text-white disabled:opacity-60`}>
              {adjusting ? '处理中...' : (adjustType === 'add' ? '确认充值' : '确认扣款')}
            </button>
            <button onClick={() => setShowAdjustModal(false)} className="w-full py-2 text-gray-500 text-sm hover:text-gray-700">取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
'@
[System.IO.File]::WriteAllText("c:\Users\10623\Desktop\project\src\components\admin\LcoinManagement.tsx", $content, [System.Text.Encoding]::UTF8)
Write-Output