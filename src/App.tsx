import React, { useState } from 'react';
import { Search, Download, Music, Disc, User, PlayCircle } from 'lucide-react';

interface Song {
  id: string;
  name: string;
  artist: string;
  album: string;
  isOriginal?: boolean;
  previewUrl?: string;
  trackViewUrl?: string;
  source?: 'bilibili' | 'mock';
}

const mockData: Song[] = [
  { id: '1', name: '青花瓷', artist: '周杰伦', album: '时长: 03:59', source: 'mock' },
  { id: '2', name: '起风了', artist: '买辣椒也用券', album: '时长: 05:06', source: 'mock' },
];

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Song[]>(mockData);
  const [aiRecommendation, setAiRecommendation] = useState<{ song: string, artist: string } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const getCleanFileName = (title: string, author: string, query: string) => {
    let clean = title
      .replace(/【.*?】/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .replace(/（.*?）/g, ' ')
      .replace(/\(.*?\)/g, ' ')
      .replace(/[《》]/g, ' ')
      .replace(/(?:官方|正式版|首播|超清|高清|修复版|中英字幕|中字|4K|1080P|Live|翻唱|现场|字幕|无损|音频|纯音乐|高音质|MV|动画版|重制版)/ig, ' ')
      .trim();

    clean = clean.replace(/\s{2,}/g, ' ').replace(/^[-—\s]+|[-—\s]+$/g, '');

    if (!clean || clean.length < 2) {
      if (!query) return author || 'download';
      return `${query} - ${author}`;
    }
    
    // 如果清理后的标题看起来没有歌手名称（比如不包含短横线），作为保底可以主动加上
    if (!clean.includes('-') && !clean.includes('—') && author && clean.length < 30) {
      return `${clean} - ${author}`;
    }

    return clean;
  };

  const handleDownload = async (song: Song) => {
    setDownloadingId(song.id);
    try {
      // 提取文件名
      const fileName = getCleanFileName(song.name, song.artist, searchQuery);
      
      // 通过后端提取 B站音频的真实流，然后直接 pipe 过来，前端获取 blob
      const response = await fetch(`/api/bilibili-download/${song.id}`);
      if (!response.ok) throw new Error('提取失败');
      
      const blob = await response.blob();
      
      // 创建一个临时的 Object URL
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${fileName}.mp3`;
      
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      alert('音频提取或下载失败，请稍后重试');
      console.error(error);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setResults(mockData);
      return;
    }
    
    setIsSearching(true);
    
    try {
      const response = await fetch(`/api/bilibili-search?keyword=${encodeURIComponent(searchQuery)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          setResults(data.results);
          setAiRecommendation(data.aiRecommendation || null);
        } else {
          setResults([]);
          setAiRecommendation(null);
        }
      } else {
        setResults([]);
        setAiRecommendation(null);
      }
    } catch (error) {
      console.error('Bilibili API failed:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-800 font-sans selection:bg-blue-100">
      {/* Header Area */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            
            {/* Logo / Title */}
            <div className="flex items-center gap-3">
              <div className="bg-blue-500 text-white p-2 rounded-xl shadow-sm">
                <Music className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">音乐搜索</h1>
                <p className="text-sm text-neutral-500 mt-0.5">发现你喜欢的旋律</p>
              </div>
            </div>

            {/* Search Form */}
            <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
              <div className="relative flex items-center">
                <Search className="absolute left-3.5 w-5 h-5 text-neutral-400" />
                <input
                  type="text"
                  placeholder="搜索歌曲名、歌手或专辑..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-24 py-2.5 bg-neutral-100 border-transparent rounded-full focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all outline-none text-sm placeholder:text-neutral-400"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="absolute right-1.5 px-4 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded-full transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isSearching ? '搜索中...' : '搜索'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* AI Recommendation Banner */}
        {aiRecommendation && aiRecommendation.artist && (
          <div className="mb-6 px-5 py-3 bg-blue-50/50 border border-blue-100 rounded-xl flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500/10 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-sm text-blue-800">
              已为您自动锁定原唱：<span className="font-semibold">{aiRecommendation.song}</span> — <span className="font-semibold">{aiRecommendation.artist}</span>
            </p>
          </div>
        )}

        {/* Results Table Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          
          <div className="px-6 py-5 border-b border-neutral-100 flex items-center justify-between bg-white">
            <h2 className="text-base font-medium text-neutral-800">
              {searchQuery ? `搜索结果 (${results.length})` : '推荐歌曲'}
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-neutral-50/80 text-neutral-500 text-sm">
                <tr>
                  <th scope="col" className="px-6 py-4 font-medium">歌曲名</th>
                  <th scope="col" className="px-6 py-4 font-medium hidden sm:table-cell">歌手</th>
                  <th scope="col" className="px-6 py-4 font-medium hidden md:table-cell">专辑</th>
                  <th scope="col" className="px-6 py-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {isSearching ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`skeleton-${i}`} className="animate-pulse">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-5 h-5 bg-neutral-200 rounded-full" />
                          <div className="h-4 bg-neutral-200 rounded w-48" />
                        </div>
                      </td>
                      <td className="px-6 py-4 hidden sm:table-cell">
                        <div className="h-4 bg-neutral-200 rounded w-24" />
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <div className="h-4 bg-neutral-200 rounded w-32" />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="h-8 bg-neutral-200 rounded-lg w-20 ml-auto" />
                      </td>
                    </tr>
                  ))
                ) : results.length > 0 ? (
                  results.map((song) => (
                    <tr 
                      key={song.id} 
                      className="hover:bg-blue-50/50 transition-colors group"
                    >
                      {/* Song Name */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <button 
                            className="text-neutral-400 hover:text-blue-500 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                            onClick={() => song.previewUrl && window.open(song.previewUrl, '_blank')}
                            title="试听"
                          >
                            <PlayCircle className="w-5 h-5" />
                          </button>
                          <div className="flex flex-wrap items-center gap-2 py-1">
                            <span className="font-medium text-neutral-900 whitespace-normal break-words leading-tight">{song.name}</span>
                            {song.isOriginal && (
                              <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white bg-blue-500 rounded-md uppercase whitespace-nowrap self-start mt-0.5">
                                推荐原唱
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Mobile supplementary info (hidden on normal screens) */}
                        <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500 sm:hidden pl-8">
                          <span>{song.artist}</span>
                          <span>•</span>
                          <span className="truncate max-w-[120px]">{song.album}</span>
                        </div>
                      </td>
                      
                      {/* Artist (hidden on mobile) */}
                      <td className="px-6 py-4 hidden sm:table-cell">
                        <div className="flex items-center gap-2 text-neutral-600 text-sm">
                          <User className="w-4 h-4 text-neutral-400" />
                          {song.artist}
                        </div>
                      </td>
                      
                      {/* Album (hidden on smaller screens) */}
                      <td className="px-6 py-4 hidden md:table-cell">
                        <div className="flex items-center gap-2 text-neutral-600 text-sm">
                          <Disc className="w-4 h-4 text-neutral-400" />
                          {song.album}
                        </div>
                      </td>
                      
                      {/* Action */}
                      <td className="px-6 py-4 text-right">
                        <button 
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => handleDownload(song)}
                          disabled={downloadingId === song.id}
                          title={song.source === 'mock' ? '下载' : '下载完整音频'}
                        >
                          <Download className={`w-4 h-4 ${downloadingId === song.id ? 'animate-bounce' : ''}`} />
                          <span className="hidden sm:inline">
                            {downloadingId === song.id 
                              ? '提取中...' 
                              : song.source === 'mock' ? '下载' : '下载完整版'}
                          </span>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-20 text-center text-neutral-500">
                      <div className="flex flex-col items-center justify-center space-y-3">
                        <Music className="w-10 h-10 text-neutral-300" />
                        <p>没有找到相关歌曲，请换个关键词试试。</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
