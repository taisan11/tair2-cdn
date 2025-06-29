import { jsxRenderer } from 'hono/jsx-renderer'
import { Link, ViteClient } from 'vite-ssr-components/hono'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang='ja'>
      <head>
        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
        <title>tair2-cdn</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="UTF-8" />
      </head>
      <body>{children}</body>
    </html>
  )
})
