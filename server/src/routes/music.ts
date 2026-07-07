import { Router } from 'express';
import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = join(__dirname, '..', '..', 'music');

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma']);

const router = Router();

/** 获取音乐文件列表 */
router.get('/tracks', (_req, res) => {
  try {
    let files: string[];
    try {
      files = readdirSync(MUSIC_DIR);
    } catch {
      return res.json({ tracks: [] });
    }

    const tracks = files
      .filter(f => AUDIO_EXTS.has(extname(f).toLowerCase()))
      .map((f, i) => {
        const ext = extname(f);
        const name = f.slice(0, -ext.length);
        // 支持 "歌手 - 歌名.mp3" 格式
        const dashIdx = name.indexOf(' - ');
        const artist = dashIdx !== -1 ? name.slice(0, dashIdx).trim() : '未知';
        const title = dashIdx !== -1 ? name.slice(dashIdx + 3).trim() : name;
        let size = 0;
        try { size = statSync(join(MUSIC_DIR, f)).size; } catch { /* ignore */ }
        return {
          id: `server-${i}`,
          name: title,
          artist,
          src: `/api/music/files/${encodeURIComponent(f)}`,
          size,
        };
      });

    res.json({ tracks });
  } catch (err) {
    console.error('[Music] 获取曲目列表失败:', err);
    res.status(500).json({ error: '获取曲目列表失败' });
  }
});

export default router;
