<#
.SYNOPSIS
  Buoy 카카오톡 네이티브 메시징 호스트를 현재 사용자(HKCU)에 등록한다.

.EXAMPLE
  # 1) chrome://extensions 에서 echo 확장의 ID를 복사한다 (개발자 모드, 압축해제 로드).
  # 2) PowerShell (관리자 아님) 에서:
  .\install\register.ps1 -ExtensionId abcdefghijklmnopabcdefghijklmnop -Adapter mock
  # 3) 확장 아이콘 클릭 → 배지 OK 이면 E3 통과. 이후 -Adapter windows 로 다시 등록.

.PARAMETER Browser   chrome(기본) | edge | whale
.PARAMETER Adapter   mock(기본) | windows
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [ValidateSet('chrome', 'edge', 'whale')][string]$Browser = 'chrome',
  [ValidateSet('mock', 'windows')][string]$Adapter = 'mock',
  [string]$PythonExe = ''
)
$ErrorActionPreference = 'Stop'
$HostName = 'com.buoy.kakao'
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path      # poc/kakao-host
$InstallDir = Join-Path $env:LOCALAPPDATA 'Buoy\kakao-host'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if (-not $PythonExe) {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if (-not $cmd) { $cmd = Get-Command py -ErrorAction SilentlyContinue }
  if (-not $cmd) { throw 'python을 찾지 못했습니다. -PythonExe 로 경로를 지정하세요.' }
  $PythonExe = $cmd.Source
}

# host.bat 생성
$bat = Get-Content (Join-Path $PSScriptRoot 'host.bat.template') -Raw
$bat = $bat.Replace('__PROJECT_DIR__', $ProjectDir).Replace('__PYTHON_EXE__', $PythonExe).Replace('__ADAPTER__', $Adapter)
$batPath = Join-Path $InstallDir 'host.bat'
# cmd.exe는 배치 파일을 OEM 코드 페이지(한국어 Windows: cp949)로 읽으므로 그 인코딩으로 저장 (경로에 한글이 있어도 안전)
$oem = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
[IO.File]::WriteAllText($batPath, $bat, $oem)

# 매니페스트 생성 (JSON 안의 백슬래시는 이스케이프)
$manifest = Get-Content (Join-Path $PSScriptRoot 'com.buoy.kakao.json.template') -Raw
$manifest = $manifest.Replace('__HOST_BAT_PATH__', $batPath.Replace('\', '\\')).Replace('__EXTENSION_ID__', $ExtensionId)
$manifestPath = Join-Path $InstallDir "$HostName.json"
[IO.File]::WriteAllText($manifestPath, $manifest, (New-Object Text.UTF8Encoding $false))

# 레지스트리 등록
$regBase = switch ($Browser) {
  'chrome' { 'HKCU:\Software\Google\Chrome\NativeMessagingHosts' }
  'edge'   { 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts' }
  'whale'  { 'HKCU:\Software\Naver\Naver Whale\NativeMessagingHosts' }
}
$key = Join-Path $regBase $HostName
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name '(default)' -Value $manifestPath

Write-Host "등록 완료"
Write-Host "  host.bat  : $batPath"
Write-Host "  manifest  : $manifestPath"
Write-Host "  registry  : $key"
Write-Host "  adapter   : $Adapter   python: $PythonExe"
Write-Host "확장을 새로고침한 뒤 아이콘을 클릭하세요. 로그: $env:LOCALAPPDATA\Buoy\kakao-host.log"
