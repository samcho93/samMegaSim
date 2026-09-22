<# : samMegaSim compiler bridge (batch launcher - the PowerShell code follows)
@echo off
title samMegaSim Compiler Bridge
powershell -NoProfile -ExecutionPolicy Bypass -Command "$BridgeFile='%~f0'; Invoke-Expression ([IO.File]::ReadAllText($BridgeFile))"
echo.
echo Bridge stopped.
pause
exit /b
#>
# =============================================================================
#  samMegaSim compiler bridge
#  Runs WinAVR (avr-gcc) for https://samcho93.github.io/samMegaSim
#  Listens on http://127.0.0.1:8787 (loopback only)
#
#  GET  /status          bridge + WinAVR status
#  POST /compile         { mcu, fcpu, opt, printfFloat, files:[{name,content}] }
#  POST /install         download + install WinAVR-20100110 (UAC prompt)
#  GET  /install/status  installer progress
#  POST /config          { winavrPath }
# =============================================================================
$ErrorActionPreference = 'Stop'
$BridgeVersion = '1.0.0'
$Port = 8787
if ($env:SMS_BRIDGE_PORT) { $Port = [int]$env:SMS_BRIDGE_PORT }
$ConfigDir = Join-Path $env:LOCALAPPDATA 'samMegaSim'
$ConfigFile = Join-Path $ConfigDir 'bridge.json'
$InstallStatusFile = Join-Path $ConfigDir 'install-status.json'
$WinAvrUrl = 'https://downloads.sourceforge.net/project/winavr/WinAVR/20100110/WinAVR-20100110-install.exe'
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Write-Log($msg, $color = 'Gray') {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -ForegroundColor $color
}

function Get-Config {
  if (Test-Path $ConfigFile) {
    try { return (Get-Content $ConfigFile -Raw | ConvertFrom-Json) } catch {}
  }
  return [pscustomobject]@{ winavrPath = ''; allowOrigins = @() }
}

function Save-Config($cfg) {
  $cfg | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
}

function Find-WinAvr {
  $cands = New-Object System.Collections.Generic.List[string]
  $cfg = Get-Config
  if ($cfg.winavrPath) { $cands.Add([string]$cfg.winavrPath) }
  foreach ($drive in @('C:\', 'D:\')) {
    if (Test-Path $drive) {
      Get-ChildItem $drive -Directory -Filter 'WinAVR*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | ForEach-Object { $cands.Add($_.FullName) }
    }
  }
  foreach ($p in @("$env:ProgramFiles\WinAVR", "${env:ProgramFiles(x86)}\WinAVR", (Join-Path $ConfigDir 'WinAVR'))) { $cands.Add($p) }
  $gcc = Get-Command avr-gcc.exe -ErrorAction SilentlyContinue
  if ($gcc) { $cands.Add((Split-Path (Split-Path $gcc.Source))) }
  foreach ($c in $cands) {
    if ($c -and (Test-Path (Join-Path $c 'bin\avr-gcc.exe'))) { return $c }
  }
  return $null
}

function Get-GccVersion($root) {
  try {
    $v = & (Join-Path $root 'bin\avr-gcc.exe') --version 2>$null | Select-Object -First 1
    return [string]$v
  } catch { return '' }
}

function Test-Origin($origin) {
  if (-not $origin) { return $true }
  if ($origin -eq 'null') { return $true }
  if ($origin -match '^https://samcho93\.github\.io$') { return $true }
  if ($origin -match '^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$') { return $true }
  $cfg = Get-Config
  foreach ($o in @($cfg.allowOrigins)) { if ($o -and $origin -eq $o) { return $true } }
  return $false
}

function Send-Json($ctx, $obj, [int]$code = 200) {
  $json = $obj | ConvertTo-Json -Depth 6 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $res = $ctx.Response
  $res.StatusCode = $code
  $res.ContentType = 'application/json; charset=utf-8'
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.OutputStream.Close()
}

function Invoke-Tool($exe, [string[]]$argList, $workDir, $binDirs) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = ($argList | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.WorkingDirectory = $workDir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['PATH'] = (($binDirs -join ';') + ';' + $env:PATH)
  $psi.EnvironmentVariables['TEMP'] = $workDir
  $psi.EnvironmentVariables['TMP'] = $workDir
  $p = [Diagnostics.Process]::Start($psi)
  $errTask = $p.StandardError.ReadToEndAsync()
  $out = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  $err = $errTask.Result
  return [pscustomobject]@{ code = $p.ExitCode; out = $out; err = $err; cmd = ([IO.Path]::GetFileName($exe) + ' ' + $psi.Arguments) }
}

function Get-BuildRoot {
  # avr-gcc 4.3 (MinGW) is happier with plain ASCII paths than with a profile TEMP folder
  foreach ($base in @((Join-Path $env:ProgramData 'samMegaSim\build'), (Join-Path $env:SystemDrive 'sms_build'), (Join-Path $env:TEMP 'samMegaSim'))) {
    try {
      New-Item -ItemType Directory -Force -Path $base | Out-Null
      $probe = Join-Path $base ('probe_' + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $probe | Out-Null
      Remove-Item $probe -Force
      return $base
    } catch {}
  }
  return $env:TEMP
}

function Invoke-Compile($req) {
  $root = Find-WinAvr
  if (-not $root) { return @{ ok = $false; log = 'WinAVR (avr-gcc) not found. Install WinAVR first.'; error = 'winavr-not-found' } }
  $mcu = [string]$req.mcu
  if ($mcu -notmatch '^at(mega|tiny|xmega)\w+$') { return @{ ok = $false; log = "invalid mcu '$mcu'" } }
  $fcpu = [string]$req.fcpu
  if ($fcpu -notmatch '^\d{1,9}$') { return @{ ok = $false; log = "invalid F_CPU '$fcpu'" } }
  $opt = [string]$req.opt
  if (@('-O0', '-O1', '-O2', '-O3', '-Os') -notcontains $opt) { $opt = '-Os' }

  $dir = Join-Path (Get-BuildRoot) ('b_' + [guid]::NewGuid().ToString('N').Substring(0, 10))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  try {
    $utf8 = New-Object Text.UTF8Encoding $false
    $sources = @()
    foreach ($f in @($req.files)) {
      $name = [string]$f.name
      if ($name -notmatch '^[\w.-]+$' -or $name -match '^\.') { return @{ ok = $false; log = "invalid file name '$name'" } }
      [IO.File]::WriteAllText((Join-Path $dir $name), [string]$f.content, $utf8)
      if ($name -match '\.(c|S)$') { $sources += $name }
    }
    if (-not $sources.Count) { return @{ ok = $false; log = 'no .c source files' } }
    $bin = Join-Path $root 'bin'
    $bins = @($bin, (Join-Path $root 'utils\bin'))
    $gccArgs = @("-mmcu=$mcu", "-DF_CPU=$($fcpu)UL", $opt, '-g', '-Wall', '-std=gnu99', '-funsigned-char', '-funsigned-bitfields',
      '-fpack-struct', '-fshort-enums', '-ffunction-sections', '-fdata-sections', '-Wl,--gc-sections') + $sources + @('-o', 'main.elf')
    if ($req.printfFloat) { $gccArgs += @('-Wl,-u,vfprintf', '-lprintf_flt') }
    $gccArgs += '-lm'
    $r = Invoke-Tool (Join-Path $bin 'avr-gcc.exe') $gccArgs $dir $bins
    $log = ($r.out + $r.err).Trim()
    if ($r.code -ne 0 -or -not (Test-Path (Join-Path $dir 'main.elf'))) {
      return @{ ok = $false; log = $log; cmd = $r.cmd }
    }
    $o = Invoke-Tool (Join-Path $bin 'avr-objcopy.exe') @('-O', 'ihex', '-R', '.eeprom', '-R', '.fuse', '-R', '.lock', 'main.elf', 'main.hex') $dir $bins
    if ($o.code -ne 0) { return @{ ok = $false; log = ($log + "`n" + $o.err).Trim(); cmd = $r.cmd } }
    $size = Invoke-Tool (Join-Path $bin 'avr-size.exe') @('-C', "--mcu=$mcu", 'main.elf') $dir $bins
    if ($size.code -ne 0) { $size = Invoke-Tool (Join-Path $bin 'avr-size.exe') @('main.elf') $dir $bins }
    $hex = [IO.File]::ReadAllText((Join-Path $dir 'main.hex'))
    return @{ ok = $true; hex = $hex; log = $log; size = $size.out.Trim(); cmd = $r.cmd }
  } finally {
    Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
  }
}

# --- WinAVR installer (background job) ---------------------------------------
$script:InstallJob = $null
function Set-InstallStatus($state, $progress, $message) {
  @{ state = $state; progress = $progress; message = $message } | ConvertTo-Json | Set-Content -Path $InstallStatusFile -Encoding UTF8
}
function Get-InstallStatus {
  if (Test-Path $InstallStatusFile) { try { return (Get-Content $InstallStatusFile -Raw | ConvertFrom-Json) } catch {} }
  return [pscustomobject]@{ state = 'idle'; progress = 0; message = '' }
}
function Start-WinAvrInstall {
  if ($script:InstallJob -and $script:InstallJob.State -eq 'Running') { return }
  Set-InstallStatus 'downloading' 0 'starting download'
  $script:InstallJob = Start-Job -ArgumentList $WinAvrUrl, $ConfigDir, $InstallStatusFile -ScriptBlock {
    param($url, $dir, $statusFile)
    function St($s, $p, $m) { @{ state = $s; progress = $p; message = $m } | ConvertTo-Json | Set-Content -Path $statusFile -Encoding UTF8 }
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $dest = Join-Path $dir 'WinAVR-20100110-install.exe'
      if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 20MB) {
        $req = [Net.HttpWebRequest]::Create($url)
        $req.UserAgent = 'Wget/1.21'
        $req.AllowAutoRedirect = $true
        $resp = $req.GetResponse()
        $total = $resp.ContentLength
        $in = $resp.GetResponseStream()
        $out = [IO.File]::Create($dest + '.part')
        $buf = New-Object byte[] 65536
        $done = 0; $last = 0
        while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
          $out.Write($buf, 0, $n); $done += $n
          if ($done - $last -gt 512KB) {
            $last = $done
            $pct = if ($total -gt 0) { [int](100 * $done / $total) } else { 0 }
            St 'downloading' ([Math]::Min($pct, 99)) ("{0:N1} MB" -f ($done / 1MB))
          }
        }
        $out.Close(); $in.Close(); $resp.Close()
        if ((Get-Item ($dest + '.part')).Length -lt 20MB) { throw 'download incomplete (SourceForge mirror returned an unexpected page)' }
        Move-Item -Force ($dest + '.part') $dest
      }
      St 'installing' 100 'running installer (accept the UAC prompt)'
      $p = Start-Process -FilePath $dest -ArgumentList '/S' -Verb RunAs -Wait -PassThru
      if ($p.ExitCode -ne 0) { throw "installer exit code $($p.ExitCode)" }
      St 'done' 100 'WinAVR installed'
    } catch {
      St 'error' 0 $_.Exception.Message
    }
  }
}

# --- HTTP server ---------------------------------------------------------------
$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Log "Cannot listen on port $Port : $($_.Exception.Message)" 'Red'
  Write-Log 'Another bridge may already be running.' 'Yellow'
  return
}

Clear-Host
Write-Host ''
Write-Host '  samMegaSim Compiler Bridge' -ForegroundColor Cyan -NoNewline
Write-Host "  v$BridgeVersion" -ForegroundColor DarkGray
Write-Host '  ------------------------------------------------------------'
Write-Host "  Listening on http://127.0.0.1:$Port  (loopback only)" -ForegroundColor Green
$wa = Find-WinAvr
if ($wa) { Write-Host "  WinAVR : $wa" -ForegroundColor Green; Write-Host "           $(Get-GccVersion $wa)" -ForegroundColor DarkGray }
else { Write-Host '  WinAVR : NOT FOUND - use "WinAVR auto install" in the web page' -ForegroundColor Yellow }
Write-Host '  Web    : https://samcho93.github.io/samMegaSim/'
Write-Host '  Keep this window open while using the simulator. Close it to stop.'
Write-Host ''
if ((Get-InstallStatus).state -match 'download|install') { Set-InstallStatus 'idle' 0 '' }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $origin = $req.Headers['Origin']
    if (-not (Test-Origin $origin)) {
      Write-Log "rejected origin $origin" 'Red'
      Send-Json $ctx @{ ok = $false; error = 'origin not allowed' } 403
      continue
    }
    if ($origin) { $res.AddHeader('Access-Control-Allow-Origin', $origin); $res.AddHeader('Vary', 'Origin') }
    $res.AddHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    $res.AddHeader('Access-Control-Allow-Headers', 'Content-Type')
    $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
    $res.AddHeader('Access-Control-Max-Age', '600')
    if ($req.HttpMethod -eq 'OPTIONS') { $res.StatusCode = 204; $res.Close(); continue }

    $path = $req.Url.AbsolutePath.TrimEnd('/')
    $body = $null
    if ($req.HttpMethod -eq 'POST') {
      $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $text = $reader.ReadToEnd()
      if ($text) { $body = $text | ConvertFrom-Json }
    }
    switch ($path) {
      '/status' {
        $root = Find-WinAvr
        Send-Json $ctx @{
          ok = $true; version = $BridgeVersion; platform = 'windows-powershell'
          winavr = @{ found = [bool]$root; path = $root; version = $(if ($root) { Get-GccVersion $root } else { '' }) }
        }
      }
      '/compile' {
        $t0 = Get-Date
        Write-Log "compile $($body.mcu) F_CPU=$($body.fcpu) $($body.opt) ($(@($body.files).Count) files)" 'Cyan'
        $r = Invoke-Compile $body
        $ms = [int]((Get-Date) - $t0).TotalMilliseconds
        if ($r.ok) { Write-Log "  OK ($ms ms)" 'Green' } else { Write-Log "  FAILED ($ms ms)" 'Red' }
        Send-Json $ctx $r
      }
      '/install' {
        if (Find-WinAvr) { Send-Json $ctx @{ ok = $true; state = 'done'; message = 'already installed' } }
        else { Write-Log 'starting WinAVR download + install' 'Yellow'; Start-WinAvrInstall; Send-Json $ctx @{ ok = $true; state = 'downloading' } }
      }
      '/install/status' {
        $st = Get-InstallStatus
        Send-Json $ctx @{ ok = $true; state = $st.state; progress = $st.progress; message = $st.message }
      }
      '/config' {
        $cfg = Get-Config
        $p = [string]$body.winavrPath
        if ($p -and -not (Test-Path (Join-Path $p 'bin\avr-gcc.exe'))) {
          Send-Json $ctx @{ ok = $false; error = "avr-gcc.exe not found in $p\bin" }
        } else {
          $cfg | Add-Member -NotePropertyName winavrPath -NotePropertyValue $p -Force
          Save-Config $cfg
          Write-Log "WinAVR path set to '$p'" 'Yellow'
          Send-Json $ctx @{ ok = $true }
        }
      }
      default { Send-Json $ctx @{ ok = $false; error = 'not found' } 404 }
    }
  } catch {
    Write-Log "error: $($_.Exception.Message)" 'Red'
    try { Send-Json $ctx @{ ok = $false; error = $_.Exception.Message; log = $_.Exception.Message } 500 } catch {}
  }
}
