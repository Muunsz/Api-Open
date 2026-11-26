cmake_minimum_required(VERSION 3.20)
project(ApiOpenDesktopCpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

FetchContent_Declare(
  nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
)
FetchContent_MakeAvailable(nlohmann_json)

FetchContent_Declare(
  webview2
  URL https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2903.40
)
FetchContent_MakeAvailable(webview2)

add_executable(ApiOpenDesktop WIN32
  src/main.cpp
)

target_include_directories(ApiOpenDesktop PRIVATE
  "${webview2_SOURCE_DIR}/build/native/include"
)

if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  set(WEBVIEW2_ARCH "x64")
else()
  set(WEBVIEW2_ARCH "x86")
endif()

target_link_libraries(ApiOpenDesktop PRIVATE
  nlohmann_json::nlohmann_json
  "${webview2_SOURCE_DIR}/build/native/${WEBVIEW2_ARCH}/WebView2LoaderStatic.lib"
  winhttp
  ole32
  oleaut32
  shlwapi
  version
)
