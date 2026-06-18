import { useState, useEffect } from 'react';
import { supabase, uploadImageViaFunction } from '../../lib/supabase';
import { X, Save, Image, Trash2, Bold, Italic, List, Link, Undo, Redo } from 'lucide-react';

export default function RechargeSettings({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<{
    id: string;
    banner_image: string | null;
    description: string;
    enabled: boolean;
  } | null>(null);
  const [description, setDescription] = useState('');
  const [bannerImage, setBannerImage] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showToast, setShowToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const { data } = await supabase.from('recharge_settings').select('*').single();
      if (data) {
        setSettings(data);
        setDescription(data.description || '');
        setBannerImage(data.banner_image || null);
        setEnabled(data.enabled);
      }
    } catch {
      setDescription('无法获取充值设置，请稍后重试');
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const { url, error } = await uploadImageViaFunction(file, 'recharge_banners');
    setUploading(false);

    if (error) {
      setShowToast({ msg: '图片上传失败', type: 'error' });
    } else if (url) {
      setBannerImage(url);
      setShowToast({ msg: '图片上传成功', type: 'success' });
    }
    setTimeout(() => setShowToast(null), 3000);
  }

  function removeImage() {
    setBannerImage(null);
  }

  function insertFormat(format: string) {
    const textarea = document.querySelector('#recharge-description') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = description.substring(start, end);

    let before = description.substring(0, start);
    let after = description.substring(end);
    let newText = '';

    switch (format) {
      case 'bold':
        newText = before + '**' + selectedText + '**' + after;
        break;
      case 'italic':
        newText = before + '*' + selectedText + '*' + after;
        break;
      case 'list':
        newText = before + '\n- ' + selectedText + after;
        break;
      case 'link':
        newText = before + '[' + selectedText + '](url)' + after;
        break;
    }

    setDescription(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + format.length + 2, end + format.length + 2);
    }, 0);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (settings) {
        await supabase.from('recharge_settings').update({
          banner_image: bannerImage,
          description: description.trim(),
          enabled,
          updated_at: new Date().toISOString(),
        }).eq('id', settings.id);
      } else {
        await supabase.from('recharge_settings').insert({
          banner_image: bannerImage,
          description: description.trim(),
          enabled,
        });
      }
      setShowToast({ msg: '保存成功', type: 'success' });
      fetchSettings();
    } catch {
      setShowToast({ msg: '保存失败', type: 'error' });
    }
    setSaving(false);
    setTimeout(() => setShowToast(null), 3000);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {showToast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
          showToast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {showToast.msg}
        </div>
      )}

      <div className="bg-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10 border-b border-gray-100">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <X size={18} className="text-gray-600" />
        </button>
        <span className="font-semibold text-gray-900">充值说明设置</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Banner图片</h3>
          {bannerImage ? (
            <div className="relative rounded-xl overflow-hidden">
              <img src={bannerImage} alt="充值Banner" className="w-full h-40 object-cover" />
              <button
                onClick={removeImage}
                className="absolute top-2 right-2 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-lg flex items-center justify-center transition-colors"
              >
                <Trash2 size={16} className="text-white" />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-amber-300 hover:bg-amber-50 transition-colors">
              <Image size={24} className="text-gray-400 mb-2" />
              <span className="text-sm text-gray-500">点击上传Banner图片</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
            </label>
          )}
          <p className="text-xs text-gray-400 mt-2">支持 JPG、PNG 格式，建议尺寸 600×300</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">充值说明内容</h3>
          <div className="flex items-center gap-1 mb-2 p-2 bg-gray-50 rounded-lg">
            <button onClick={() => insertFormat('bold')} className="p-1.5 hover:bg-white rounded transition-colors" title="加粗">
              <Bold size={16} className="text-gray-600" />
            </button>
            <button onClick={() => insertFormat('italic')} className="p-1.5 hover:bg-white rounded transition-colors" title="斜体">
              <Italic size={16} className="text-gray-600" />
            </button>
            <button onClick={() => insertFormat('list')} className="p-1.5 hover:bg-white rounded transition-colors" title="列表">
              <List size={16} className="text-gray-600" />
            </button>
            <button onClick={() => insertFormat('link')} className="p-1.5 hover:bg-white rounded transition-colors" title="链接">
              <Link size={16} className="text-gray-600" />
            </button>
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <button className="p-1.5 hover:bg-white rounded transition-colors" title="撤销" disabled>
              <Undo size={16} className="text-gray-300" />
            </button>
            <button className="p-1.5 hover:bg-white rounded transition-colors" title="重做" disabled>
              <Redo size={16} className="text-gray-300" />
            </button>
          </div>
          <textarea
            id="recharge-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={8}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            placeholder="请输入充值说明内容..."
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-gray-400">支持 Markdown 格式：**粗体**、*斜体*、- 列表、[链接](url)</span>
            <span className="text-xs text-gray-400">{description.length} 字</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <label className="flex items-center justify-between w-full cursor-pointer">
            <div>
              <p className="font-medium text-gray-900">启用充值说明</p>
              <p className="text-xs text-gray-400">关闭后用户将无法查看充值说明页面</p>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              className={`w-12 h-6 rounded-full transition-colors relative ${enabled ? 'bg-amber-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${enabled ? 'left-7' : 'left-1'}`} />
            </button>
          </label>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h4 className="font-medium text-amber-800 mb-2">预览说明</h4>
          <p className="text-xs text-amber-700">
            1. Banner图片将显示在充值说明页面顶部<br/>
            2. 说明内容支持 Markdown 格式，用户端会自动渲染<br/>
            3. 如内容较复杂，请添加充值联系方式
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || uploading}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          <Save size={16} />
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  );
}
