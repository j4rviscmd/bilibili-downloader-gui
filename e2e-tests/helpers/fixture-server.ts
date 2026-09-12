/**
 * Localhost fixture server backing the full-pipeline download E2E flow.
 *
 * Serves, under the E2E_API_BASE origin the app is pointed at
 * (see BiliApi::from_cookie_header in src-tauri/src/handlers/bilibili.rs):
 * - GET /x/web-interface/nav      → anonymous WBI mixin-key body
 * - GET /x/player/wbi/playurl     → DASH manifest whose stream baseUrls point
 *                                   back at this server's /media/* files
 * - GET/HEAD /media/video-only.mp4, /media/audio-only.mp4
 *                                   → committed real MP4 fixtures with true
 *                                     Range semantics (206 + exact
 *                                     Content-Range slicing)
 *
 * Shapes mirror the wiremock unit-test mocks (nav_wbi_mock_body /
 * mount_dash_playurl / mount_good_media in src-tauri/src/handlers/bilibili.rs),
 * which pin the backend's parsing contract.
 *
 * Range fidelity matters: the downloader verifies that Content-Range start
 * equals the requested offset and clamps probe requests (bytes=0-4194303) to
 * the real size, so a static "always full body" mock would corrupt resume
 * paths. HEAD answers the disk-space pre-check (head_content_length).
 */

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory holding the committed media fixtures (see generate-media.sh). */
const MEDIA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'media',
)

/** Media bodies pre-read once; fixtures are tiny and served per request. */
const MEDIA: Record<string, Buffer> = {
  '/media/video-only.mp4': fs.readFileSync(
    path.join(MEDIA_DIR, 'video-only.mp4'),
  ),
  '/media/audio-only.mp4': fs.readFileSync(
    path.join(MEDIA_DIR, 'audio-only.mp4'),
  ),
}

/**
 * Static assets served whole (no Range semantics needed). The thumbnail
 * replaces the fixture snapshot's dead hdslb.com URL so E2E screenshots
 * show real part thumbnails (see e2e_mock_video_info's pic override).
 */
const STATIC: Record<string, { body: Buffer; contentType: string }> = {
  '/media/thumb.png': {
    body: fs.readFileSync(path.join(MEDIA_DIR, 'thumb.png')),
    contentType: 'image/png',
  },
}

/** Media content type — mirrors the wiremock unit mocks; passes the
 * downloader's is_media_content_type check (rejects JSON/text). */
const MEDIA_CONTENT_TYPE = 'application/octet-stream'

/**
 * Anonymous nav body: code -101 still carries wbi_img key URLs. Any stable
 * key strings work — this server is both the signer's key source and the
 * signed-request recipient, so only in-run consistency matters.
 */
const NAV_BODY = JSON.stringify({
  code: -101,
  message: 'account not logged in',
  data: {
    wbi_img: {
      img_url: 'https://mockHost/hello-world-img_key.png',
      sub_url: 'https://mockHost/hello-world-sub_key.png',
    },
  },
})

/** Running server handle returned by {@link startFixtureServer}. */
export type FixtureServer = {
  port: number
  close: () => Promise<void>
}

/**
 * Start the fixture server on an ephemeral port bound to 127.0.0.1.
 *
 * @param logFilePath - Request log destination; rides the screenshots
 *   artifact upload so CI failures are diagnosable (did the app reach nav?
 *   did the CDN probe send a Range?).
 * @returns The listening port and a close() that tears the server down
 *   without waiting out keep-alive sockets.
 */
export async function startFixtureServer(
  logFilePath: string,
): Promise<FixtureServer> {
  const log = (line: string) => {
    console.log(`[fixture-server] ${line}`)
    fs.appendFileSync(logFilePath, `${line}\n`)
  }

  const server = http.createServer((req, res) => {
    // CDN probe connections are dropped mid-response by reqwest; an unhandled
    // 'error' event would otherwise kill the server mid-test.
    req.on('error', () => {})
    res.on('error', () => {})

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    log(`${req.method} ${req.url}`)

    try {
      if (url.pathname === '/x/web-interface/nav') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(NAV_BODY)
        return
      }

      if (url.pathname === '/x/player/wbi/playurl') {
        // Derive the media origin from the request's own Host header so the
        // manifest is correct without this handler knowing the port.
        const origin = `http://${req.headers.host ?? '127.0.0.1'}`
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            code: 0,
            message: '0',
            data: {
              quality: 80,
              dash: {
                video: [
                  {
                    id: 80,
                    codecid: 7,
                    bandwidth: 200000,
                    width: 160,
                    height: 120,
                    baseUrl: `${origin}/media/video-only.mp4`,
                  },
                ],
                audio: [
                  {
                    id: 30280,
                    codecid: 0,
                    bandwidth: 48000,
                    width: 0,
                    height: 0,
                    baseUrl: `${origin}/media/audio-only.mp4`,
                  },
                ],
              },
            },
          }),
        )
        return
      }

      const body = MEDIA[url.pathname]
      if (body) {
        serveMedia(req, res, body)
        return
      }

      const asset = STATIC[url.pathname]
      if (asset) {
        res.writeHead(200, {
          'Content-Type': asset.contentType,
          'Content-Length': asset.body.length,
        })
        res.end(asset.body)
        return
      }

      res.writeHead(404)
      res.end()
    } catch (e) {
      log(`handler error: ${e}`)
      try {
        res.destroy()
      } catch {
        // socket already gone
      }
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error(`unexpected listen address: ${String(address)}`)
  }
  log(`listening on 127.0.0.1:${address.port}`)

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        // Node >= 18.2: skip the keep-alive drain so wdio exits promptly.
        ;(
          server as unknown as { closeAllConnections?: () => void }
        ).closeAllConnections?.()
      }),
  }
}

/**
 * Serve a media body with real Range semantics (single range only — reqwest
 * never sends multi-range).
 *
 * - HEAD → headers only (disk-space pre-check reads Content-Length)
 * - no Range → 200 + full body
 * - Range → 206 with the exact requested slice (end clamped to size-1 so
 *   probe overshoot like bytes=0-4194303 answers truthfully)
 * - unsatisfiable → 416 with the "bytes asterisk-slash total" form
 */
function serveMedia(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer,
): void {
  const total = body.length
  const common = {
    'Content-Type': MEDIA_CONTENT_TYPE,
    'Accept-Ranges': 'bytes',
  }

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...common, 'Content-Length': total })
    res.end()
    return
  }

  const range = req.headers.range
  if (!range) {
    res.writeHead(200, { ...common, 'Content-Length': total })
    res.end(body)
    return
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` })
    res.end()
    return
  }

  let start = 0
  let end = total - 1
  if (m[1] === '' && m[2] !== '') {
    // Suffix form: bytes=-N → last N bytes
    start = Math.max(0, total - parseInt(m[2], 10))
  } else {
    start = m[1] === '' ? 0 : parseInt(m[1], 10)
    end = m[2] === '' ? total - 1 : parseInt(m[2], 10)
  }
  end = Math.min(end, total - 1)
  if (start > end || start >= total) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` })
    res.end()
    return
  }

  res.writeHead(206, {
    ...common,
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Content-Length': end - start + 1,
  })
  res.end(body.subarray(start, end + 1))
}
