# Api-Open Desktop (C++17 + Win32 + WebView2)

Native Windows C++ desktop wrapper for **Api-Open** using **Win32**, **Microsoft Edge WebView2**, and **WinHTTP** as a local CORS-free `Desktop Agent` (`window.apiOpenDesktop`).

## Prerequisites
- CMake 3.20+
- Visual Studio 2022 (MSVC C++17) or MinGW-w64
- Microsoft Edge WebView2 Runtime (built into Windows 10/11)

## Build & Run
```powershell
cd apps/desktop-cpp
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
.\build\Release\ApiOpenDesktop.exe
```

Optional environment variable to point to a deployed web URL:
```powershell
$env:API_OPEN_URL="https://your-api-open-domain.vercel.app"
```
