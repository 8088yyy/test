// ✅ REQUIRED BY VERCEL (NEW EDGE SYNTAX)
export const config = {
  runtime: "edge"
};

// ======================================================================
// Stalker-Portal → M3U Generator
// Original Author: @tg_aadi
// Fixed & Adapted for Vercel Edge Functions (2025)
// ======================================================================

// ============ ⚙ CONFIG ============
const PORTAL = {
  host: "YOUR_PORTAL_DOMAIN",     // example.com (NO http/https)
  mac: "00:1A:79:XX:XX:XX",
  sn: "XXXXXXXX",
  device_id: "XXXXXXXX",
  device_id2: "XXXXXXXX",
  stb: "MAG250",
  api_sig: "263"
};

// ================== UTILS ==================
async function md5(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("MD5", buf);
  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function prepareHW() {
  PORTAL.hw1 = "1.7-BD-" + (await md5(PORTAL.mac)).slice(0, 2).toUpperCase();
  PORTAL.hw2 = await md5(PORTAL.sn.toLowerCase() + PORTAL.mac.toLowerCase());
}

const headers = (token = "") => ({
  "Cookie": `mac=${PORTAL.mac}; stb_lang=en; timezone=GMT`,
  "Referer": `http://${PORTAL.host}/stalker_portal/c/`,
  "User-Agent":
    "Mozilla/5.0 (QtEmbedded; Linux; MAG200) stbapp ver: 2 rev: 250",
  "X-User-Agent": `Model: ${PORTAL.stb}; Link: WiFi`,
  ...(token ? { Authorization: `Bearer ${token}` } : {})
});

// ================== AUTH ==================
async function getToken() {
  const r = await fetch(
    `http://${PORTAL.host}/stalker_portal/server/load.php?type=stb&action=handshake&JsHttpRequest=1-xml`,
    { headers: headers() }
  );
  return JSON.parse(await r.text())?.js?.token || "";
}

async function getProfile(token) {
  const metrics = encodeURIComponent(JSON.stringify({ mac: PORTAL.mac }));
  const url =
    `http://${PORTAL.host}/stalker_portal/server/load.php?type=stb&action=get_profile` +
    `&sn=${PORTAL.sn}&stb_type=${PORTAL.stb}` +
    `&device_id=${PORTAL.device_id}&device_id2=${PORTAL.device_id2}` +
    `&hw_version=${PORTAL.hw1}&hw_version_2=${PORTAL.hw2}` +
    `&metrics=${metrics}&api_signature=${PORTAL.api_sig}&JsHttpRequest=1-xml`;

  const r = await fetch(url, { headers: headers(token) });
  return JSON.parse(await r.text())?.js || {};
}

async function handshake(token) {
  const r = await fetch(
    `http://${PORTAL.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=${token}&JsHttpRequest=1-xml`,
    { headers: headers() }
  );
  return JSON.parse(await r.text())?.js?.token || "";
}

// ================== IPTV ==================
async function getGenres(token) {
  const r = await fetch(
    `http://${PORTAL.host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`,
    { headers: headers(token) }
  );
  return JSON.parse(await r.text())?.js || [];
}

async function getStream(id, token) {
  const r = await fetch(
    `http://${PORTAL.host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=ffrt http://localhost/ch/${id}&JsHttpRequest=1-xml`,
    { headers: headers(token) }
  );
  return JSON.parse(await r.text())?.js?.cmd || "";
}

// ================== CORE ==================
async function authAll() {
  await prepareHW();
  const t1 = await getToken();
  if (!t1) return {};
  await getProfile(t1);
  const t2 = await handshake(t1);
  return { token: t2 };
}

async function buildM3U(channels, req) {
  const base = new URL(req.url).origin;
  let m3u = ["#EXTM3U"];

  channels.forEach(c => {
    m3u.push(
      `#EXTINF:-1 tvg-id="${c.epg}" tvg-name="${c.name}" tvg-logo="${c.logo}" group-title="${c.group}",${c.name}`
    );
    m3u.push(`${base}/${c.id}.m3u8`);
  });

  return m3u.join("\n");
}

// ================== HANDLER ==================
async function handle(req) {
  const url = new URL(req.url);
  const last = url.pathname.split("/").pop();

  const { token } = await authAll();
  if (!token) return new Response("AUTH FAILED", { status: 500 });

  // PLAYLIST
  if (url.pathname.endsWith("playlist.m3u8")) {
    const r = await fetch(
      `http://${PORTAL.host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`,
      { headers: headers(token) }
    );
    const data = JSON.parse(await r.text());
    const genres = await getGenres(token);
    const gmap = {};
    genres.forEach(g => (gmap[g.id] = g.title));

    const channels = (data.js?.data || []).map(ch => ({
      id: ch.cmd.replace("ffrt http://localhost/ch/", ""),
      name: ch.name,
      epg: ch.xmltv_id || "",
      group: gmap[ch.tv_genre_id] || "Other",
      logo: ch.logo
        ? `http://${PORTAL.host}/stalker_portal/misc/logos/320/${ch.logo}`
        : ""
    }));

    return new Response(await buildM3U(channels, req), {
      headers: { "Content-Type": "application/vnd.apple.mpegurl" }
    });
  }

  // STREAM REDIRECT
  if (last.endsWith(".m3u8")) {
    const id = last.replace(".m3u8", "");
    const stream = await getStream(id, token);
    return Response.redirect(stream, 302);
  }

  return new Response("NOT FOUND", { status: 404 });
}

// ================== EXPORT ==================
export default {
  fetch: handle
};
