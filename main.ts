import { Hono } from "npm:hono";
import { serveStatic } from "npm:hono/deno";
import { GoogleGenAI as AntigravityGenAI } from "npm:@google/genai";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

// 1. AI & ENV Setup
const aiApiKey = Deno.env.get("GEMINI_API_KEY");
const aiAnti = aiApiKey ? new AntigravityGenAI({
  apiKey: aiApiKey,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
}) : null;
const aiLegacy = aiApiKey ? new GoogleGenerativeAI(aiApiKey) : null;

const aiCache = new Map();

async function getAiRecommendation(keyword: string) {
  const cleanKeyword = keyword.trim().toLowerCase();
  if (aiCache.has(cleanKeyword)) return aiCache.get(cleanKeyword);
  if (!aiApiKey) return { song: keyword, artist: "" };

  const prompt = `Task: Identify the original artist for the song: "${keyword}".
  Strict Output Format: {"song": "Exact Song Name", "artist": "Exact Artist Name"}
  Constraint: If unknown, leave artist empty. No extra text. JSON ONLY.`;

  const withTimeout = (promise: Promise<any>, ms: number) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
    ]);
  };

  if (aiAnti) {
    try {
      const interactionPromise = aiAnti.interactions.create({
        model: "gemini-1.5-flash",
        input: prompt,
      });
      const interaction = await withTimeout(interactionPromise, 4000);
      const text = interaction.output_text;
      if (text) {
        const match = text.match(/\{.*\}/s);
        if (match) {
          const data = JSON.parse(match[0]);
          if (data.artist && data.artist.length > 0) {
            aiCache.set(cleanKeyword, data);
            return data;
          }
        }
      }
    } catch (e) { console.warn("AI 1 partial failed:", e.message); }
  }

  if (aiLegacy) {
    try {
      const model = aiLegacy.getGenerativeModel({ model: "gemini-1.5-flash" });
      const resultPromise = model.generateContent(prompt);
      const result = await withTimeout(resultPromise, 4000);
      const text = result.response.text();
      const match = text.match(/\{.*\}/s);
      if (match) {
        const data = JSON.parse(match[0]);
        if (data.artist) {
          aiCache.set(cleanKeyword, data);
          return data;
        }
      }
    } catch (e) { console.warn("AI 2 fallback failed:", e.message); }
  }
  return { song: keyword, artist: "" };
}

const app = new Hono();

const BILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/110.0',
  'Referer': 'https://www.bilibili.com'
};

// 2. API Routes
app.get('/api/bilibili-search', async (c) => {
  const keyword = c.req.query('keyword');
  if (!keyword) return c.json({ error: 'Keyword required' }, 400);

  try {
    const aiRecPromise = getAiRecommendation(keyword);
    const searchFor = (q: string) => {
      const url = `https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(q)}&search_type=video`;
      return fetch(url, { headers: BILI_HEADERS });
    };

    const aiRec = await aiRecPromise;
    const searchKeyword = aiRec.artist ? `${aiRec.song} ${aiRec.artist} MV Audio` : `${keyword} 官方 原唱 MV`;

    const response = await searchFor(searchKeyword);
    let videos = [];
    if (response.ok) {
      const d = await response.json();
      if (d.code === 0 && d.data?.items?.archive) videos = d.data.items.archive;
    }

    if (videos.length === 0) {
      const fb = await searchFor(`${keyword} 官方`);
      if (fb.ok) {
        const d = await fb.json();
        if (d.code === 0 && d.data?.items?.archive) videos = d.data.items.archive;
      }
    }

    const JUNK = ['搞笑', '春晚', '鬼畜', '盘点', '绿幕', '翻唱', 'cover', '改编', '教程', '集锦', '合集', '表情包'];
    const isDurationValid = (d: string) => {
      const p = d.split(':').map(Number);
      let s = 0;
      if (p.length === 2) s = p[0] * 60 + p[1];
      else if (p.length === 3) s = p[0] * 3600 + p[1] * 60 + p[2];
      return s >= 60 && s <= 600;
    };

    const filtered = [];
    for (const v of videos.slice(0, 30)) {
      const title = v.title.replace(/<[^>]+>/g, '').toLowerCase();
      if (JUNK.some(k => title.includes(k))) continue;
      if (!isDurationValid(v.duration)) continue;
      filtered.push({ ...v, bvid: v.bvid || v.param });
    }

    const getScore = (t: string, a: string, p: number, q: string, aiA: string) => {
      let s = 0;
      const lt = t.toLowerCase();
      const la = a.toLowerCase();
      const aa = aiA.toLowerCase();
      if (lt.includes('官方') || lt.includes('official')) s += 30000;
      if (lt.includes('mv')) s += 15000;
      if (lt.includes('原唱') || lt.includes('original')) s += 20000;
      if (aa && (la.includes(aa) || lt.includes(aa))) s += 60000;
      if (p > 100000) s += 5000;
      if (p > 1000000) s += 10000;
      return s;
    };

    filtered.sort((a, b) => getScore(b.title, b.author, b.play, keyword, aiRec.artist) - getScore(a.title, a.author, a.play, keyword, aiRec.artist));

    return c.json({
      aiRecommendation: aiRec,
      results: filtered.map(v => ({
        id: v.bvid,
        name: v.title.replace(/<[^>]+>/g, ''),
        artist: v.author,
        duration: v.duration,
        playCount: v.play,
        cover: v.pic.startsWith('//') ? `https:${v.pic}` : v.pic,
        url: `https://www.bilibili.com/video/${v.bvid}`,
        isOriginal: (aiRec.artist && (v.author.toLowerCase().includes(aiRec.artist.toLowerCase()) || v.title.toLowerCase().includes(aiRec.artist.toLowerCase()))) || v.title.includes('官方')
      }))
    });
  } catch (error) {
    return c.json({ error: 'Search failed' }, 500);
  }
});

// 3. Static Assets & SPA Fallback
// In Deno Deploy, we serve from dist folder
app.use('/*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));

Deno.serve(app.fetch);

export default app;
