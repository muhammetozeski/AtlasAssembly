param([string]$Destination='',[string]$BasePath='/atlas-assembly/',[switch]$NoRestore)
$ErrorActionPreference='Stop'
if($BasePath -notin @('/','/atlas-assembly/')){throw 'Use / or /atlas-assembly/ as the application base.'}
$root=Split-Path -Parent $PSScriptRoot
$output=Join-Path $root 'publish/app'
$target=if($Destination){[IO.Path]::GetFullPath($Destination)}else{Join-Path $root 'publish/site'}
$arguments=@('publish',(Join-Path $root 'src/AtlasAssembly.Portal/AtlasAssembly.Portal.csproj'),'-c','Release','-o',$output,'-p:WasmEnableWebcil=true')
if($NoRestore){$arguments+='--no-restore'}
& dotnet @arguments
if($LASTEXITCODE -ne 0){throw 'The application did not publish.'}
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach($item in Get-ChildItem -LiteralPath (Join-Path $output 'wwwroot')){Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force}
New-Item -ItemType Directory -Path (Join-Path $target 'shared'),(Join-Path $target 'artworks') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'shared/engine.mjs') -Destination (Join-Path $target 'shared/engine.mjs') -Force
Copy-Item -LiteralPath (Join-Path $root 'content/artworks.json') -Destination (Join-Path $target 'artworks.json') -Force
$artworks=Get-Content -LiteralPath (Join-Path $root 'content/artworks.json') -Raw | ConvertFrom-Json
foreach($art in $artworks){Copy-Item -LiteralPath (Join-Path $root ('content/images/'+$art.id+'.jpg')) -Destination (Join-Path $target $art.imagePath) -Force}
$indexPath=Join-Path $target 'index.html'
$index=[IO.File]::ReadAllText($indexPath).Replace('<base href="/atlas-assembly/">',('<base href="'+$BasePath+'">'))
[IO.File]::WriteAllText($indexPath,$index)
$bytes=[Text.Encoding]::UTF8.GetBytes($index)
foreach($encoding in @('gzip','brotli')){
 $memory=[IO.MemoryStream]::new()
 $stream=if($encoding -eq 'gzip'){[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionLevel]::SmallestSize,$true)}else{[IO.Compression.BrotliStream]::new($memory,[IO.Compression.CompressionLevel]::SmallestSize,$true)}
 $stream.Write($bytes);$stream.Dispose();[IO.File]::WriteAllBytes($indexPath+$(if($encoding -eq 'gzip'){'.gz'}else{'.br'}),$memory.ToArray());$memory.Dispose()
}
$routes=[Collections.Generic.List[string]]::new()
if($BasePath -ne '/'){$routes.Add($BasePath.TrimEnd('/')+' '+$BasePath+' 308')}
foreach($route in @('room/:id','room/:id/')){$routes.Add($BasePath+$route+' '+$BasePath+' 200')}
$routes|Set-Content -LiteralPath (Join-Path $target '_redirects') -Encoding utf8
@"
$BasePath*
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://*.googlesyndication.com https://*.doubleclick.net https://fundingchoicesmessages.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googlesyndication.com https://*.doubleclick.net; connect-src 'self' https://*.googlesyndication.com https://*.doubleclick.net https://fundingchoicesmessages.google.com; frame-src https://*.googlesyndication.com https://*.doubleclick.net https://fundingchoicesmessages.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
"@ | Set-Content -LiteralPath (Join-Path $target '_headers') -Encoding utf8
$commit=(& git -C $root rev-parse HEAD).Trim()
@{service='Atlas Assembly';commit=$commit;baseHref=$BasePath;apiBase='/api/atlas-assembly/';builtAtUtc=[DateTimeOffset]::UtcNow.ToString('O');appearance=@{themeAttribute='data-atlas-theme';styleMarker='data-atlas-appearance=style';scriptMarker='data-atlas-appearance=script';auditGlobal='AtlasAssemblyAppearance.audit'}}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $target 'build-info.json') -Encoding utf8
Write-Output ('Atlas Assembly published to '+$target+'. Merge scoped headers and room folder proxies at the main host.')
