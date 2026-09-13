param(
    [string]$Executable = "src-tauri/target/release/bilibili-downloader-gui.exe",
    [string]$OutputDirectory = "artifacts/windows"
)
$ErrorActionPreference = "Stop"

# The pinned manifest is shared with the runtime mirror downloader.
$manifest = Get-Content "$PSScriptRoot/../src-tauri/ffmpeg-binaries.json" -Raw | ConvertFrom-Json
$version = (Get-Content "$PSScriptRoot/../src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version
$asset = $manifest.artifacts.'win32-x64'
$base = "$($manifest.mirror)/$($manifest.version)"
$stage = Join-Path $OutputDirectory "stage"
if (Test-Path $stage) { throw "Packaging directory already exists: $stage" }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item $Executable "$stage/bilibili-downloader-gui.exe"
Copy-Item "$PSScriptRoot/../LICENSE" "$stage/LICENSE.txt"
@"
Bilibili Downloader GUI $version

Extract the entire ZIP, then run bilibili-downloader-gui.exe.
The light ZIP downloads FFmpeg on first launch. The with-ffmpeg ZIP
includes FFmpeg and installs it into your application data directory
without a download. Both editions require Microsoft Edge WebView2 Runtime.
Settings and downloaded files are stored outside this ZIP directory.

FFmpeg is a separate program distributed under its own license.
The with-ffmpeg ZIP includes its license, upstream build configuration,
and source-code links in the ffmpeg directory.
"@ | Set-Content "$stage/README.txt" -Encoding utf8

Compress-Archive -Path "$stage/*" -DestinationPath "$OutputDirectory/bilibili-downloader-gui_${version}_Windows_x64-light.zip"

function Get-VerifiedAsset([string]$Name, [string]$Hash, [string]$Destination) {
    Invoke-WebRequest -Uri "$base/$Name" -OutFile $Destination -TimeoutSec 180
    if ((Get-FileHash $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) {
        throw "FFmpeg checksum mismatch: $Name"
    }
}

$ffmpegRoot = "$stage/ffmpeg"
$binDir = "$ffmpegRoot/ffmpeg-master-latest-win64-gpl/bin"
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
$compressed = "$OutputDirectory/ffmpeg.gz"
Get-VerifiedAsset $asset.filename $asset.sha256 $compressed
$inputStream = [System.IO.File]::OpenRead((Resolve-Path $compressed))
try {
    $gzip = [System.IO.Compression.GZipStream]::new($inputStream, [System.IO.Compression.CompressionMode]::Decompress)
    try {
        $outputStream = [System.IO.File]::Create("$((Resolve-Path $binDir).Path)/ffmpeg.exe")
        try { $gzip.CopyTo($outputStream) } finally { $outputStream.Dispose() }
    } finally { $gzip.Dispose() }
} finally { $inputStream.Dispose() }
foreach ($notice in $manifest.windowsNotices.PSObject.Properties) {
    Get-VerifiedAsset $notice.Name $notice.Value "$ffmpegRoot/$($notice.Name)"
}
@"
FFmpeg binary: $base/$($asset.filename)
Upstream release: https://github.com/eugeneware/ffmpeg-static/releases/tag/$($manifest.version)
Build provider: https://www.gyan.dev/ffmpeg/builds/
FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/e38092ef93
See win32-x64.README for the build configuration and win32-x64.LICENSE for GPL v3.
"@ | Set-Content "$ffmpegRoot/SOURCES.txt" -Encoding utf8

# Exercise the same AAC probe used by the application, on the Windows runner.
& "$binDir/ffmpeg.exe" -hide_banner -f lavfi -i anullsrc=r=44100:cl=stereo -t 0.05 -c:a aac -f null -
if ($LASTEXITCODE -ne 0) { throw "Bundled FFmpeg AAC validation failed" }
Compress-Archive -Path "$stage/*" -DestinationPath "$OutputDirectory/bilibili-downloader-gui_${version}_Windows_x64-with-ffmpeg.zip"
Get-ChildItem "$OutputDirectory/*.zip" | Get-FileHash -Algorithm SHA256
