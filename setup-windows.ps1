$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host '==== ShareHub Desktop prerequisites installer ===='
Write-Host 'Installs the MSVC C++ build tools + Rust so you can build the app.'
Write-Host 'This downloads a few hundred MB and can take 10-20 minutes. Leave it running.'
Write-Host ''

# 1) Visual Studio Build Tools (C++), needed for the MSVC linker Rust uses
try {
  $vs = Join-Path $env:TEMP 'vs_BuildTools.exe'
  Write-Host '[1/2] Downloading Visual Studio Build Tools...'
  Invoke-WebRequest 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile $vs
  Write-Host '      Installing C++ workload (several minutes, no window may appear)...'
  Start-Process -FilePath $vs -Wait -ArgumentList @(
    '--quiet','--wait','--norestart','--nocache',
    '--add','Microsoft.VisualStudio.Workload.VCTools',
    '--add','Microsoft.VisualStudio.Component.Windows11SDK.22621',
    '--includeRecommended'
  )
  Write-Host '      C++ build tools done.'
} catch {
  Write-Host "      [!] Build Tools step failed: $($_.Exception.Message)"
  Write-Host '      You can also install manually: https://visualstudio.microsoft.com/visual-cpp-build-tools/'
}

# 2) Rust (rustup, MSVC toolchain)
try {
  $ru = Join-Path $env:TEMP 'rustup-init.exe'
  Write-Host '[2/2] Downloading Rust installer...'
  Invoke-WebRequest 'https://win.rustup.rs/x86_64' -OutFile $ru
  Write-Host '      Installing Rust (stable-msvc)...'
  Start-Process -FilePath $ru -Wait -ArgumentList '-y','--default-toolchain','stable-msvc','--profile','default'
  Write-Host '      Rust done.'
} catch {
  Write-Host "      [!] Rust step failed: $($_.Exception.Message)"
}

Write-Host ''
Write-Host '==== Finished ===='
Write-Host 'Close this window, open a NEW PowerShell, and run:  cargo --version'
Write-Host 'Then, in the desktop folder:  npm run tauri dev'
Write-Host ''
Read-Host 'Press Enter to close'
