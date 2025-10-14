import fetch from "node-fetch";

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Falta la URL del stream" });

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Error al acceder al stream (${response.status})`);
    const text = await response.text();

    const regex = /RESOLUTION=(\d+)x(\d+)/g;
    const resolutions = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      resolutions.push({
        width: parseInt(match[1]),
        height: parseInt(match[2]),
        label: `${match[2]}p`,
      });
    }

    if (!resolutions.length) {
      return res.json({ resolutions: [{ label: "No se detectaron resoluciones" }] });
    }

    // Eliminar duplicados
    const unique = [...new Map(resolutions.map(r => [r.label, r])).values()];

    res.json({ resolutions: unique });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
