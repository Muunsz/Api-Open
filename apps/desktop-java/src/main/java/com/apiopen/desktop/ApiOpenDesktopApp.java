package com.apiopen.desktop;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import javafx.application.Application;
import javafx.concurrent.Worker;
import javafx.scene.Scene;
import javafx.scene.web.WebEngine;
import javafx.scene.web.WebView;
import javafx.stage.Stage;
import netscape.javascript.JSObject;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.io.File;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

public class ApiOpenDesktopApp extends Application {
    private static final Gson GSON = new Gson();
    private final JavaDesktopBridge bridge = new JavaDesktopBridge();

    @Override
    public void start(Stage stage) {
        WebView webView = new WebView();
        WebEngine engine = webView.getEngine();

        engine.getLoadWorker().stateProperty().addListener((obs, oldState, newState) -> {
            if (newState == Worker.State.SUCCEEDED) {
                JSObject window = (JSObject) engine.executeScript("window");
                window.setMember("apiOpenJavaBridge", bridge);
                engine.executeScript("""
                    (() => {
                      if (window.apiOpenDesktop) return;
                      window.apiOpenDesktop = {
                        platform: navigator.platform || 'java',
                        isDesktop: true,
                        runtime: 'java-javafx',
                        executeRequest: (payload) => new Promise((resolve, reject) => {
                          try {
                            const raw = window.apiOpenJavaBridge.executeRequest(JSON.stringify(payload));
                            resolve(JSON.parse(raw));
                          } catch (err) {
                            reject(err);
                          }
                        })
                      };
                    })();
                """);
            }
        });

        engine.load(resolveTargetUrl());

        Scene scene = new Scene(webView, 1360, 860);
        stage.setTitle("Api-Open (Java Desktop)");
        stage.setMinWidth(960);
        stage.setMinHeight(640);
        stage.setScene(scene);
        stage.show();
    }

    private String resolveTargetUrl() {
        String envUrl = System.getenv("API_OPEN_URL");
        if (envUrl != null && !envUrl.isBlank()) {
            return envUrl.trim();
        }
        File localDist = new File("../web/dist/index.html");
        if (localDist.exists()) {
            return localDist.toURI().toString();
        }
        return "http://localhost:5173";
    }

    public static class JavaDesktopBridge {
        public String executeRequest(String payloadJson) {
            try {
                JsonObject root = GSON.fromJson(payloadJson, JsonObject.class);
                String rawUrl = root.get("url").getAsString();
                String method = root.has("method")
                        ? root.get("method").getAsString().toUpperCase()
                        : "GET";

                StringBuilder urlBuilder = new StringBuilder(rawUrl);
                if (root.has("queryParams") && root.get("queryParams").isJsonObject()) {
                    JsonObject qp = root.getAsJsonObject("queryParams");
                    boolean hasQuery = rawUrl.contains("?");
                    for (Map.Entry<String, JsonElement> entry : qp.entrySet()) {
                        if (entry.getKey().isBlank()) continue;
                        urlBuilder.append(hasQuery ? "&" : "?");
                        hasQuery = true;
                        String val = entry.getValue().isJsonNull() ? "" : entry.getValue().getAsString();
                        urlBuilder.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8))
                                .append("=")
                                .append(URLEncoder.encode(val, StandardCharsets.UTF_8));
                    }
                }

                if (root.has("auth") && root.get("auth").isJsonObject()) {
                    JsonObject auth = root.getAsJsonObject("auth");
                    String authType = auth.has("type") ? auth.get("type").getAsString() : "none";
                    if ("apikey".equals(authType) && auth.has("apiKey") && auth.get("apiKey").isJsonObject()) {
                        JsonObject apiKey = auth.getAsJsonObject("apiKey");
                        String addTo = apiKey.has("addTo") ? apiKey.get("addTo").getAsString() : "header";
                        String k = apiKey.has("key") ? apiKey.get("key").getAsString() : "";
                        String v = apiKey.has("value") ? apiKey.get("value").getAsString() : "";
                        if ("query".equals(addTo) && !k.isBlank()) {
                            urlBuilder.append(urlBuilder.toString().contains("?") ? "&" : "?")
                                    .append(URLEncoder.encode(k, StandardCharsets.UTF_8))
                                    .append("=")
                                    .append(URLEncoder.encode(v, StandardCharsets.UTF_8));
                        }
                    }
                }

                int timeoutMs = root.has("timeoutMs") ? Math.min(Math.max(root.get("timeoutMs").getAsInt(), 500), 30000) : 15000;
                boolean verifySsl = !root.has("verifySsl") || root.get("verifySsl").getAsBoolean();
                boolean followRedirects = !root.has("followRedirects") || root.get("followRedirects").getAsBoolean();

                HttpClient.Builder clientBuilder = HttpClient.newBuilder()
                        .connectTimeout(Duration.ofMillis(timeoutMs))
                        .followRedirects(followRedirects ? HttpClient.Redirect.NORMAL : HttpClient.Redirect.NEVER);

                if (!verifySsl) {
                    TrustManager[] trustAll = new TrustManager[]{
                            new X509TrustManager() {
                                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                                public void checkClientTrusted(X509Certificate[] certs, String authType) {}
                                public void checkServerTrusted(X509Certificate[] certs, String authType) {}
                            }
                    };
                    SSLContext sc = SSLContext.getInstance("TLS");
                    sc.init(null, trustAll, new SecureRandom());
                    clientBuilder.sslContext(sc);
                }

                HttpClient client = clientBuilder.build();
                HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                        .uri(URI.create(urlBuilder.toString()))
                        .timeout(Duration.ofMillis(timeoutMs));

                String explicitContentType = null;
                if (root.has("headers") && root.get("headers").isJsonObject()) {
                    for (Map.Entry<String, JsonElement> entry : root.getAsJsonObject("headers").entrySet()) {
                        if (entry.getKey().isBlank() || entry.getValue().isJsonNull()) continue;
                        String val = entry.getValue().getAsString();
                        if ("content-type".equalsIgnoreCase(entry.getKey())) {
                            explicitContentType = val;
                        }
                        reqBuilder.header(entry.getKey(), val);
                    }
                }

                if (root.has("auth") && root.get("auth").isJsonObject()) {
                    JsonObject auth = root.getAsJsonObject("auth");
                    String authType = auth.has("type") ? auth.get("type").getAsString() : "none";
                    if ("bearer".equals(authType) && auth.has("bearer")) {
                        String tok = auth.getAsJsonObject("bearer").get("token").getAsString();
                        if (!tok.isBlank()) reqBuilder.header("Authorization", "Bearer " + tok);
                    } else if ("basic".equals(authType) && auth.has("basic")) {
                        JsonObject b = auth.getAsJsonObject("basic");
                        String user = b.has("username") ? b.get("username").getAsString() : "";
                        String pass = b.has("password") ? b.get("password").getAsString() : "";
                        String encoded = Base64.getEncoder().encodeToString((user + ":" + pass).getBytes(StandardCharsets.UTF_8));
                        reqBuilder.header("Authorization", "Basic " + encoded);
                    } else if ("apikey".equals(authType) && auth.has("apiKey")) {
                        JsonObject apiKey = auth.getAsJsonObject("apiKey");
                        String addTo = apiKey.has("addTo") ? apiKey.get("addTo").getAsString() : "header";
                        String k = apiKey.has("key") ? apiKey.get("key").getAsString() : "";
                        String v = apiKey.has("value") ? apiKey.get("value").getAsString() : "";
                        if (!"query".equals(addTo) && !k.isBlank()) {
                            reqBuilder.header(k, v);
                        }
                    }
                }

                HttpRequest.BodyPublisher bodyPublisher = HttpRequest.BodyPublishers.noBody();
                if (!"GET".equals(method) && !"HEAD".equals(method) && root.has("body") && root.get("body").isJsonObject()) {
                    JsonObject body = root.getAsJsonObject("body");
                    String mode = body.has("mode") ? body.get("mode").getAsString() : "none";
                    if ("raw".equals(mode)) {
                        String raw = body.has("raw") ? body.get("raw").getAsString() : "";
                        if (explicitContentType == null && body.has("rawType") && "json".equals(body.get("rawType").getAsString())) {
                            reqBuilder.header("Content-Type", "application/json");
                        }
                        bodyPublisher = HttpRequest.BodyPublishers.ofString(raw);
                    } else if ("urlencoded".equals(mode) && body.has("urlencoded") && body.get("urlencoded").isJsonArray()) {
                        JsonArray arr = body.getAsJsonArray("urlencoded");
                        StringBuilder form = new StringBuilder();
                        for (JsonElement el : arr) {
                            JsonObject row = el.getAsJsonObject();
                            boolean enabled = !row.has("enabled") || row.get("enabled").getAsBoolean();
                            String k = row.has("key") ? row.get("key").getAsString() : "";
                            String v = row.has("value") ? row.get("value").getAsString() : "";
                            if (enabled && !k.isBlank()) {
                                if (!form.isEmpty()) form.append("&");
                                form.append(URLEncoder.encode(k, StandardCharsets.UTF_8))
                                        .append("=")
                                        .append(URLEncoder.encode(v, StandardCharsets.UTF_8));
                            }
                        }
                        if (explicitContentType == null) {
                            reqBuilder.header("Content-Type", "application/x-www-form-urlencoded");
                        }
                        bodyPublisher = HttpRequest.BodyPublishers.ofString(form.toString());
                    } else if ("graphql".equals(mode) && body.has("graphql") && body.get("graphql").isJsonObject()) {
                        JsonObject gql = body.getAsJsonObject("graphql");
                        JsonObject payload = new JsonObject();
                        payload.addProperty("query", gql.has("query") ? gql.get("query").getAsString() : "");
                        try {
                            String varsStr = gql.has("variables") ? gql.get("variables").getAsString() : "{}";
                            payload.add("variables", GSON.fromJson(varsStr.isBlank() ? "{}" : varsStr, JsonElement.class));
                        } catch (Exception ignored) {
                            payload.add("variables", new JsonObject());
                        }
                        if (explicitContentType == null) {
                            reqBuilder.header("Content-Type", "application/json");
                        }
                        bodyPublisher = HttpRequest.BodyPublishers.ofString(GSON.toJson(payload));
                    }
                }

                reqBuilder.method(method, bodyPublisher);

                long start = System.currentTimeMillis();
                HttpResponse<byte[]> resp = client.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofByteArray());
                long durationMs = Math.max(1L, System.currentTimeMillis() - start);

                Map<String, String> respHeaders = new LinkedHashMap<>();
                resp.headers().map().forEach((k, v) -> respHeaders.put(k.toLowerCase(), String.join(", ", v)));

                String ct = respHeaders.getOrDefault("content-type", "").toLowerCase();
                boolean isBinary = ct.startsWith("image/") || ct.contains("application/octet-stream") || ct.contains("application/pdf");

                byte[] bytes = resp.body();
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("status", resp.statusCode());
                out.put("statusText", "");
                out.put("headers", respHeaders);
                out.put("body", isBinary ? Base64.getEncoder().encodeToString(bytes) : new String(bytes, StandardCharsets.UTF_8));
                out.put("isBase64", isBinary);
                out.put("sizeBytes", bytes.length);
                out.put("durationMs", durationMs);
                out.put("timing", Map.of("totalMs", durationMs));
                return GSON.toJson(out);
            } catch (Exception ex) {
                throw new RuntimeException(ex.getMessage(), ex);
            }
        }
    }

    public static void main(String[] args) {
        launch(args);
    }
}
