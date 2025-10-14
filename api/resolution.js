// api/resolution.js
import { useState } from "react";
import Hls from "hls.js";

export default function ResolutionChecker() {
  const [url, setUrl] = useState("");
  const [resolutions, setResolutions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCheck = async () => {
    setError("");
    setResolutions([]);
    setLoading(true);

    try {
      if (!Hls.isSupported()) {
        setError("Tu navegador no soporta HLS.js");
        setLoading(false);
        return;
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error("No se pudo acceder al stream");
      const text = await response.text();

      // Analizar el contenido del m3u8 para obtener las resoluciones
      const regex = /RESOLUTION=(\d+x\d+)/g;
      const matches = [...text.matchAll(regex)].map(m => m[1]);
      const unique = [...new Set(matches)];

      setResolutions(unique);
    } catch (err) {
      setError("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center p-6 min-h-screen bg-gray-900 text-white">
      <h1 className="text-2xl font-bold mb-4">Comprobador de Resolución M3U8</h1>
      <input
        type="text"
        placeholder="Introduce la URL del stream .m3u8"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full max-w-xl p-2 rounded bg-gray-800 border border-gray-700 mb-4"
      />
      <button
        onClick={handleCheck}
        disabled={loading || !url}
        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded disabled:opacity-50"
      >
        {loading ? "Analizando..." : "Comprobar resoluciones"}
      </button>

      {error && <p className="mt-4 text-red-400">{error}</p>}

      {resolutions.length > 0 && (
        <div className="mt-6 w-full max-w-md bg-gray-800 p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Resoluciones detectadas:</h2>
          <ul className="list-disc pl-6">
            {resolutions.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
