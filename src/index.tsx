import { Hono } from 'hono'
import { renderer } from './renderer'
import {Script} from "vite-ssr-components/hono"
import {etag} from "hono/etag"
import {cache} from "hono/cache"

interface Bindings {
  tair2_cdn: R2Bucket
  API_KEY?: string
  VIEW_LIST_WITH_PASS?: string
}

const app = new Hono<{Bindings:Bindings}>()
app.use("*",etag({}))
app.use("/files/*", cache({
  cacheName: "tair2-cdn-files",
  cacheControl: "public, max-age=31536000, immutable",
  wait: true
}))
app.use(renderer)

app.onError((err, c) => {
  console.error('Application error:', err)
  return c.render(
    <div class="container">
      <h1>Internal Server Error</h1>
      <div class="error-message">
        <p>サーバー内部でエラーが発生しました。</p>
        <p>しばらく時間をおいてから再度お試しください。</p>
      </div>
      <div class="error-actions">
        <a href="/" class="back-link">Back to Home</a>
      </div>
    </div>
  )
})

app.notFound((c) => {
  return c.render(
    <div class="container">
      <h1>Page Not Found</h1>
      <div class="error-message">
        <p>お探しのページが見つかりません。</p>
        <p>URLが正しいか確認してください。</p>
      </div>
      <div class="error-actions">
        <a href="/" class="back-link">Back to Home</a>
      </div>
    </div>
  )
})

app.get('/', (c) => {
  const showFilesLink = !c.env.VIEW_LIST_WITH_PASS
  const hasViewRestriction = c.env.VIEW_LIST_WITH_PASS
  const hasApiKey = !!c.env.API_KEY
  
  return c.render(<div class="container">
    <h1>tair2-cdn</h1>
    <p>個人的で簡易なCDN</p>
    <div id="form"></div>
    <Script src='/src/form.tsx'></Script>
    {showFilesLink && <a href="/files" class="files-link">View Uploaded Files</a>}
    {hasViewRestriction && hasApiKey && (
      <p class="auth-notice">
        ファイル一覧の表示にはAPI認証が必要です。<br/>
        <code>/files?key=YOUR_API_KEY</code> でアクセスしてください。
      </p>
    )}
    {hasViewRestriction && !hasApiKey && (
      <p class="auth-notice error">
        サーバー設定エラー: ファイル一覧保護が有効ですが、API_KEYが設定されていません。
      </p>
    )}
  </div>)
})

app.post("/upload", async (c) => {
  // API認証チェック（API_KEYが設定されている場合のみ）
  if (c.env.API_KEY) {
    const apiKey = c.req.header("x-api-key") || c.req.query("key")
    if (apiKey !== c.env.API_KEY) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }

  const formData = await c.req.formData()
  const file = formData.get('file') as File

  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const results: string[] = []

  // 圧縮可能かどうか自動判定
  if (shouldCompress(file.type, file.name)) {
    try {
      // gzip圧縮してアップロード
      const gzipStream = await compressFile(file, 'gzip')
      await c.env.tair2_cdn.put(`${file.name}.gz`, gzipStream, {
        httpMetadata: {
          contentType: file.type,
          contentEncoding: 'gzip'
        },
      })
      results.push(`Gzip compressed file uploaded: ${file.name}.gz`)
    } catch (error) {
      results.push(`Compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      // 圧縮に失敗した場合は元ファイルをアップロード
      await c.env.tair2_cdn.put(file.name, file.stream(), {
        httpMetadata: {
          contentType: file.type,
        },
      })
      results.push(`Original file uploaded as fallback: ${file.name}`)
    }
  } else {
    // 圧縮対象外ファイルは元ファイルをアップロード
    await c.env.tair2_cdn.put(file.name, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    })
    results.push(`Original file uploaded (compression not applicable): ${file.name}`)
  }

  return c.json({ 
    message: 'File uploaded successfully', 
    fileName: file.name,
    results: results
  })
})

app.get('/files', async (c) => {
  // VIEW_LIST_WITH_PASSが設定されている場合はAPI認証をチェック
  if (c.env.VIEW_LIST_WITH_PASS) {
    if (!c.env.API_KEY) {
      return c.render(
        <div class="container">
          <h1>Server Configuration Error</h1>
          <div class="error-message">
            <p>サーバー設定エラーが発生しました。</p>
            <p>ファイル一覧保護が有効ですが、API_KEYが設定されていません。</p>
            <p>管理者にお問い合わせください。</p>
          </div>
          <a href="/" class="back-link">Back to Home</a>
        </div>
      )
    }
    const apiKey = c.req.query("key")
    if (!apiKey || apiKey !== c.env.API_KEY) {
      return c.render(
        <div class="container">
          <h1>Authentication Required</h1>
          <div class="error-message">
            <p>このページにアクセスするにはAPI認証が必要です。</p>
            <p>正しいAPIキーを指定してアクセスしてください。</p>
            <div class="usage-example">
              <p><strong>アクセス方法:</strong></p>
              <code>/files?key=YOUR_API_KEY</code>
            </div>
          </div>
          <a href="/" class="back-link">Back to Home</a>
        </div>
      )
    }
  }

  const objects = await c.env.tair2_cdn.list()
  const fileList = objects.objects.map(obj => ({
    name: obj.key,
    size: obj.size,
    type: obj.httpMetadata?.contentType || 'unknown',
  }))

  return c.render(
    <div class="container">
      <h1>Uploaded Files</h1>
      <a href="/" class="back-link">Back to Upload</a>
      <table class="files-table">
        <thead>
          <tr>
            <th>File Name</th>
            <th>Size</th>
            <th>Type</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          {fileList.map(file => (
            <tr>
              <td>{file.name}</td>
              <td>{`${(file.size / 1024).toFixed(2)} KB`}</td>
              <td>{file.type}</td>
              <td><a href={`/files/${file.name}`} target="_blank">Link</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

app.get('/files/:fileName', async (c) => {
  const fileName = c.req.param('fileName')
  
  // キャッシュキーを生成（ファイル名 + 圧縮方式）
  const acceptEncoding = c.req.header("Accept-Encoding") || ""
  let cacheKey = fileName
  let selectedEncoding = null
  let r2Key = fileName

  if (acceptEncoding.includes("gzip")) {
    const gzipKey = `${fileName}.gz`
    const gzipObject = await c.env.tair2_cdn.get(gzipKey, {
      range: c.req.header("Range") || undefined
    })
    
    if (gzipObject) {
      cacheKey = `${fileName}-gzip`
      selectedEncoding = "gzip"
      r2Key = gzipKey
      return createFileResponse(gzipObject, fileName, "gzip", c.req.header("Range"), cacheKey)
    }
  }

  // gzip版が見つからない場合、元ファイルを探す
  const rangeHeader = c.req.header("Range")
  const object = await c.env.tair2_cdn.get(fileName, {
    range: rangeHeader || undefined
  })

  if (!object) {
    return c.render(
      <div class="container">
        <h1>File Not Found</h1>
        <div class="error-message">
          <p>指定されたファイル <code>{fileName}</code> が見つかりません。</p>
          <p>ファイル名が正しいか確認してください。</p>
        </div>
        <div class="error-actions">
          <a href="/files" class="back-link">View All Files</a>
          <a href="/" class="back-link">Back to Home</a>
        </div>
      </div>
    )
  }

  cacheKey = `${fileName}-original`
  return createFileResponse(object, fileName, null, rangeHeader, cacheKey)
})

function createFileResponse(object: any, fileName: string, encoding: string | null, rangeHeader: string | undefined, cacheKey?: string) {
  const headers = new Headers()
  
  if (object.range) {
    headers.set("Content-Range", object.range)
  }

  headers.set("Content-Type", getContentType(fileName))
  if (encoding) {
    headers.set("Content-Encoding", encoding)
  }
  headers.set("Cache-Control", "public, max-age=31536000, immutable")
  
  // Varyヘッダーで圧縮方式に応じたキャッシュを指示
  headers.set("Vary", "Accept-Encoding")
  
  // ETagにキャッシュキーを含める
  if (cacheKey) {
    headers.set("ETag", `"${cacheKey}-${object.etag || 'default'}"`)
  }

  return new Response(object.body, {
    status: object.range ? 206 : 200,
    headers
  })
}

function getContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || ""
  const mimeTypes: Record<string, string> = {
    "mp4": "video/mp4",
    "pdf": "application/pdf",
    "webm": "video/webm",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "html": "text/html",
    "js": "application/javascript",
    "css": "text/css",
    "json": "application/json",
    "txt": "text/plain",
    "svg": "image/svg+xml",
    "ico": "image/x-icon"
  }
  return mimeTypes[ext] || "application/octet-stream"
}

// 圧縮が有効なファイルタイプかどうか判定
function shouldCompress(contentType: string, fileName: string): boolean {
  const compressibleTypes = [
    'text/',
    'application/javascript',
    'application/json',
    'application/xml',
    'image/svg+xml'
  ]
  
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const compressibleExts = ['js', 'css', 'html', 'json', 'xml', 'svg', 'txt', 'md']
  
  return compressibleTypes.some(type => contentType.startsWith(type)) || 
         compressibleExts.includes(ext)
}

// ファイルを圧縮
async function compressFile(file: File, format: 'gzip'): Promise<ReadableStream> {
  const stream = file.stream()
  
  if (format === 'gzip') {
    const compressionStream = new CompressionStream('gzip')
    return stream.pipeThrough(compressionStream)
  }
  
  throw new Error(`Unsupported compression format: ${format}`)
}

// 404ハンドラー
app.notFound((c) => {
  return c.render(
    <div class="container">
      <h1>Page Not Found</h1>
      <div class="error-message">
        <p>お探しのページが見つかりません。</p>
        <p>URLが正しいか確認してください。</p>
      </div>
      <div class="error-actions">
        <a href="/" class="back-link">Back to Home</a>
      </div>
    </div>
  )
})

// エラーハンドラー
app.onError((err, c) => {
  console.error('Application error:', err)
  return c.render(
    <div class="container">
      <h1>Internal Server Error</h1>
      <div class="error-message">
        <p>サーバー内部でエラーが発生しました。</p>
        <p>しばらく時間をおいてから再度お試しください。</p>
      </div>
      <div class="error-actions">
        <a href="/" class="back-link">Back to Home</a>
      </div>
    </div>
  )
})

export default app
