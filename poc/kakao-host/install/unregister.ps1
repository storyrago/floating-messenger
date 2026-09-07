param([ValidateSet('chrome', 'edge', 'whale')][string]$Browser = 'chrome')
$HostName = 'com.buoy.kakao'
$regBase = switch ($Browser) {
  'chrome' { 'HKCU:\Software\Google\Chrome\NativeMessagingHosts' }
  'edge'   { 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts' }
  'whale'  { 'HKCU:\Software\Naver\Naver Whale\NativeMessagingHosts' }
}
Remove-Item -Path (Join-Path $regBase $HostName) -Recurse -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $env:LOCALAPPDATA 'Buoy\kakao-host') -Recurse -ErrorAction SilentlyContinue
Write-Host "해제 완료 ($Browser)"
