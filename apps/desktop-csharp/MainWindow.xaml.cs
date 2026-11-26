using System.IO;
using System.Windows;

namespace ApiOpen.Desktop;

public partial class MainWindow : Window
{
    private readonly DesktopBridge _bridge = new();

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await WebView.EnsureCoreWebView2Async();

        WebView.CoreWebView2.AddHostObjectToScript("apiOpenCSharpBridge", _bridge);

        await WebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"
            (() => {
              if (window.apiOpenDesktop) return;
              window.apiOpenDesktop = {
                platform: 'win32',
                isDesktop: true,
                runtime: 'csharp-webview2',
                executeRequest: async (payload) => {
                  const bridge = window.chrome && window.chrome.webview && window.chrome.webview.hostObjects && window.chrome.webview.hostObjects.apiOpenCSharpBridge;
                  if (!bridge) throw new Error('C# Desktop bridge is unavailable');
                  const raw = await bridge.ExecuteRequestAsync(JSON.stringify(payload));
                  return JSON.parse(raw);
                }
              };
            })();
        ");

        var targetUrl = Environment.GetEnvironmentVariable("API_OPEN_URL");
        if (!string.IsNullOrWhiteSpace(targetUrl))
        {
            WebView.CoreWebView2.Navigate(targetUrl);
            return;
        }

        var localDist = Path.GetFullPath(
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "web", "dist", "index.html"));
        if (File.Exists(localDist))
        {
            WebView.CoreWebView2.Navigate(new Uri(localDist).AbsoluteUri);
            return;
        }

        WebView.CoreWebView2.Navigate("http://localhost:5173");
    }
}
