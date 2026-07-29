# Windows 全流程 e2e 测试编排：三阶段（全功能 → 重启恢复 → 坏文件恢复）
# 用法：powershell -ExecutionPolicy Bypass -File tests\e2e\run-e2e.ps1
# 注意：会清空 %APPDATA%\bethel-church-audio-player（开发数据），并结束所有 electron.exe 进程
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$userData = Join-Path $env:APPDATA 'bethel-church-audio-player'
Set-Location $root

function Stop-App {
  taskkill /F /T /IM electron.exe 2>$null | Out-Null
  Start-Sleep -Seconds 3
}

function Start-App {
  $script:devProc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm run dev -- -- --remote-debugging-port=9222' `
    -WorkingDirectory $root -PassThru -WindowStyle Hidden
  # 等待 CDP 端口就绪
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
      Invoke-RestMethod -Uri 'http://127.0.0.1:9222/json' -TimeoutSec 2 | Out-Null
      return
    } catch { }
  }
  throw '应用启动超时（CDP 端口未就绪）'
}

$failed = 0

Write-Host '=== 阶段 1/3：全功能流程 ===' -ForegroundColor Cyan
Stop-App
Remove-Item -Recurse -Force $userData -ErrorAction SilentlyContinue
Start-App
node tests/e2e/driver.mjs 1
if ($LASTEXITCODE -ne 0) { $failed++ }

Write-Host '=== 阶段 2/3：重启恢复 + 关闭驻留托盘 ===' -ForegroundColor Cyan
Stop-App
Start-App
node tests/e2e/driver.mjs 2
if ($LASTEXITCODE -ne 0) { $failed++ }

Write-Host '=== 阶段 3/3：损坏 library.json 自动恢复 ===' -ForegroundColor Cyan
Stop-App
Set-Content -Path (Join-Path $userData 'library.json') -Value '{corrupted!!! not json'
Start-App
node tests/e2e/driver.mjs 3
if ($LASTEXITCODE -ne 0) { $failed++ }

Stop-App
Remove-Item -Recurse -Force $userData -ErrorAction SilentlyContinue

if ($failed -eq 0) {
  Write-Host "`n全部三阶段通过 ✔" -ForegroundColor Green
} else {
  Write-Host "`n有 $failed 个阶段存在失败项，请查看上方输出" -ForegroundColor Red
  exit 1
}
