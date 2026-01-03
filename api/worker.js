// Stalker-Portal To M3U Generator Script
// Created by: @tg_aadi
// Modified for Vercel Edge Runtime

// ============ ⚙ CONFIGURATION ============
const config = {
    host: "tv.stream4k.cc",          // example.com (NO http/https)
    mac_address: "00:1A:79:00:44:91",
    serial_number: "9519BD4B1036B",
    device_id: "B7D9BFFDB1BB3757EB3E6A6D20437EC812DD5BF518BF622FD51998F464AFA027",
    device_id_2: "B7D9BFFDB1BB3757EB3E6A6D20437EC812DD5BF518BF622FD51998F464AFA027",
    stb_type: "MAG250",
    api_signature: "263"
};

// ================== UTILS ==================
async function hash(str) {
    const data = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest("MD5", data);
    return [...new Uint8Array(digest)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

async function generateHardwareVersions() {
    config.hw_version =
        "1.7-BD-" + (await hash(config.mac_address)).slice(0, 2).toUpperCase();
    config.hw_version_2 = await hash(
        config.serial_number.toLowerCase() +
        config.mac_address.toLowerCase()
    );
}

function logDebug(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

function getHeaders(token = "") {
    const h = {
        "Cookie": `mac=${config.mac_address}; stb_lang=en; timezone=GMT`,
        "Referer": `http://${config.host}/stalker_portal/c/`,
        "User-Agent":
            "Mozilla/5.0 (QtEmbedded; Linux; MAG200) stbapp ver: 2 rev: 250",
        "X-User-Agent": `Model: ${config.stb_type}; Link: WiFi`
    };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
}

// ================== AUTH ==================
async function getToken() {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
    const r = await fetch(url, { headers: getHeaders() });
    const t = await r.text();
    return JSON.parse(t)?.js?.token || "";
}

async function auth(token) {
    const metrics = encodeURIComponent(JSON.stringify({
        mac: config.mac_address, type: "STB"
    }));

    const url =
        `http://${config.host}/stalker_portal/server/load.php?type=stb&action=get_profile` +
        `&hd=1&sn=${config.serial_number}&stb_type=${config.stb_type}` +
        `&device_id=${config.device_id}&device_id2=${config.device_id_2}` +
        `&hw_version=${config.hw_version}&hw_version_2=${config.hw_version_2}` +
        `&metrics=${metrics}&api_signature=${config.api_signature}&JsHttpRequest=1-xml`;

    const r = await fetch(url, { headers: getHeaders(token) });
    return JSON.parse(await r.text())?.js || {};
}

async function handshake(token) {
    const url =
        `http://${config.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=${token}&JsHttpRequest=1-xml`;
    const r = await fetch(url, { headers: getHeaders() });
    return JSON.parse(await r.text())?.js?.token || "";
}

async function getAccountInfo(token) {
    const url =
        `http://${config.host}/stalker_portal/server/load.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`;
    const r = await fetch(url, { headers: getHeaders(token) });
    return JSON.parse(await r.text())?.js || {};
}

// ================== IPTV ==================
async function getGenres(token) {
    const url =
        `http://${config.host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
    const r = await fetch(url, { headers: getHeaders(token) });
    return JSON.parse(await r.text())?.js || [];
}

async function getStreamURL(id, token) {
    const url =
        `http://${config.host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=ffrt http://localhost/ch/${id}&JsHttpRequest=1-xml`;
    const r = await fetch(url, { headers: getHeaders(token) });
    return JSON.parse(await r.text())?.js?.cmd || "";
}

// ================== CORE ==================
async function genToken() {
    await generateHardwareVersions();
    const t1 = await getToken();
    if (!t1) return {};
    const profile = await auth(t1);
    const t2 = await handshake(t1);
    const account = await getAccountInfo(t2);
    return { token: t2, profile, account };
}

async function jsonToM3U(channels, profile, account, req) {
    const origin = new URL(req.url).origin;
    let out = [
        "#EXTM3U",
        `# Total Channels => ${channels.length}`,
        "# Script => @tg_aadi",
        ""
    ];

    channels.forEach(c => {
        out.push(
            `#EXTINF:-1 tvg-id="${c.xmltv_id || ""}" tvg-name="${c.name}" tvg-logo="${c.logo}" group-title="${c.group}",${c.name}`
        );
        out.push(`${origin}/${c.cmd}.m3u8`);
    });

    return out.join("\n");
}

// ================== HANDLER ==================
async function handleRequest(req) {
    const url = new URL(req.url);
    const last = url.pathname.split("/").pop();

    const { token, profile, account } = await genToken();
    if (!token) return new Response("Auth failed", { status: 500 });

    // PLAYLIST
    if (url.pathname.endsWith("playlist.m3u8")) {
        const chUrl =
            `http://${config.host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
        const r = await fetch(chUrl, { headers: getHeaders(token) });
        const data = JSON.parse(await r.text());

        const genres = await getGenres(token);
        const gmap = {};
        genres.forEach(g => (gmap[g.id] = g.title));

        const channels = (data.js?.data || []).map(i => ({
            name: i.name,
            cmd: i.cmd.replace("ffrt http://localhost/ch/", ""),
            xmltv_id: i.xmltv_id,
            logo: i.logo
                ? `http://${config.host}/stalker_portal/misc/logos/320/${i.logo}`
                : "",
            group: gmap[i.tv_genre_id] || "Other"
        }));

        return new Response(await jsonToM3U(channels, profile, account, req), {
            headers: { "Content-Type": "application/vnd.apple.mpegurl" }
        });
    }

    // STREAM REDIRECT
    if (last.endsWith(".m3u8")) {
        const id = last.replace(".m3u8", "");
        const stream = await getStreamURL(id, token);
        return Response.redirect(stream, 302);
    }

    return new Response("Not Found", { status: 404 });
}

// ================== VERCEL EDGE EXPORT ==================
export default {
    fetch: handleRequest
};
