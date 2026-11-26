# Api-Open Desktop (Java 17 + JavaFX WebView)

Cross-platform Java desktop wrapper for **Api-Open** using **JavaFX WebView** and **`java.net.http.HttpClient`** as a local CORS-free `Desktop Agent` (`window.apiOpenDesktop`).

## Prerequisites
- JDK 17+
- Apache Maven 3.8+

## Run Locally
```powershell
cd apps/desktop-java
# Optional: point to deployed web URL
# $env:API_OPEN_URL="https://your-api-open-domain.vercel.app"
mvn javafx:run
```
