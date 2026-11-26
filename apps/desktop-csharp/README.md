# Api-Open Desktop (C# / .NET 8 WPF + WebView2)

Native Windows desktop wrapper for **Api-Open** built with **C# (.NET 8 WPF)** and **Microsoft Edge WebView2**, complete with a native C# `HttpClient` Local Agent (`DesktopBridge`) so requests to `localhost` and external APIs work directly without CORS or a cloud proxy.

## Prerequisites
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- Microsoft Edge WebView2 Runtime (pre-installed on Windows 10/11)

## Run Locally
```powershell
cd apps/desktop-csharp
# Optional: point to deployed web URL
# $env:API_OPEN_URL="https://your-api-open-domain.vercel.app"
dotnet run
```

## Build Standalone Windows Executable (.exe)
```powershell
cd apps/desktop-csharp
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```
