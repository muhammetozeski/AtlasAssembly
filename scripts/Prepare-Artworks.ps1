param([switch]$ValidateOnly)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$content=Join-Path $root 'content'
$curation=Get-Content -LiteralPath (Join-Path $content 'curation.json') -Raw | ConvertFrom-Json
$records=[Collections.Generic.List[object]]::new()
# Validate every source before writing any image. Public metadata alone does not license an image.
foreach($entry in $curation){
    if($entry.objectId -isnot [long] -and $entry.objectId -isnot [int]){throw 'An artwork object ID must be an integer.'}
    $object=Invoke-RestMethod -Uri ('https://collectionapi.metmuseum.org/public/collection/v1/objects/'+$entry.objectId)
    $imageUri=$null
    if($object.objectID -ne $entry.objectId -or $object.isPublicDomain -cne $true -or -not [uri]::TryCreate([string]$object.primaryImageSmall,[UriKind]::Absolute,[ref]$imageUri) -or $imageUri.Scheme -cne 'https' -or $imageUri.Host -cne 'images.metmuseum.org' -or $imageUri.UserInfo){throw ('No verified public-domain image for object '+$entry.objectId+'.')}
    $records.Add([pscustomobject]@{Entry=$entry;Object=$object;ImageUri=$imageUri})
}
if($ValidateOnly){Write-Output ('Verified public-domain metadata for '+$records.Count+' curated artworks.');return}
$images=Join-Path $content 'images'
New-Item -ItemType Directory -Path $images -Force | Out-Null
$manifest=[Collections.Generic.List[object]]::new()
foreach($record in $records){
    $entry=$record.Entry;$object=$record.Object
    $id='met-'+$entry.objectId
    $file=Join-Path $images ($id+'.jpg')
    $response=Invoke-WebRequest -Uri $record.ImageUri.AbsoluteUri -OutFile $file -PassThru
    if([string]$response.Headers['Content-Type'] -notmatch '^image/jpeg(?:;|$)'){throw ('The artwork response was not JPEG: '+$id)}
    $dimensions=& magick identify -ping -format '%w %h' $file
    if($LASTEXITCODE -ne 0 -or $dimensions -notmatch '^(\d+) (\d+)$'){throw ('The artwork could not be decoded: '+$id)}
    $width=[int]$Matches[1];$height=[int]$Matches[2]
    if($width -lt 400 -or $height -lt 400 -or $width -gt 8192 -or $height -gt 8192){throw ('Unexpected artwork dimensions: '+$id)}
    $manifest.Add([ordered]@{
        id=$id;objectId=[int]$entry.objectId;title=[string]$entry.title;sourceTitle=[string]$object.title
        artist=[string]$object.artistDisplayName;date=[string]$object.objectDate
        imagePath=('artworks/'+$id+'.jpg');width=$width;height=$height
        objectUrl=[string]$object.objectURL;creditLine=[string]$object.creditLine
        isPublicDomain=$true;license='CC0';licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/'
        sourceImageUrl=$record.ImageUri.AbsoluteUri
        sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        fetchedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')
    })
    Write-Output ($id+': '+$width+' x '+$height+', '+(Get-Item -LiteralPath $file).Length+' bytes.')
}
ConvertTo-Json -InputObject $manifest.ToArray() -Depth 5 | Set-Content -LiteralPath (Join-Path $content 'artworks.json') -Encoding utf8
Write-Output ('Prepared '+$manifest.Count+' actual artworks; the player needs no museum API key.')
