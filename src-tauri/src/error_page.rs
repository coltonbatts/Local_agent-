pub fn generate_error_html(message: &str, log_lines: &[String]) -> String {
    let escaped_message = html_escape(message);
    let escaped_logs = log_lines
        .iter()
        .map(|l| html_escape(l))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    background: #1a1a1a;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem;
  }}
  .container {{
    max-width: 640px;
    width: 100%;
  }}
  h1 {{
    color: #ff6b6b;
    font-size: 1.4rem;
    margin-bottom: 1rem;
  }}
  .message {{
    color: #aaa;
    margin-bottom: 1.5rem;
    line-height: 1.5;
  }}
  .log-box {{
    background: #111;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 1rem;
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.75rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
    margin-bottom: 1.5rem;
    color: #999;
  }}
  button {{
    background: #333;
    color: #e0e0e0;
    border: 1px solid #555;
    border-radius: 6px;
    padding: 0.6rem 1.5rem;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.15s;
  }}
  button:hover {{
    background: #444;
  }}
</style>
</head>
<body>
  <div class="container">
    <h1>Backend failed to start</h1>
    <p class="message">{}</p>
    <div class="log-box">{}</div>
    <button onclick="window.__TAURI__?.invoke('restart_backend')">
      Retry
    </button>
  </div>
</body>
</html>"#,
        escaped_message,
        if escaped_logs.is_empty() {
            "No log output available.".to_string()
        } else {
            escaped_logs
        }
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
