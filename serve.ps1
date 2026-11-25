# Máy chủ thử nghiệm cục bộ (chỉ nghe trên localhost) để chạy app trên máy tính.
# Chạy:  powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
param([int]$Port = 8080)

$root = (Resolve-Path $PSScriptRoot).Path.TrimEnd('\') + '\'
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "App dang chay tai http://localhost:$Port/  (Ctrl+C de dung)"

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.pdf' = 'application/pdf'
  '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; '.xls' = 'application/vnd.ms-excel'; '.csv' = 'text/csv'
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      Write-Host "$($ctx.Request.HttpMethod) $path  [$($ctx.Request.Headers['Service-Worker'])]"
      if ($path -eq '/') { $path = '/index.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $ctx.Response.StatusCode = 404
      } else {
        $bytes = [IO.File]::ReadAllBytes($full)
        $ext = [IO.Path]::GetExtension($full).ToLower()
        if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] } else { $ctx.Response.ContentType = 'application/octet-stream' }
        $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      $ctx.Response.StatusCode = 500
    } finally {
      $ctx.Response.Close()
    }
  }
} finally {
  $listener.Stop()
}
