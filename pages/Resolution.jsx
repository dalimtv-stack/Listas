import { useState } from "react";

export default function ResolutionChecker() {
  const [url, setUrl] = useState("");
  const [resolutions, setResolutions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCheck = async () => {
    setLoading(true);
    setError("");
    setResolutions([]);

    try {
      const res = await fetch(`/api/resolution?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResolutions(data.resolutions);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-bold mb-4">M3U8 Resolution Checker</h1>
      <input
        type="text"
        placeholder="Introduce la URL del stream (.m3u8)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full max-w-xl p-3 rounded bg-neutral-800 border border-neutral-700 focus:outline-none mb-3"
      />
      <button
        onClick={handleCheck}
        disabled={loading || !url}
        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-white font-semibold disabled:bg-neutral-700"
      >
        {loading ? "Analizando..." : "Analizar resolución"}
      </button>

      {error && <p className="mt-4 text-red-400">{error}</p>}

      {resolutions.length > 0 && (
        <div className="mt-6 bg-neutral-800 p-4 rounded-lg w-full max-w-md">
          <h2 className="text-lg font-semibold mb-2">Resolutions encontradas:</h2>
          <ul className="list-disc pl-6 space-y-1">
            {resolutions.map((r, i) => (
              <li key={i}>{r.label} ({r.width}x{r.height})</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
