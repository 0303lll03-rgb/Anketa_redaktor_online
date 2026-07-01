param(
  [int]$Port = 8788
)

$ErrorActionPreference = "Stop"

$BrowserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

function Send-Bytes {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [string]$ContentType,
    [byte[]]$BodyBytes
  )

  $reason = switch ($StatusCode) {
    200 { "OK" }
    204 { "No Content" }
    400 { "Bad Request" }
    404 { "Not Found" }
    502 { "Bad Gateway" }
    default { "OK" }
  }

  if ($null -eq $BodyBytes) {
    $BodyBytes = [byte[]]@()
  }

  $headers = @(
    "HTTP/1.1 $StatusCode $reason",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, POST, OPTIONS",
    "Access-Control-Allow-Headers: Content-Type, Accept",
    "Content-Type: $ContentType",
    "Content-Length: $($BodyBytes.Length)",
    "Connection: close",
    "",
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($BodyBytes.Length -gt 0) {
    $Stream.Write($BodyBytes, 0, $BodyBytes.Length)
  }
}

function Send-Response {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [string]$ContentType,
    [string]$Body = ""
  )

  Send-Bytes $Stream $StatusCode "$ContentType; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes($Body))
}

function Send-Json {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [hashtable]$Payload
  )

  $json = $Payload | ConvertTo-Json -Compress -Depth 8
  Send-Response $Stream $StatusCode "application/json" $json
}

function Send-ProxyError {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [string]$Code,
    [string]$Message,
    [int]$Status = 502,
    [object]$Details = $null
  )

  $payload = @{
    ok = $false
    code = $Code
    error = $Message
  }

  if ($null -ne $Details) {
    $payload.details = $Details
  }

  Send-Json $Stream $Status $payload
}

function Send-StaticFile {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [string]$Path
  )

  $route = $Path.TrimStart("/")
  if (-not $route) {
    $route = "index.html"
  }

  $allowedFiles = @{
    "index.html" = "text/html; charset=utf-8"
    "style.css" = "text/css; charset=utf-8"
    "config.js" = "application/javascript; charset=utf-8"
    "script.js" = "application/javascript; charset=utf-8"
  }

  if (-not $allowedFiles.ContainsKey($route)) {
    Send-ProxyError $Stream "not_found" "Route is not available." 404
    return
  }

  $filePath = Join-Path $PSScriptRoot $route
  if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
    Send-ProxyError $Stream "file_not_found" "Static file was not found." 404
    return
  }

  Send-Bytes $Stream 200 $allowedFiles[$route] ([System.IO.File]::ReadAllBytes($filePath))
}

function Get-QueryValue {
  param(
    [string]$Query,
    [string]$Name
  )

  $trimmed = $Query.TrimStart("?")
  foreach ($pair in ($trimmed -split "&")) {
    if (-not $pair) { continue }
    $parts = $pair -split "=", 2
    if ($parts.Count -lt 2) { continue }
    if ($parts[0] -eq $Name) {
      return [System.Uri]::UnescapeDataString($parts[1].Replace("+", " "))
    }
  }

  return ""
}

function New-CrmUri {
  param([string]$RawLink)

  $link = $RawLink.Trim()
  if ($link -notmatch "^https?://") {
    $link = "https://$link"
  }

  try {
    return [System.Uri]$link
  } catch {
    throw "link_format_invalid"
  }
}

function Assert-AllowedCrmHost {
  param([System.Uri]$Uri)

  if ($Uri.Host -eq "roapp.link" -or $Uri.Host -eq "roapp.page" -or $Uri.Host -like "*.roapp.page") {
    return
  }

  throw "domain_not_allowed"
}

function Build-CrmApiUrl {
  param([System.Uri]$Uri)

  $path = $Uri.AbsolutePath.Trim("/")
  $segments = @()
  if ($path) {
    $segments = @($path -split "/")
  }

  $apiIndex = [Array]::IndexOf([object[]]$segments, "api")
  $wIndex = [Array]::IndexOf([object[]]$segments, "w")

  if ($apiIndex -ge 0 -and
      $segments.Count -gt ($apiIndex + 3) -and
      $segments[$apiIndex + 1] -eq "w" -and
      $segments[$apiIndex + 2] -and
      $segments[$apiIndex + 3]) {
    return "$($Uri.Scheme)://$($Uri.Host)/api/w/$($segments[$apiIndex + 2])/$($segments[$apiIndex + 3])"
  }

  if ($wIndex -ge 0 -and
      $segments.Count -gt ($wIndex + 2) -and
      $segments[$wIndex + 1] -and
      $segments[$wIndex + 2]) {
    return "$($Uri.Scheme)://$($Uri.Host)/api/w/$($segments[$wIndex + 1])/$($segments[$wIndex + 2])"
  }

  return ""
}

function Get-ResponseFinalUrl {
  param(
    $Response,
    [string]$FallbackUrl
  )

  if ($Response.BaseResponse) {
    if ($Response.BaseResponse.ResponseUri) {
      return $Response.BaseResponse.ResponseUri.AbsoluteUri
    }

    if ($Response.BaseResponse.RequestMessage -and $Response.BaseResponse.RequestMessage.RequestUri) {
      return $Response.BaseResponse.RequestMessage.RequestUri.AbsoluteUri
    }
  }

  return $FallbackUrl
}

function Get-ResponseContentType {
  param($Response)

  if ($Response.Headers["Content-Type"]) {
    return [string]$Response.Headers["Content-Type"]
  }

  if ($Response.BaseResponse -and $Response.BaseResponse.ContentType) {
    return [string]$Response.BaseResponse.ContentType
  }

  return ""
}

function Get-Preview {
  param(
    [string]$Text,
    [int]$Length = 700
  )

  if (-not $Text) {
    return ""
  }

  $singleLine = ($Text -replace "\s+", " ").Trim()
  if ($singleLine.Length -le $Length) {
    return $singleLine
  }

  return $singleLine.Substring(0, $Length)
}

function Get-ResponseText {
  param($Response)

  try {
    $stream = $Response.RawContentStream
    if ($stream) {
      if ($stream.CanSeek) {
        $stream.Position = 0
      }

      $memory = New-Object System.IO.MemoryStream
      $stream.CopyTo($memory)
      $bytes = $memory.ToArray()

      if ($bytes.Length -gt 0) {
        $contentType = Get-ResponseContentType $Response
        $charset = ""
        if ($contentType -match "charset=([^;]+)") {
          $charset = $Matches[1].Trim().Trim('"')
        }

        if ($charset) {
          try {
            return [System.Text.Encoding]::GetEncoding($charset).GetString($bytes)
          } catch {}
        }

        return [System.Text.Encoding]::UTF8.GetString($bytes)
      }
    }
  } catch {}

  return [string]$Response.Content
}

function Get-WebExceptionDetails {
  param($ErrorRecord)

  $details = @{
    status = $null
    contentType = ""
    preview = ""
  }

  $response = $ErrorRecord.Exception.Response
  if ($response) {
    try {
      if ($response.StatusCode) {
        $details.status = [int]$response.StatusCode
      }

      if ($response.ContentType) {
        $details.contentType = [string]$response.ContentType
      }

      $stream = $response.GetResponseStream()
      if ($stream) {
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
        $details.preview = Get-Preview $reader.ReadToEnd()
      }
    } catch {}
  }

  return $details
}

function New-CrmHeaders {
  param(
    [string]$Accept,
    [string]$Referer = ""
  )

  $headers = @{
    "Accept" = $Accept
    "X-Language" = "uk"
    "User-Agent" = $BrowserUserAgent
  }

  if ($Referer) {
    $headers["Referer"] = $Referer
  }

  return $headers
}

function Invoke-CrmRequest {
  param(
    [string]$Url,
    [Microsoft.PowerShell.Commands.WebRequestSession]$Session,
    [string]$Accept,
    [string]$Referer = ""
  )

  Invoke-WebRequest `
    -Uri $Url `
    -UseBasicParsing `
    -TimeoutSec 25 `
    -MaximumRedirection 8 `
    -WebSession $Session `
    -Headers (New-CrmHeaders $Accept $Referer)
}

function Find-ApiUrlInHtml {
  param(
    [string]$Html,
    [System.Uri]$BaseUri
  )

  if (-not $Html) {
    return ""
  }

  $patterns = @(
    "https?://[^`"'<> ]+/api/w/[^`"'<> ]+/[^`"'<> /]+",
    "/api/w/[^`"'<> ]+/[^`"'<> /]+"
  )

  foreach ($pattern in $patterns) {
    $match = [regex]::Match($Html, $pattern)
    if ($match.Success) {
      $value = $match.Value
      if ($value -match "^https?://") {
        return $value
      }

      return "$($BaseUri.Scheme)://$($BaseUri.Host)$value"
    }
  }

  return ""
}

function Resolve-CrmApiContext {
  param(
    [string]$RawLink,
    [Microsoft.PowerShell.Commands.WebRequestSession]$Session
  )

  $uri = New-CrmUri $RawLink
  Assert-AllowedCrmHost $uri

  $apiUrl = Build-CrmApiUrl $uri
  if ($apiUrl) {
    return @{
      apiUrl = $apiUrl
      pageUrl = $uri.AbsoluteUri
      source = "url"
    }
  }

  $pageResponse = $null
  try {
    $pageResponse = Invoke-CrmRequest $uri.AbsoluteUri $Session "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  } catch {
    throw @{
      code = "short_link_resolve_failed"
      error = "CRM short link could not be opened."
      details = Get-WebExceptionDetails $_
    }
  }

  $finalUrl = Get-ResponseFinalUrl $pageResponse $uri.AbsoluteUri
  $finalUri = New-CrmUri $finalUrl
  Assert-AllowedCrmHost $finalUri

  $apiUrl = Build-CrmApiUrl $finalUri
  if ($apiUrl) {
    return @{
      apiUrl = $apiUrl
      pageUrl = $finalUri.AbsoluteUri
      source = "final_url"
    }
  }

  $contentType = Get-ResponseContentType $pageResponse
  $pageContent = Get-ResponseText $pageResponse
  if ($contentType -match "html" -or $pageContent -match "<!doctype|<html") {
    $apiFromHtml = Find-ApiUrlInHtml $pageContent $finalUri
    if ($apiFromHtml) {
      return @{
        apiUrl = $apiFromHtml
        pageUrl = $finalUri.AbsoluteUri
        source = "html"
      }
    }
  }

  throw @{
    code = "api_url_not_found"
    error = "CRM API URL was not found in the link or final HTML page."
    details = @{
      finalUrl = $finalUri.AbsoluteUri
      contentType = $contentType
      preview = Get-Preview $pageContent
    }
  }
}

function Send-CrmOrder {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [string]$RawLink
  )

  if (-not $RawLink) {
    Send-ProxyError $Stream "missing_url" "Missing url query parameter." 400
    return
  }

  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

  try {
    $context = Resolve-CrmApiContext $RawLink $session
  } catch {
    $payload = $_.Exception.Message
    if ($_.Exception.Message -eq "System.Collections.Hashtable") {
      $payload = $_.Exception.ErrorRecord.TargetObject
    } elseif ($_.TargetObject -is [hashtable]) {
      $payload = $_.TargetObject
    }

    if ($payload -is [hashtable]) {
      Send-Json $Stream 502 $payload
    } else {
      Send-ProxyError $Stream "api_url_not_found" ([string]$payload) 502
    }
    return
  }

  try {
    $apiResponse = Invoke-CrmRequest $context.apiUrl $session "application/json, text/plain, */*" $context.pageUrl
  } catch {
    $details = Get-WebExceptionDetails $_
    $status = $details.status
    $code = if ($status) { "crm_http_$status" } else { "crm_request_failed" }
    $message = if ($status -eq 401 -or $status -eq 403) {
      "CRM requires authorization or official API access."
    } elseif ($status) {
      "CRM returned HTTP $status."
    } else {
      "CRM request failed."
    }
    Send-ProxyError $Stream $code $message 502 $details
    return
  }

  $contentType = Get-ResponseContentType $apiResponse
  $content = Get-ResponseText $apiResponse
  $trimmed = $content.TrimStart()
  $looksJson = $trimmed.StartsWith("{") -or $trimmed.StartsWith("[")

  if ($contentType -notmatch "json" -and -not $looksJson) {
    Send-ProxyError $Stream "crm_non_json" "CRM returned non-JSON content." 502 @{
      status = 200
      contentType = $contentType
      preview = Get-Preview $content
      apiUrl = $context.apiUrl
      pageUrl = $context.pageUrl
    }
    return
  }

  Send-Response $Stream 200 "application/json" $content
}

function Send-CrmImport {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [string]$Body
  )

  if (-not $Body) {
    Send-ProxyError $Stream "missing_body" "Missing JSON request body." 400
    return
  }

  try {
    $payload = $Body | ConvertFrom-Json
  } catch {
    Send-ProxyError $Stream "bad_json" "Request body must be valid JSON." 400
    return
  }

  $url = [string]$payload.url
  if (-not $url) {
    Send-ProxyError $Stream "missing_url" "Missing CRM url." 400
    return
  }

  Send-CrmOrder $Stream $url
}

function Handle-Request {
  param([System.Net.Sockets.TcpClient]$Client)

  $stream = $Client.GetStream()
  $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $false, 4096, $true)
  $requestLine = $reader.ReadLine()

  if (-not $requestLine) {
    return
  }

  $headers = @{}
  while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line -or $line -eq "") { break }
    $headerParts = $line -split ":", 2
    if ($headerParts.Count -eq 2) {
      $headers[$headerParts[0].Trim().ToLowerInvariant()] = $headerParts[1].Trim()
    }
  }

  $parts = $requestLine -split "\s+", 3
  if ($parts.Count -lt 2) {
    Send-ProxyError $stream "bad_request" "Bad request." 400
    return
  }

  $method = $parts[0]
  $target = $parts[1]

  if ($method -eq "OPTIONS") {
    Send-Bytes $stream 204 "text/plain; charset=utf-8" ([byte[]]@())
    return
  }

  if ($method -ne "GET" -and $method -ne "POST") {
    Send-ProxyError $stream "method_not_supported" "Only GET and POST are supported." 400
    return
  }

  $body = ""
  if ($method -eq "POST") {
    $contentLength = 0
    if ($headers.ContainsKey("content-length")) {
      [void][int]::TryParse($headers["content-length"], [ref]$contentLength)
    }

    if ($contentLength -gt 0) {
      $buffer = New-Object char[] $contentLength
      $read = $reader.Read($buffer, 0, $contentLength)
      if ($read -gt 0) {
        $body = -join $buffer[0..($read - 1)]
      }
    }
  }

  $requestUri = if ($target -match "^https?://") {
    [System.Uri]$target
  } else {
    [System.Uri]"http://127.0.0.1:$Port$target"
  }

  if ($requestUri.AbsolutePath -eq "/health") {
    Send-Json $stream 200 @{
      ok = $true
      service = "anketa-crm-proxy"
      port = $Port
    }
    return
  }

  if ($requestUri.AbsolutePath -eq "/" -or
      $requestUri.AbsolutePath -eq "/index.html" -or
      $requestUri.AbsolutePath -eq "/style.css" -or
      $requestUri.AbsolutePath -eq "/config.js" -or
      $requestUri.AbsolutePath -eq "/script.js") {
    Send-StaticFile $stream $requestUri.AbsolutePath
    return
  }

  if ($requestUri.AbsolutePath -eq "/api/crm-import") {
    if ($method -ne "POST") {
      Send-ProxyError $stream "method_not_supported" "Use POST for CRM import." 400
      return
    }
    Send-CrmImport $stream $body
    return
  }

  if ($requestUri.AbsolutePath -eq "/crm") {
    Send-CrmOrder $stream (Get-QueryValue $requestUri.Query "url")
    return
  }

  Send-ProxyError $stream "not_found" "Route is not available." 404
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
$listener.Start()

Write-Host ""
Write-Host "Editor is running at http://127.0.0.1:$Port/index.html"
Write-Host "Keep this window open while using CRM import."
Write-Host "Press Ctrl+C to stop."
Write-Host ""

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      Handle-Request $client
    } catch {
      try {
        Send-ProxyError $client.GetStream() "proxy_internal_error" $_.Exception.Message 502
      } catch {}
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
