cmake_minimum_required(VERSION 3.20)
if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()
project(ApiOpenDesktopCpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

include(FetchContent)

FetchContent_Declare(
  nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
)
FetchContent_MakeAvailable(nlohmann_json)

set(WEBVIEW2_DIR "${CMAKE_CURRENT_SOURCE_DIR}/packages/webview2" CACHE PATH "Path to extracted Microsoft.Web.WebView2 package")

if(NOT EXISTS "${WEBVIEW2_DIR}/build/native/include/WebView2.h")
  message(FATAL_ERROR "WebView2 SDK not found at ${WEBVIEW2_DIR}. Extract Microsoft.Web.WebView2 NuGet package there or pass -DWEBVIEW2_DIR=...")
endif()

add_executable(ApiOpenDesktop WIN32
  src/main.cpp
)

target_include_directories(ApiOpenDesktop PRIVATE
  "${WEBVIEW2_DIR}/build/native/include"
)

if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  set(WEBVIEW2_ARCH "x64")
else()
  set(WEBVIEW2_ARCH "x86")
endif()

target_link_libraries(ApiOpenDesktop PRIVATE
  nlohmann_json::nlohmann_json
  "${WEBVIEW2_DIR}/build/native/${WEBVIEW2_ARCH}/WebView2LoaderStatic.lib"
  winhttp
  ole32
  oleaut32
  shlwapi
  version
)
