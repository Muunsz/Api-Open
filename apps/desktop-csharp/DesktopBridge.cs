using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace ApiOpen.Desktop;

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public class DesktopBridge
{
    public async Task<string> ExecuteRequestAsync(string payloadJson)
    {
        using var doc = JsonDocument.Parse(payloadJson);
        var root = doc.RootElement;

        var rawUrl = root.GetProperty("url").GetString()
            ?? throw new ArgumentException("Target URL is required");
        var methodName = root.TryGetProperty("method", out var mProp)
            ? (mProp.GetString() ?? "GET").ToUpperInvariant()
            : "GET";

        var uriBuilder = new UriBuilder(rawUrl);
        var query = System.Web.HttpUtility.ParseQueryString(uriBuilder.Query);

        if (root.TryGetProperty("queryParams", out var qp) && qp.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in qp.EnumerateObject())
            {
                if (!string.IsNullOrEmpty(prop.Name))
                {
                    query[prop.Name] = prop.Value.ValueKind == JsonValueKind.Null
                        ? string.Empty
                        : prop.Value.ToString();
                }
            }
        }

        if (root.TryGetProperty("auth", out var auth) && auth.ValueKind == JsonValueKind.Object)
        {
            var authType = auth.TryGetProperty("type", out var t) ? t.GetString() : null;
            if (authType == "apikey" && auth.TryGetProperty("apiKey", out var apiKey))
            {
                var addTo = apiKey.TryGetProperty("addTo", out var a) ? a.GetString() : "header";
                var key = apiKey.TryGetProperty("key", out var k) ? k.GetString() : null;
                var val = apiKey.TryGetProperty("value", out var v) ? v.GetString() : string.Empty;
                if (addTo == "query" && !string.IsNullOrEmpty(key))
                {
                    query[key] = val ?? string.Empty;
                }
            }
        }

        uriBuilder.Query = query.ToString();

        var verifySsl = !root.TryGetProperty("verifySsl", out var vSsl) || vSsl.ValueKind != JsonValueKind.False;
        var followRedirects = !root.TryGetProperty("followRedirects", out var fRed) || fRed.ValueKind != JsonValueKind.False;
        var maxRedirects = root.TryGetProperty("maxRedirects", out var mRed) && mRed.TryGetInt32(out var mr)
            ? Math.Clamp(mr, 0, 20)
            : 10;
        var timeoutMs = root.TryGetProperty("timeoutMs", out var tOut) && tOut.TryGetInt32(out var to)
            ? Math.Clamp(to, 500, 30000)
            : 15000;

        using var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = followRedirects,
            MaxAutomaticRedirections = Math.Max(1, maxRedirects),
            AutomaticDecompression = DecompressionMethods.All,
        };
        if (!verifySsl)
        {
            handler.SslOptions.RemoteCertificateValidationCallback = (_, _, _, _) => true;
        }

        using var client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromMilliseconds(timeoutMs),
        };

        using var req = new HttpRequestMessage(new HttpMethod(methodName), uriBuilder.Uri);
        string? explicitContentType = null;

        if (root.TryGetProperty("headers", out var hdrs) && hdrs.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in hdrs.EnumerateObject())
            {
                if (string.IsNullOrEmpty(prop.Name) || prop.Value.ValueKind == JsonValueKind.Null) continue;
                var val = prop.Value.ToString();
                if (prop.Name.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
                {
                    explicitContentType = val;
                    continue;
                }
                req.Headers.TryAddWithoutValidation(prop.Name, val);
            }
        }

        if (root.TryGetProperty("auth", out var authHdr) && authHdr.ValueKind == JsonValueKind.Object)
        {
            var authType = authHdr.TryGetProperty("type", out var t) ? t.GetString() : null;
            if (authType == "bearer" && authHdr.TryGetProperty("bearer", out var bearer))
            {
                var token = bearer.TryGetProperty("token", out var tok) ? tok.GetString() : null;
                if (!string.IsNullOrEmpty(token))
                {
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                }
            }
            else if (authType == "basic" && authHdr.TryGetProperty("basic", out var basic))
            {
                var user = basic.TryGetProperty("username", out var u) ? u.GetString() ?? string.Empty : string.Empty;
                var pass = basic.TryGetProperty("password", out var p) ? p.GetString() ?? string.Empty : string.Empty;
                var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user}:{pass}"));
                req.Headers.Authorization = new AuthenticationHeaderValue("Basic", encoded);
            }
            else if (authType == "apikey" && authHdr.TryGetProperty("apiKey", out var apiKey))
            {
                var addTo = apiKey.TryGetProperty("addTo", out var a) ? a.GetString() : "header";
                var key = apiKey.TryGetProperty("key", out var k) ? k.GetString() : null;
                var val = apiKey.TryGetProperty("value", out var v) ? v.GetString() ?? string.Empty : string.Empty;
                if (addTo != "query" && !string.IsNullOrEmpty(key))
                {
                    req.Headers.TryAddWithoutValidation(key, val);
                }
            }
        }

        if (methodName is not "GET" and not "HEAD" &&
            root.TryGetProperty("body", out var bodyEl) &&
            bodyEl.ValueKind == JsonValueKind.Object)
        {
            var mode = bodyEl.TryGetProperty("mode", out var modeProp) ? modeProp.GetString() : "none";
            if (mode == "raw")
            {
                var raw = bodyEl.TryGetProperty("raw", out var rProp) ? rProp.GetString() ?? string.Empty : string.Empty;
                var rawType = bodyEl.TryGetProperty("rawType", out var rtProp) ? rtProp.GetString() : "text";
                var mediaType = explicitContentType ?? (rawType == "json" ? "application/json" : "text/plain");
                req.Content = new StringContent(raw, Encoding.UTF8, mediaType);
            }
            else if (mode == "urlencoded" && bodyEl.TryGetProperty("urlencoded", out var urlEnc) && urlEnc.ValueKind == JsonValueKind.Array)
            {
                var pairs = new List<KeyValuePair<string, string>>();
                foreach (var item in urlEnc.EnumerateArray())
                {
                    var enabled = !item.TryGetProperty("enabled", out var en) || en.ValueKind != JsonValueKind.False;
                    var key = item.TryGetProperty("key", out var k) ? k.GetString() : null;
                    var val = item.TryGetProperty("value", out var v) ? v.GetString() ?? string.Empty : string.Empty;
                    if (enabled && !string.IsNullOrEmpty(key))
                    {
                        pairs.Add(new KeyValuePair<string, string>(key, val));
                    }
                }
                req.Content = new FormUrlEncodedContent(pairs);
            }
            else if (mode == "graphql" && bodyEl.TryGetProperty("graphql", out var gql) && gql.ValueKind == JsonValueKind.Object)
            {
                var gqlQuery = gql.TryGetProperty("query", out var qProp) ? qProp.GetString() ?? string.Empty : string.Empty;
                object varsObj = new { };
                if (gql.TryGetProperty("variables", out var vProp) && vProp.ValueKind == JsonValueKind.String)
                {
                    var vStr = vProp.GetString();
                    if (!string.IsNullOrWhiteSpace(vStr))
                    {
                        try { varsObj = JsonSerializer.Deserialize<object>(vStr) ?? new { }; }
                        catch { varsObj = new { }; }
                    }
                }
                var payload = JsonSerializer.Serialize(new { query = gqlQuery, variables = varsObj });
                req.Content = new StringContent(payload, Encoding.UTF8, explicitContentType ?? "application/json");
            }
        }

        var sw = Stopwatch.StartNew();
        using var resp = await client.SendAsync(req);
        var bytes = await resp.Content.ReadAsByteArrayAsync();
        sw.Stop();

        var responseHeaders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var h in resp.Headers)
        {
            responseHeaders[h.Key.ToLowerInvariant()] = string.Join(", ", h.Value);
        }
        foreach (var h in resp.Content.Headers)
        {
            responseHeaders[h.Key.ToLowerInvariant()] = string.Join(", ", h.Value);
        }

        var contentType = resp.Content.Headers.ContentType?.MediaType?.ToLowerInvariant() ?? string.Empty;
        var isBinary = contentType.StartsWith("image/") ||
                       contentType.Contains("application/octet-stream") ||
                       contentType.Contains("application/pdf");

        var durationMs = Math.Max(1, (int)sw.ElapsedMilliseconds);
        var result = new
        {
            status = (int)resp.StatusCode,
            statusText = resp.ReasonPhrase ?? string.Empty,
            headers = responseHeaders,
            body = isBinary ? Convert.ToBase64String(bytes) : Encoding.UTF8.GetString(bytes),
            isBase64 = isBinary,
            sizeBytes = bytes.Length,
            durationMs,
            timing = new { totalMs = durationMs },
        };

        return JsonSerializer.Serialize(result);
    }
}
