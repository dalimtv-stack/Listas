const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

async function getChannels(m3uUrl) {
    if (!m3uUrl) throw new Error("No se ha configurado la URL de la lista M3U");

    const res = await fetch(m3uUrl);
    if (!res.ok) throw new Error(`Error al descargar M3U: ${res.statusText}`);

    const text = await res.text();
    const playlist = parse(text);

    // Devuelve los canales como array limpio
    return playlist.items.map(item => ({
        name: item.name,
        url: item.url,
        logo: item.tvg.logo || null
    }));
}

module.exports = { getChannels };
