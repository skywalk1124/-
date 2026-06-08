import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import crypto from 'crypto';
import { GoogleGenAI as AntigravityGenAI } from "@google/genai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const aiApiKey = process.env.GEMINI_API_KEY;
if (!aiApiKey) {
  console.warn("GEMINI_API_KEY is missing! AI features will be disabled.");
}

// SDK 1: Antigravity (Preferred)
const aiAnti = aiApiKey ? new AntigravityGenAI({
  apiKey: aiApiKey,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
}) : null;

// SDK 2: Legacy Generative AI (Fallback for 403s)
const aiLegacy = aiApiKey ? new GoogleGenerativeAI(aiApiKey) : null;

// Simple cache for AI recommendations
const aiCache = new Map<string, { song: string, artist: string }>();

async function getOriginalArtist(keyword: string) {
  const cleanKeyword = keyword.trim().toLowerCase();
  if (aiCache.has(cleanKeyword)) return aiCache.get(cleanKeyword);

  if (!aiApiKey) return { song: keyword, artist: "" };

  const prompt = `Task: Identify the original artist for the song: "${keyword}".
  Strict Output Format: {"song": "Exact Song Name", "artist": "Exact Artist Name"}
  Constraint: If unknown, leave artist empty. No extra text. JSON ONLY.`;

  // Helper to wait for timeout
  const withTimeout = (promise: Promise<any>, ms: number) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
    ]);
  };

  // Try Antigravity first
  if (aiAnti) {
    try {
      const interactionPromise = aiAnti.interactions.create({
        model: "gemini-1.5-flash", // Use stable model
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
    } catch (e) {
      console.warn("Antigravity AI fallback triggered:", e instanceof Error ? e.message : "Error");
    }
  }

  // Fallback to Legacy SDK
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
    } catch (e) {
      console.warn("Legacy AI fallback failed:", e instanceof Error ? e.message : "Error");
    }
  }

  return { song: keyword, artist: "" };
}

async function createServer() {
  const app = express();
  
  // Bilibili 通用请求头
  const BILI_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/110.0',
    'Cookie': 'buvid3=fakebuvid;'
  };

  // 1. Bilibili App Search API (跳过极严 Web WAF，且自带更好拼写纠错)
  app.get('/api/bilibili-search', async (req, res) => {
    let keyword = req.query.keyword as string;
    if (!keyword) {
      res.status(400).json({ error: 'Keyword required' });
      return;
    }

    try {
      // Step 1: AI identification (parallel)
      const aiRecPromise = getOriginalArtist(keyword);
      
      const appkey = '1d8b6e7d45233436';
      const appsec = '560c52ccd288fed045859ed18bffd973';
      
      const searchFor = async (kw: string) => {
        const paramsQuery = `appkey=${appkey}&build=540000&keyword=${encodeURIComponent(kw)}&mobi_app=android&ts=${Math.floor(Date.now()/1000)}`;
        const sign = crypto.createHash('md5').update(paramsQuery + appsec).digest('hex');
        const url = `https://app.bilibili.com/x/v2/search?${paramsQuery}&sign=${sign}`;
        return fetch(url, { headers: BILI_HEADERS });
      };

      // Step 2: Focused search strategy
      const aiRec = await aiRecPromise;
      
      // Determine the best search keyword
      // If AI found an artist, we use a VERY strict combination
      const searchKeyword = aiRec.artist 
        ? `${aiRec.song} ${aiRec.artist} MV Audio` 
        : `${keyword} 官方 原唱 MV`;

      const response = await searchFor(searchKeyword);
      
      let videos: any[] = [];
      if (response.ok) {
        const d = await response.json();
        if (d.code === 0 && d.data?.items?.archive) {
          videos = d.data.items.archive;
        }
      }

      // If refined search yields nothing, fallback once to slightly broader
      if (videos.length === 0) {
        const fallbackRes = await searchFor(`${keyword} 官方`);
        if (fallbackRes.ok) {
          const d = await fallbackRes.json();
          if (d.code === 0 && d.data?.items?.archive) {
            videos = d.data.items.archive;
          }
        }
      }

      const limitedVideos = videos.slice(0, 30); 

      // Hard filtering rules
      const JUNK_KEYWORDS = ['搞笑', '春晚', '鬼畜', '盘点', '绿幕', '翻唱', 'cover', '改编', '教程', '集锦', '合集', '表情包'];
      
      const isDurationValid = (durationStr: string) => {
        const parts = durationStr.split(':').map(Number);
        let seconds = 0;
        if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
        else if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        return seconds >= 60 && seconds <= 600; // 1min to 10min
      };

      // Fetch view api and apply HARD filters
      const viewPromises = limitedVideos.map(async (video: any) => {
        const title = video.title.replace(/<[^>]+>/g, '').toLowerCase();
        
        // 1. Keyword Blacklist Filter
        if (JUNK_KEYWORDS.some(k => title.includes(k))) return null;
        
        // 2. Duration Filter
        if (!isDurationValid(video.duration)) return null;

        try {
          const res = await fetch(`https://api.bilibili.com/x/web-interface/view?aid=${video.param}`, { headers: BILI_HEADERS });
          const json = await res.json();
          if (json.code === 0 && json.data) {
             return { ...video, bvid: json.data.bvid };
          }
        } catch(e) {}
        return null;
      });

      const validVideosArray = await Promise.all(viewPromises);
      const validVideos = validVideosArray.filter(v => v !== null);

      const getScore = (title: string, author: string, playCount: number, query: string, aiArtist: string) => {
        let score = 0;
        const lowerTitle = title.toLowerCase();
        const lowerAuthor = author.toLowerCase();
        const artistLower = aiArtist.toLowerCase();
        
        // Boost for official/original indicators
        if (lowerTitle.includes('官方') || lowerTitle.includes('official')) score += 30000;
        if (lowerTitle.includes('mv')) score += 15000;
        if (lowerTitle.includes('原唱') || lowerTitle.includes('original')) score += 20000;
        if (lowerAuthor.includes('vevo') || lowerAuthor.includes('official') || lowerAuthor.includes('官方')) score += 50000;
        
        // Crucial: Artist match
        if (artistLower && (lowerAuthor.includes(artistLower) || lowerTitle.includes(artistLower))) {
          score += 60000; 
        }

        // Popularity boost
        if (playCount > 100000) score += 5000;
        if (playCount > 1000000) score += 10000;
        
        return score;
      };

      // Sort
      validVideos.sort((a, b) => getScore(b.title, b.author, b.play, keyword, aiRec.artist) - getScore(a.title, a.author, a.play, keyword, aiRec.artist));

      const formattedResults = validVideos.map((video: any) => {
        const title = video.title.replace(/<[^>]+>/g, '');
        const lowerTitle = title.toLowerCase();
        const lowerAuthor = video.author.toLowerCase();
        const artistLower = aiRec.artist.toLowerCase();
        
        // Determine if this is a "Recommended Original"
        const isOfficialAccount = lowerAuthor.includes('official') || lowerAuthor.includes('官方') || lowerAuthor.includes('vevo');
        const hasOfficialTag = lowerTitle.includes('官方') || lowerTitle.includes('official') || lowerTitle.includes('mv') || lowerTitle.includes('原唱');
        const artistMatch = aiRec.artist && (lowerAuthor.includes(artistLower) || lowerTitle.includes(artistLower));
        
        // If it looks like original and NOT a cover/clip
        const isOriginal = (artistMatch || isOfficialAccount || hasOfficialTag) && 
                           !lowerTitle.includes('翻唱') && 
                           !lowerTitle.includes('cover') && 
                           !lowerTitle.includes('伴奏') &&
                           !lowerTitle.includes('片段') &&
                           !lowerTitle.includes('直播') &&
                           !lowerTitle.includes('指弹');

        return {
          id: video.bvid || video.param, 
          name: title,
          artist: video.author,
          album: `时长: ${video.duration}`,
          isOriginal: isOriginal, 
          previewUrl: `https://www.bilibili.com/video/${video.bvid || 'av' + video.param}`,
          source: 'bilibili'
        };
      });

      res.json({ results: formattedResults, aiRecommendation: aiRec });
    } catch (error) {
      console.error("Bilibili Search API error:", error);
      res.status(500).json({ error: "Failed to fetch from Bilibili" });
    }
  });

  // 2. Bilibili Audio Download API: 获取并代理 Bilibili 的音频流
  app.get('/api/bilibili-download/:id', async (req, res) => {
    const id = req.params.id;

    try {
      // 第一步：获取视频 cid，兼容 bvid 和 avid
      const isBvid = id.startsWith('BV');
      const viewApiTarget = isBvid ? `bvid=${id}` : `aid=${id}`;
      const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/view?${viewApiTarget}`, { headers: BILI_HEADERS });
      
      if (!viewRes.ok) {
        res.status(500).send("获取 cid 失败：视频接口不通");
        return;
      }
      
      const viewData = await viewRes.json();
      const cid = viewData.data?.cid;
      const extractedBvid = viewData.data?.bvid; // 必须用 bvid 请求 playurl
      if (!cid || !extractedBvid) {
        // -404 通常是被删除或不可用的视频
        res.status(404).send("获取 cid 失败：视频可能已被删除或限制");
        return;
      }

      // 第二步：获取 dash 播放信息，提取音频直链 (fnval=16)
      const playUrlRes = await fetch(`https://api.bilibili.com/x/player/playurl?fnval=16&bvid=${extractedBvid}&cid=${cid}`, { headers: BILI_HEADERS });
      const playUrlData = await playUrlRes.json();
      
      let audioUrl = playUrlData.data?.dash?.audio?.[0]?.baseUrl;
      if (!audioUrl) {
         // Fallback to general mp4 durl if dash audio is missing
         audioUrl = playUrlData.data?.durl?.[0]?.url;
      }

      if (!audioUrl) {
        res.status(404).send("未获取到音频流直链");
        return;
      }

      // 第三步：代理音频流回前端，前端可 fetch Blob
      const audioStreamRes = await fetch(audioUrl, {
        headers: {
          'User-Agent': BILI_HEADERS['User-Agent'],
          'Referer': 'https://www.bilibili.com/'
        }
      });

      if (!audioStreamRes.ok) {
        res.status(audioStreamRes.status).send("代理音频数据失败");
        return;
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-cache");
      
      // Node v18+ 使用 Web Streams 传到 res
      if (audioStreamRes.body) {
        // @ts-ignore
        for await (const chunk of audioStreamRes.body) {
          res.write(chunk);
        }
        res.end();
      } else {
        res.status(500).send("音频数据流为空");
      }
    } catch (error) {
      console.error("Download API error:", error);
      if (!res.headersSent) res.status(500).send("Bilibili 解析失败");
    }
  });

  // Vite 挂载中间件，提供 SPA 前端及 HMR 开发环境
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Vercel handles static serving if configured, but we keep this for local/docker
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        if (req.path.startsWith('/api')) return; // Don't catch API routes here
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  return app;
}

// Support both ESM and CJS for different runtimes
const appPromise = createServer();

// Vercel standard export
export default async (req: any, res: any) => {
  const app = await appPromise;
  return app(req, res);
};

// Local development / Docker start
if (process.env.NODE_ENV !== "production" || process.env.START_SERVER === "true") {
  const PORT = process.env.PORT || 3000;
  appPromise.then(app => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}
