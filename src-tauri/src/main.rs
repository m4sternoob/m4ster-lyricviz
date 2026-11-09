// LyricViz desktop entry point.
// The whole app is the web UI in ../web; this shell only opens
// it in a native window so it can ship as a macOS / Windows app.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lyricviz_lib::run()
}
