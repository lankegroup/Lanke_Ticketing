import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, uploadImageViaFunction, Announcement } from '../../lib/supabase';
import { Plus, Edit3, Trash2, Eye, EyeOff, ArrowLeft, Image, X } from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import Toast from '../Toast';

type EditorMode = 'list' | 'edit' | 'new';

export default function ContentPublishing() {
  const { t } = useTranslation();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [mode, setMode] = useState<EditorMode>('list');
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => { fetchAnnouncements(); }, []);

  async function fetchAnnouncements() {
    const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
    setAnnouncements(data ?? []);
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) { showToast(t('operation_failed'), 'error'); return; }
    showToast(t('delete_success'));
    setConfirm(null);
    fetchAnnouncements();
  }

  async function handleTogglePublish(a: Announcement) {
    await supabase.from('announcements').update({ is_published: !a.is_published }).eq('id', a.id);
    fetchAnnouncements();
  }

  function startEdit(a: Announcement) {
    setEditing({ ...a });
    setMode('edit');
  }

  function startNew() {
    setEditing({ id: '', title: '', content: '', cover_image: null, is_published: true, created_at: '', updated_at: '' });
    setMode('new');
  }

  if (mode === 'edit' || mode === 'new') {
    return (
      <AnnouncementEditor
        initial={editing!}
        isNew={mode === 'new'}
        onSave={() => { setMode('list'); fetchAnnouncements(); showToast(t('save_success')); }}
        onCancel={() => setMode('list')}
      />
    );
  }

  return (
    <div className="p-4 space-y-4">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {confirm && (
        <ConfirmDialog
          title={t('confirm_delete')}
          message={t('confirm_delete_msg')}
          onConfirm={() => handleDelete(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{t('content')}</h2>
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium px-3 py-2 rounded-xl transition-colors"
        >
          <Plus size={16} /> {t('new_announcement')}
        </button>
      </div>

      {announcements.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileTextIcon />
          <p className="text-sm mt-2">{t('no_data')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map(a => (
            <div key={a.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {a.cover_image && (
                <img src={a.cover_image} alt="" className="w-full h-32 object-cover" />
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900 text-sm flex-1 line-clamp-2">{a.title}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                    a.is_published ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {a.is_published ? t('publish') : t('draft')}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-3">{new Date(a.created_at).toLocaleDateString()}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => startEdit(a)}
                    className="flex items-center gap-1 text-xs text-sky-600 border border-sky-200 px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors"
                  >
                    <Edit3 size={12} /> {t('edit')}
                  </button>
                  <button
                    onClick={() => handleTogglePublish(a)}
                    className="flex items-center gap-1 text-xs text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {a.is_published ? <EyeOff size={12} /> : <Eye size={12} />}
                    {a.is_published ? t('draft') : t('publish')}
                  </button>
                  <button
                    onClick={() => setConfirm(a.id)}
                    className="flex items-center gap-1 text-xs text-red-500 border border-red-200 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={12} /> {t('delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileTextIcon() {
  return (
    <svg className="w-12 h-12 mx-auto text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function AnnouncementEditor({
  initial, isNew, onSave, onCancel,
}: { initial: Announcement; isNew: boolean; onSave: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial.title);
  const [isPublished, setIsPublished] = useState(initial.is_published);
  const [coverImage, setCoverImage] = useState(initial.cover_image ?? '');
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const quillInstance = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([import('quill'), import('quill/dist/quill.snow.css')]).then(([{ default: Quill }]) => {
      if (!editorRef.current || quillInstance.current) return;
      quillInstance.current = new Quill(editorRef.current, {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['link', 'image'],
            [{ color: [] }],
            ['clean'],
          ],
        },
      });
      quillInstance.current.root.innerHTML = initial.content;
    });
    return () => {};
  }, []);

  async function handleImageUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setUploadError('');
    const { url, error } = await uploadImageViaFunction(file, 'covers');
    if (error || !url) {
      setUploadError(`上传失败：${error ?? '未知错误'}`);
    } else {
      setCoverImage(url);
    }
    setUploadingImage(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSave() {
    const htmlContent = quillInstance.current?.root.innerHTML ?? initial.content;
    setSaving(true);
    if (isNew) {
      const { error } = await supabase.from('announcements').insert({
        title, content: htmlContent, is_published: isPublished, cover_image: coverImage || null,
      });
      if (!error) onSave();
    } else {
      const { error } = await supabase.from('announcements').update({
        title, content: htmlContent, is_published: isPublished, cover_image: coverImage || null,
      }).eq('id', initial.id);
      if (!error) onSave();
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <h2 className="flex-1 font-semibold text-gray-900 text-sm">
          {isNew ? t('new_announcement') : t('edit_announcement')}
        </h2>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <div
            onClick={() => setIsPublished(!isPublished)}
            className={`w-9 h-5 rounded-full transition-colors relative ${isPublished ? 'bg-sky-500' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${isPublished ? 'left-4' : 'left-0.5'}`} />
          </div>
          {isPublished ? t('publish') : t('draft')}
        </label>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
        >
          {saving ? '...' : t('save')}
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('announcement_title')}</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('announcement_title')}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">封面图片</label>
          <div className="flex items-center gap-3">
            {coverImage && (
              <div className="relative">
                <img src={coverImage} alt="" className="w-20 h-14 object-cover rounded-lg" />
                <button onClick={() => setCoverImage('')} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5">
                  <X size={10} />
                </button>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-xs text-sky-600 border border-sky-200 px-3 py-2 rounded-xl cursor-pointer hover:bg-sky-50 transition-colors">
                <Image size={14} />
                {uploadingImage ? '上传中...' : '上传图片'}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('announcement_content')}</label>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div ref={editorRef} style={{ minHeight: 300 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
