import type { YouTubeSearchResult } from '../shared/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 免 API key 的 YouTube 搜索：请求搜索结果页，解析页面内置的 ytInitialData。
 * YouTube 改版可能导致解析失效，所有解析路径都做了容错，失败返回空数组。
 */
export async function searchYouTube(query: string): Promise<YouTubeSearchResult[]> {
  const res = await fetch(
    'https://www.youtube.com/results?search_query=' + encodeURIComponent(query),
    { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' } }
  )
  if (!res.ok) return []
  const html = await res.text()
  const m = html.match(/var ytInitialData = (.+?);<\/script>/s)
  if (!m) return []

  let data: any
  try {
    data = JSON.parse(m[1])
  } catch {
    return []
  }

  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
      ?.contents ?? []
  const out: YouTubeSearchResult[] = []
  for (const section of sections) {
    for (const item of section?.itemSectionRenderer?.contents ?? []) {
      const v = item?.videoRenderer
      if (!v?.videoId) continue
      out.push({
        videoId: String(v.videoId),
        title: (v.title?.runs ?? []).map((r: any) => r?.text ?? '').join(''),
        channel: v.ownerText?.runs?.[0]?.text ?? '',
        duration: v.lengthText?.simpleText ?? '',
        thumbnail: v.thumbnail?.thumbnails?.[0]?.url ?? ''
      })
      if (out.length >= 20) return out
    }
  }
  return out
}
