#ifndef UNICODE
#define UNICODE
#endif

#include <windows.h>
#include <objbase.h>
#include <winhttp.h>
#include <wrl.h>
#include <WebView2.h>
#include <nlohmann/json.hpp>

#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using json = nlohmann::json;

namespace {

ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;

std::wstring Utf8ToWide(const std::string& input) {
  if (input.empty()) return L"";
  int len = MultiByteToWideChar(CP_UTF8, 0, input.c_str(), (int)input.size(), nullptr, 0);
  std::wstring out(len, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, input.c_str(), (int)input.size(), out.data(), len);
  return out;
}

std::string WideToUtf8(const std::wstring& input) {
  if (input.empty()) return "";
  int len = WideCharToMultiByte(CP_UTF8, 0, input.c_str(), (int)input.size(), nullptr, 0, nullptr, nullptr);
  std::string out(len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, input.c_str(), (int)input.size(), out.data(), len, nullptr, nullptr);
  return out;
}

std::string Base64Encode(const std::vector<unsigned char>& data) {
  static constexpr char kAlphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  int val = 0;
  int valb = -6;
  for (unsigned char c : data) {
    val = (val << 8) + c;
    valb += 8;
    while (valb >= 0) {
      out.push_back(kAlphabet[(val >> valb) & 0x3F]);
      valb -= 6;
    }
  }
  if (valb > -6) out.push_back(kAlphabet[((val << 8) >> (valb + 8)) & 0x3F]);
  while (out.size() % 4) out.push_back('=');
  return out;
}

std::string UrlEncode(const std::string& value) {
  std::ostringstream escaped;
  for (unsigned char c : value) {
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      escaped << c;
    } else {
      char buf[4];
      snprintf(buf, sizeof(buf), "%%%02X", c);
      escaped << buf;
    }
  }
  return escaped.str();
}

json ExecuteWinHttpRequest(const json& payload) {
  auto startedAt = std::chrono::steady_clock::now();

  std::string urlStr = payload.value("url", "");
  std::string method = payload.value("method", "GET");
  for (auto& ch : method) ch = static_cast<char>(toupper(static_cast<unsigned char>(ch)));

  if (payload.contains("queryParams") && payload["queryParams"].is_object()) {
    bool hasQuery = urlStr.find('?') != std::string::npos;
    for (auto& [k, v] : payload["queryParams"].items()) {
      if (k.empty()) continue;
      urlStr += (hasQuery ? "&" : "?");
      hasQuery = true;
      std::string qVal = v.is_null() ? std::string("") : (v.is_string() ? v.get<std::string>() : v.dump());
      urlStr += UrlEncode(k) + "=" + UrlEncode(qVal);
    }
  }

  std::wstring wUrl = Utf8ToWide(urlStr);
  URL_COMPONENTS uc{};
  uc.dwStructSize = sizeof(uc);
  wchar_t hostBuf[512]{};
  wchar_t pathBuf[4096]{};
  uc.lpszHostName = hostBuf;
  uc.dwHostNameLength = _countof(hostBuf);
  uc.lpszUrlPath = pathBuf;
  uc.dwUrlPathLength = _countof(pathBuf);

  if (!WinHttpCrackUrl(wUrl.c_str(), (DWORD)wUrl.size(), 0, &uc)) {
    throw std::runtime_error("Invalid target URL");
  }

  bool isHttps = (uc.nScheme == INTERNET_SCHEME_HTTPS);
  std::wstring wMethod = Utf8ToWide(method);
  std::wstring wPath = pathBuf[0] ? std::wstring(pathBuf) : L"/";

  HINTERNET hSession = WinHttpOpen(L"ApiOpenDesktopCpp/1.0",
                                   WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                   WINHTTP_NO_PROXY_NAME,
                                   WINHTTP_NO_PROXY_BYPASS,
                                   0);
  if (!hSession) throw std::runtime_error("WinHttpOpen failed");

  int timeoutMs = payload.value("timeoutMs", 15000);
  if (timeoutMs < 500) timeoutMs = 500;
  if (timeoutMs > 30000) timeoutMs = 30000;
  WinHttpSetTimeouts(hSession, timeoutMs, timeoutMs, timeoutMs, timeoutMs);

  HINTERNET hConnect = WinHttpConnect(hSession, hostBuf, uc.nPort, 0);
  if (!hConnect) {
    WinHttpCloseHandle(hSession);
    throw std::runtime_error("WinHttpConnect failed");
  }

  DWORD flags = isHttps ? WINHTTP_FLAG_SECURE : 0;
  HINTERNET hRequest = WinHttpOpenRequest(hConnect,
                                          wMethod.c_str(),
                                          wPath.c_str(),
                                          nullptr,
                                          WINHTTP_NO_REFERER,
                                          WINHTTP_DEFAULT_ACCEPT_TYPES,
                                          flags);
  if (!hRequest) {
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    throw std::runtime_error("WinHttpOpenRequest failed");
  }

  bool verifySsl = payload.value("verifySsl", true);
  if (isHttps && !verifySsl) {
    DWORD secFlags = SECURITY_FLAG_IGNORE_UNKNOWN_CA |
                     SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE |
                     SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
                     SECURITY_FLAG_IGNORE_CERT_DATE_INVALID;
    WinHttpSetOption(hRequest, WINHTTP_OPTION_SECURITY_FLAGS, &secFlags, sizeof(secFlags));
  }

  std::wstring headersBlock;
  bool hasContentType = false;
  if (payload.contains("headers") && payload["headers"].is_object()) {
    for (auto& [k, v] : payload["headers"].items()) {
      if (k.empty() || v.is_null()) continue;
      std::string valStr = v.is_string() ? v.get<std::string>() : v.dump();
      std::string lowerKey = k;
      for (auto& c : lowerKey) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
      if (lowerKey == "content-type") hasContentType = true;
      headersBlock += Utf8ToWide(k + ": " + valStr + "\r\n");
    }
  }

  if (payload.contains("auth") && payload["auth"].is_object()) {
    std::string authType = payload["auth"].value("type", "none");
    if (authType == "bearer" && payload["auth"].contains("bearer")) {
      std::string token = payload["auth"]["bearer"].value("token", "");
      if (!token.empty()) headersBlock += Utf8ToWide("Authorization: Bearer " + token + "\r\n");
    } else if (authType == "basic" && payload["auth"].contains("basic")) {
      std::string user = payload["auth"]["basic"].value("username", "");
      std::string pass = payload["auth"]["basic"].value("password", "");
      std::string rawCred = user + ":" + pass;
      std::vector<unsigned char> vec(rawCred.begin(), rawCred.end());
      headersBlock += Utf8ToWide("Authorization: Basic " + Base64Encode(vec) + "\r\n");
    } else if (authType == "apikey" && payload["auth"].contains("apiKey")) {
      std::string addTo = payload["auth"]["apiKey"].value("addTo", "header");
      std::string key = payload["auth"]["apiKey"].value("key", "");
      std::string val = payload["auth"]["apiKey"].value("value", "");
      if (addTo != "query" && !key.empty()) {
        headersBlock += Utf8ToWide(key + ": " + val + "\r\n");
      }
    }
  }

  std::string bodyBytes;
  if (method != "GET" && method != "HEAD" && payload.contains("body") && payload["body"].is_object()) {
    std::string mode = payload["body"].value("mode", "none");
    if (mode == "raw") {
      bodyBytes = payload["body"].value("raw", "");
      if (!hasContentType && payload["body"].value("rawType", "") == "json") {
        headersBlock += L"Content-Type: application/json\r\n";
      }
    } else if (mode == "urlencoded" && payload["body"].contains("urlencoded")) {
      bool first = true;
      for (const auto& row : payload["body"]["urlencoded"]) {
        if (!row.value("enabled", true)) continue;
        std::string k = row.value("key", "");
        if (k.empty()) continue;
        if (!first) bodyBytes += "&";
        first = false;
        bodyBytes += UrlEncode(k) + "=" + UrlEncode(row.value("value", ""));
      }
      if (!hasContentType) headersBlock += L"Content-Type: application/x-www-form-urlencoded\r\n";
    } else if (mode == "graphql" && payload["body"].contains("graphql")) {
      json gqlBody;
      gqlBody["query"] = payload["body"]["graphql"].value("query", "");
      gqlBody["variables"] = json::object();
      try {
        std::string varsStr = payload["body"]["graphql"].value("variables", "");
        if (!varsStr.empty()) gqlBody["variables"] = json::parse(varsStr);
      } catch (...) {
      }
      bodyBytes = gqlBody.dump();
      if (!hasContentType) headersBlock += L"Content-Type: application/json\r\n";
    }
  }

  if (!headersBlock.empty()) {
    WinHttpAddRequestHeaders(hRequest, headersBlock.c_str(), (DWORD)-1L, WINHTTP_ADDREQ_FLAG_ADD);
  }

  BOOL sent = WinHttpSendRequest(
      hRequest,
      WINHTTP_NO_ADDITIONAL_HEADERS,
      0,
      bodyBytes.empty() ? WINHTTP_NO_REQUEST_DATA : (LPVOID)bodyBytes.data(),
      (DWORD)bodyBytes.size(),
      (DWORD)bodyBytes.size(),
      0);

  if (!sent || !WinHttpReceiveResponse(hRequest, nullptr)) {
    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    throw std::runtime_error("HTTP request failed");
  }

  DWORD statusCode = 0;
  DWORD statusSize = sizeof(statusCode);
  WinHttpQueryHeaders(hRequest,
                      WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                      WINHTTP_HEADER_NAME_BY_INDEX,
                      &statusCode,
                      &statusSize,
                      WINHTTP_NO_HEADER_INDEX);

  DWORD rawHeaderSize = 0;
  WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX, nullptr, &rawHeaderSize, WINHTTP_NO_HEADER_INDEX);
  std::wstring rawHeaders(rawHeaderSize / sizeof(wchar_t), L'\0');
  if (rawHeaderSize > 0) {
    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX, rawHeaders.data(), &rawHeaderSize, WINHTTP_NO_HEADER_INDEX);
  }

  json respHeaders = json::object();
  std::istringstream headerStream(WideToUtf8(rawHeaders));
  std::string line;
  while (std::getline(headerStream, line)) {
    auto colon = line.find(':');
    if (colon == std::string::npos) continue;
    std::string k = line.substr(0, colon);
    std::string v = line.substr(colon + 1);
    for (auto& c : k) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
    while (!v.empty() && (v.front() == ' ' || v.front() == '\t')) v.erase(v.begin());
    while (!v.empty() && (v.back() == '\r' || v.back() == '\n')) v.pop_back();
    respHeaders[k] = v;
  }

  std::vector<unsigned char> respBuffer;
  DWORD available = 0;
  while (WinHttpQueryDataAvailable(hRequest, &available) && available > 0) {
    size_t offset = respBuffer.size();
    respBuffer.resize(offset + available);
    DWORD downloaded = 0;
    if (!WinHttpReadData(hRequest, respBuffer.data() + offset, available, &downloaded)) break;
    respBuffer.resize(offset + downloaded);
  }

  WinHttpCloseHandle(hRequest);
  WinHttpCloseHandle(hConnect);
  WinHttpCloseHandle(hSession);

  auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - startedAt).count();
  if (elapsedMs < 1) elapsedMs = 1;

  std::string contentType = respHeaders.value("content-type", "");
  for (auto& c : contentType) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
  bool isBinary = contentType.rfind("image/", 0) == 0 ||
                  contentType.find("application/octet-stream") != std::string::npos ||
                  contentType.find("application/pdf") != std::string::npos;

  json out;
  out["status"] = statusCode;
  out["statusText"] = "";
  out["headers"] = respHeaders;
  out["body"] = isBinary ? Base64Encode(respBuffer) : std::string(respBuffer.begin(), respBuffer.end());
  out["isBase64"] = isBinary;
  out["sizeBytes"] = respBuffer.size();
  out["durationMs"] = elapsedMs;
  out["timing"] = {{"totalMs", elapsedMs}};
  return out;
}

std::wstring GetTargetAppUrl() {
  wchar_t envBuf[2048]{};
  DWORD len = GetEnvironmentVariableW(L"API_OPEN_URL", envBuf, _countof(envBuf));
  if (len > 0 && len < _countof(envBuf)) {
    return std::wstring(envBuf);
  }

  wchar_t exePath[MAX_PATH]{};
  GetModuleFileNameW(nullptr, exePath, MAX_PATH);
  std::filesystem::path p(exePath);
  auto distPath = std::filesystem::weakly_canonical(p.parent_path() / L".." / L".." / L"web" / L"dist" / L"index.html");
  if (std::filesystem::exists(distPath)) {
    return L"file:///" + distPath.wstring();
  }
  return L"http://localhost:5173";
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case WM_SIZE:
      if (g_controller) {
        RECT bounds{};
        GetClientRect(hwnd, &bounds);
        g_controller->put_Bounds(bounds);
      }
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

}  // namespace

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, PWSTR, int nCmdShow) {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  WNDCLASSW wc{};
  wc.lpfnWndProc = WndProc;
  wc.hInstance = hInstance;
  wc.lpszClassName = L"ApiOpenDesktopCppWindow";
  RegisterClassW(&wc);

  HWND hwnd = CreateWindowExW(
      0,
      wc.lpszClassName,
      L"Api-Open (C++ Desktop)",
      WS_OVERLAPPEDWINDOW,
      CW_USEDEFAULT, CW_USEDEFAULT, 1360, 860,
      nullptr, nullptr, hInstance, nullptr);

  ShowWindow(hwnd, nCmdShow);

  CreateCoreWebView2EnvironmentWithOptions(
      nullptr, nullptr, nullptr,
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [hwnd](HRESULT, ICoreWebView2Environment* env) -> HRESULT {
            env->CreateCoreWebView2Controller(
                hwnd,
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [hwnd](HRESULT, ICoreWebView2Controller* controller) -> HRESULT {
                      if (!controller) return E_FAIL;
                      g_controller = controller;
                      g_controller->get_CoreWebView2(&g_webview);

                      RECT bounds{};
                      GetClientRect(hwnd, &bounds);
                      g_controller->put_Bounds(bounds);

                      g_webview->AddScriptToExecuteOnDocumentCreated(
                          LR"(
                            (() => {
                              if (window.apiOpenDesktop) return;
                              const pending = new Map();
                              window.chrome.webview.addEventListener('message', (event) => {
                                const msg = event.data;
                                if (!msg || msg.type !== 'api-open:cpp-response') return;
                                const entry = pending.get(msg.id);
                                if (!entry) return;
                                pending.delete(msg.id);
                                if (msg.ok) entry.resolve(msg.result);
                                else entry.reject(new Error(msg.error || 'C++ Desktop request failed'));
                              });
                              window.apiOpenDesktop = {
                                platform: 'win32',
                                isDesktop: true,
                                runtime: 'cpp-webview2',
                                executeRequest: (payload) => new Promise((resolve, reject) => {
                                  const id = Math.random().toString(36).slice(2);
                                  pending.set(id, { resolve, reject });
                                  window.chrome.webview.postMessage({
                                    type: 'api-open:cpp-request',
                                    id,
                                    payload
                                  });
                                })
                              };
                            })();
                          )",
                          nullptr);

                      g_webview->add_WebMessageReceived(
                          Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                              [hwnd](ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                LPWSTR rawMsg = nullptr;
                                args->get_WebMessageAsJson(&rawMsg);
                                if (!rawMsg) return S_OK;
                                std::string msgStr = WideToUtf8(rawMsg);
                                CoTaskMemFree(rawMsg);

                                std::thread([msgStr, sender]() {
                                  json responseMsg;
                                  try {
                                    auto parsed = json::parse(msgStr);
                                    if (parsed.value("type", "") != "api-open:cpp-request") return;
                                    responseMsg["type"] = "api-open:cpp-response";
                                    responseMsg["id"] = parsed.value("id", "");
                                    responseMsg["ok"] = true;
                                    responseMsg["result"] = ExecuteWinHttpRequest(parsed["payload"]);
                                  } catch (const std::exception& ex) {
                                    responseMsg["type"] = "api-open:cpp-response";
                                    responseMsg["ok"] = false;
                                    responseMsg["error"] = ex.what();
                                  }
                                  std::wstring wReply = Utf8ToWide(responseMsg.dump());
                                  sender->PostWebMessageAsJson(wReply.c_str());
                                }).detach();
                                return S_OK;
                              }).Get(),
                          nullptr);

                      std::wstring targetUrl = GetTargetAppUrl();
                      g_webview->Navigate(targetUrl.c_str());
                      return S_OK;
                    }).Get());
            return S_OK;
          }).Get());

  MSG msg{};
  while (GetMessageW(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  CoUninitialize();
  return 0;
}
