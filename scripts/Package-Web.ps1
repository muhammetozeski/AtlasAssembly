param([Parameter(Mandatory)][string]$PublishedDirectory,[string]$Version='1.0.0')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if($Version -cnotmatch '^\d+\.\d+\.\d+$'){throw 'Use a three-part numeric release version.'}
$published=[IO.Path]::GetFullPath($PublishedDirectory)
$info=Get-Content -LiteralPath (Join-Path $published 'build-info.json') -Raw | ConvertFrom-Json
$revision=(& git -C $root rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $info.commit -cne $revision -or $info.baseHref -cne '/atlas-assembly/'){throw 'Package only the current clean main-host application build.'}
$status=@(& git -C $root status --porcelain --untracked-files=all)
if($LASTEXITCODE -ne 0 -or $status.Count){throw 'Commit the coherent source before packaging.'}
$output=Join-Path $root ('artifacts/v'+$Version)
if(Test-Path -LiteralPath $output){throw 'This release output already exists; preserve it and choose the intended version.'}
$package=Join-Path $output 'AtlasAssembly'
New-Item -ItemType Directory -Path (Join-Path $package 'public/atlas-assembly'),(Join-Path $package 'functions/api/atlas-assembly'),(Join-Path $package 'content'),(Join-Path $package 'schema') -Force | Out-Null
Get-ChildItem -LiteralPath $published | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $package 'public/atlas-assembly') -Recurse -Force}
foreach($name in @('_headers','_redirects')){Copy-Item -LiteralPath (Join-Path $published $name) -Destination (Join-Path $package ('public/'+$name))}
foreach($name in @('server','shared')){Copy-Item -LiteralPath (Join-Path $root $name) -Destination $package -Recurse}
Copy-Item -LiteralPath (Join-Path $root 'content/artworks.json') -Destination (Join-Path $package 'content/artworks.json')
Copy-Item -LiteralPath (Join-Path $root 'schema/atlas-assembly.sql') -Destination (Join-Path $package 'schema/atlas-assembly.sql')
Copy-Item -LiteralPath (Join-Path $root 'docs/Web-Distribution.md') -Destination (Join-Path $package 'README.md')
@'
import {handleAtlasAssembly} from '../../../server/handler.mjs';
export function onRequest(context){return handleAtlasAssembly({request:context.request,env:{DB:context.env.DB,SITE_ORIGIN:context.env.SITE_ORIGIN}});}
'@ | Set-Content -LiteralPath (Join-Path $package 'functions/api/atlas-assembly/[[path]].js') -Encoding utf8
'{"version":1,"include":["/api/atlas-assembly/*"],"exclude":[]}' | Set-Content -LiteralPath (Join-Path $package 'public/_routes.json') -Encoding utf8
'{"adSense":{"enabled":false,"client":null,"slot":null},"privacy":"/privacy/"}' | Set-Content -LiteralPath (Join-Path $package 'public/revenue-config.json') -Encoding utf8
@'
# Copy only after choosing your own Pages project, origin and D1 database.
name = "replace-with-your-project"
pages_build_output_dir = "./public"
compatibility_date = "2026-10-25"
[vars]
SITE_ORIGIN = "https://replace-with-your-host.example"
[[d1_databases]]
binding = "DB"
database_name = "replace-with-your-database"
database_id = "replace-with-your-database-id"
'@ | Set-Content -LiteralPath (Join-Path $package 'wrangler.example.toml') -Encoding utf8
@{version=$Version;sourceCommit=$revision;primaryPath='/atlas-assembly/';scope='Compiled web application and server/schema source; shared rooms require a configured D1 host and scheduled expiry.'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $package 'release.json') -Encoding utf8
$archive=Join-Path $output ('AtlasAssembly-Web-v'+$Version+'.zip')
Compress-Archive -LiteralPath $package -DestinationPath $archive -CompressionLevel Optimal
(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+[IO.Path]::GetFileName($archive) | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding utf8
Write-Output $archive
