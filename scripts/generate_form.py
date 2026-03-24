final = ""

# base = "/mnt/c/Users/ethan/Documents/GitHub/Vectorframe/"
base = "./"

"""
    base + "README.md",
    base + "src-tauri/capabilities/default.json",
    base + "src-tauri/src/lib.rs",
    base + "src-tauri/src/main.rs",
    base + "src-tauri/Cargo.toml",
    base + "src-tauri/tauri.conf.json",
    base + "src-tauri/gen/android/app/src/main/java/com/cinemint/pompedin/Mp4EncoderPlugin.kt"
"""

file_list = [
    base + "src/style.css",
    base + "src/index.html",
    base + "src/js/01-state.js",
    base + "src/js/02-brush-textures.js",
    base + "src/js/03-paper-setup.js",
    base + "src/js/04-serialization.js",
    # base + "src/js/05-history.js",
    # base + "src/js/06-layers.js",
    # base + "src/js/07-render.js",
    # base + "src/js/08-tool-brush.js",
    # base + "src/js/09-tool-select.js",
    # base + "src/js/10-tool-eraser.js",
    # base + "src/js/11-tool-fill.js",
    # base + "src/js/12-tool-hide-edge.js",
    # base + "src/js/13-tool-transform.js",
    # base + "src/js/14-tool-camera.js",
    # base + "src/js/15-tool-activation.js",
    base + "src/js/16-timeline.js",
    # base + "src/js/17-layers-ui.js",
    # base + "src/js/18-export.js",
    # base + "src/js/19-import.js",
    # base + "src/js/20-project-io.js",
    base + "src/js/21-project.js",
    base + "src/js/22-ui-bindings.js",
    # base + "src/js/23-keyboard.js",
    base + "src/js/24-init.js",
    base + "src/js/25-audio.js",
    # base + "src/js/26-export-mp4.js",
    base + "src/js/27-resize-panels.js",
    # base + "src/js/28-layer-settings.js",
    base + "src/js/29-workspace.js",
    # base + "src/js/30-selection-sync.js",
    # base + "src/js/31-about.js",
    # base + "src/js/32-export-advanced.js",
    # base + "src/js/33-tools-advanced.js",
    # base + "src/js/34-camera.js",
    # base + "src/style-about.css",
    # base + "src/style-layer-settings.css",
]

"""

"""

for file in file_list:

    try:
        with open(file, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
            final += f"{file}:\n{content}\n\n"
    except Exception as e:
        print(f"Skipping {file} (likely not a text file or permission error).")

with open("source.txt", "w", encoding="utf-8") as f:
    f.write(final.strip())
