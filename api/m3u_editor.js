// pages/editor.js
import { useState, useEffect } from 'react';

export default function M3UEditor() {
  const [m3u, setM3u] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Cargar M3U al iniciar
  useEffect(() => {
    fetch('/api/m3u')
      .then(r => r.text())
      .then(setM3u)
      .finally(() => setLoading(false));
  }, []);

  const guardar = async () => {
    setSaving(true);
    await fetch('/api/m3u', {
      method: 'POST',
      body: m3u
    });
    setSaving(false);
    alert('¡Lista guardada en GitHub!');
  };

  if (loading) return <p class="text-white">Cargando...</p>;

  return (
    <div class="min-h-screen bg-black text-white p-8 font-mono">
      <h1 class="text-3xl mb-4">Editor M3U - Heimdallr</h1>
      <textarea
        value={m3u}
        onChange={e => setM3u(e.target.value)}
        class="w-full h-96 bg-gray-900 text-green-400 p-4 rounded"
      />
      <button
        onClick={guardar}
        disabled={saving}
        class="mt-4 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded"
      >
        {saving ? 'Guardando...' : 'Guardar en GitHub'}
      </button>
    </div>
  );
}
