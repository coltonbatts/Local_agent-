use std::time::Duration;

pub async fn poll_health(
    url: &str,
    interval_ms: u64,
    timeout_ms: u64,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let start = tokio::time::Instant::now();
    let timeout = Duration::from_millis(timeout_ms);
    let interval = Duration::from_millis(interval_ms);

    loop {
        if start.elapsed() > timeout {
            return Err(format!(
                "Backend health check timed out after {}ms",
                timeout_ms
            ));
        }

        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => {
                println!("[tauri] Backend health check passed");
                return Ok(());
            }
            Ok(resp) => {
                println!(
                    "[tauri] Health check returned status {}, retrying...",
                    resp.status()
                );
            }
            Err(_) => {
                // Connection refused is expected while backend is starting
            }
        }

        tokio::time::sleep(interval).await;
    }
}
