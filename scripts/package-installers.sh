#!/usr/bin/env bash
set -euo pipefail

app_slug="${1:?usage: package-installers.sh APP_SLUG}"
release_version="${2:-dev}"
node_version="${NODE_RUNTIME_VERSION:-}"

if [[ -z "$node_version" ]]; then
  node_version="$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.lts and (.version | startswith("v22.")))][0].version')"
fi
[[ "$node_version" == v22.* ]] || { echo "Could not resolve a Node 22 runtime" >&2; exit 1; }

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
dist_dir="$(pwd)/dist"
mkdir -p "$dist_dir" "$work_dir/payload-source"
git archive HEAD | tar -x -C "$work_dir/payload-source"

make_common() {
  local bundle="$1"
  mkdir -p "$bundle/installer" "$bundle/payload"
  cp installer/launcher.cjs installer/lib.cjs installer/ui.html installer/launcher-config.json "$bundle/installer/"
  cp -R "$work_dir/payload-source/." "$bundle/payload/"
}

package_unix() {
  local os_name="$1" arch="$2" extension="$3" node_arch="$4"
  local archive="node-${node_version}-${os_name}-${node_arch}.${extension}"
  local url="https://nodejs.org/dist/${node_version}/${archive}"
  local bundle="$work_dir/${app_slug}-${release_version}-${os_name}-${arch}"
  curl -fsSL "$url" -o "$work_dir/$archive"
  mkdir -p "$work_dir/runtime-extract"
  if [[ "$extension" == "tar.xz" ]]; then tar -xJf "$work_dir/$archive" -C "$work_dir/runtime-extract"; else tar -xzf "$work_dir/$archive" -C "$work_dir/runtime-extract"; fi
  make_common "$bundle"
  mv "$work_dir/runtime-extract/node-${node_version}-${os_name}-${node_arch}" "$bundle/runtime"
  rm -rf "$work_dir/runtime-extract"
  if [[ "$os_name" == "darwin" ]]; then
    printf '%s\n' '#!/bin/sh' 'cd "$(dirname "$0")"' 'exec ./runtime/bin/node ./installer/launcher.cjs --config ./installer/launcher-config.json --ui ./installer/ui.html --payload ./payload' > "$bundle/Start Setup.command"
    chmod +x "$bundle/Start Setup.command"
    mkdir -p "$bundle/Jobber Automation MCP Setup.app/Contents/MacOS"
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' '<plist version="1.0"><dict><key>CFBundleName</key><string>Jobber Automation MCP Setup</string><key>CFBundleExecutable</key><string>launcher</string><key>CFBundleIdentifier</key><string>com.rmlawncare.jobber-automation-mcp.setup</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>' > "$bundle/Jobber Automation MCP Setup.app/Contents/Info.plist"
    printf '%s\n' '#!/bin/sh' 'base="$(cd "$(dirname "$0")/../../.." && pwd)"' 'cd "$base"' 'exec "$base/runtime/bin/node" "$base/installer/launcher.cjs" --config "$base/installer/launcher-config.json" --ui "$base/installer/ui.html" --payload "$base/payload"' > "$bundle/Jobber Automation MCP Setup.app/Contents/MacOS/launcher"
    chmod +x "$bundle/Jobber Automation MCP Setup.app/Contents/MacOS/launcher"
    tar -czf "$dist_dir/${app_slug}-${release_version}-macos-${arch}.tar.gz" -C "$work_dir" "$(basename "$bundle")"
  else
    printf '%s\n' '#!/bin/sh' 'cd "$(dirname "$0")"' 'exec ./runtime/bin/node ./installer/launcher.cjs --config ./installer/launcher-config.json --ui ./installer/ui.html --payload ./payload' > "$bundle/start-setup.sh"
    chmod +x "$bundle/start-setup.sh"
    printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=Jobber Automation MCP Setup' 'Comment=Install and configure Jobber Automation MCP' 'Terminal=false' "Exec=sh -c 'base=\"\$(dirname \"\$1\")\"; exec \"\$base/runtime/bin/node\" \"\$base/installer/launcher.cjs\" --config \"\$base/installer/launcher-config.json\" --ui \"\$base/installer/ui.html\" --payload \"\$base/payload\"' sh %k" > "$bundle/Start Setup.desktop"
    chmod +x "$bundle/Start Setup.desktop"
    tar -czf "$dist_dir/${app_slug}-${release_version}-linux-${arch}.tar.gz" -C "$work_dir" "$(basename "$bundle")"
  fi
}

package_windows() {
  local archive="node-${node_version}-win-x64.zip"
  local bundle="$work_dir/${app_slug}-${release_version}-windows-x64"
  curl -fsSL "https://nodejs.org/dist/${node_version}/${archive}" -o "$work_dir/$archive"
  unzip -q "$work_dir/$archive" -d "$work_dir/runtime-extract"
  make_common "$bundle"
  mv "$work_dir/runtime-extract/node-${node_version}-win-x64" "$bundle/runtime"
  rm -rf "$work_dir/runtime-extract"
  printf '%s\r\n' '@echo off' 'cd /d "%~dp0"' 'runtime\node.exe installer\launcher.cjs --config installer\launcher-config.json --ui installer\ui.html --payload payload' > "$bundle/Start Setup.cmd"
  printf '%s\r\n' 'Set fso = CreateObject("Scripting.FileSystemObject")' 'base = fso.GetParentFolderName(WScript.ScriptFullName)' 'q = Chr(34)' 'cmd = q & base & "\runtime\node.exe" & q & " " & q & base & "\installer\launcher.cjs" & q & " --config " & q & base & "\installer\launcher-config.json" & q & " --ui " & q & base & "\installer\ui.html" & q & " --payload " & q & base & "\payload" & q' 'CreateObject("WScript.Shell").Run cmd, 0, False' > "$bundle/Start Setup.vbs"
  (cd "$work_dir" && zip -qr "$dist_dir/${app_slug}-${release_version}-windows-x64.zip" "$(basename "$bundle")")
}

package_windows
package_unix darwin x64 tar.gz x64
package_unix darwin arm64 tar.gz arm64
package_unix linux x64 tar.xz x64
package_unix linux arm64 tar.xz arm64

(cd "$dist_dir" && sha256sum ./* > SHA256SUMS.txt)
