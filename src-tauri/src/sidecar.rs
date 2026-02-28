use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub struct SidecarManager {
    child: Arc<Mutex<Option<Child>>>,
    log_path: PathBuf,
    project_root: PathBuf,
    max_retries: u32,
}

impl SidecarManager {
    pub fn new(project_root: PathBuf) -> Self {
        let log_path = Self::resolve_log_path();
        Self {
            child: Arc::new(Mutex::new(None)),
            log_path,
            project_root,
            max_retries: 3,
        }
    }

    fn resolve_log_path() -> PathBuf {
        if cfg!(target_os = "macos") {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            let logs_dir = home.join("Library").join("Logs");
            if logs_dir.exists() {
                return logs_dir.join("local-agent-backend.log");
            }
        }
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("local-agent-backend.log")
    }

    #[allow(dead_code)]
    pub fn log_path(&self) -> &PathBuf {
        &self.log_path
    }

    pub fn spawn(&self) -> Result<(), String> {
        // Ensure log directory exists
        if let Some(parent) = self.log_path.parent() {
            fs::create_dir_all(parent).ok();
        }

        let mut child = Command::new("node")
            .arg("server.js")
            .current_dir(&self.project_root)
            .env("NODE_ENV", "production")
            .env("PORT", "3001")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn node process: {}", e))?;

        let pid = child.id();
        println!("[tauri] Backend sidecar started (pid: {})", pid);

        // Take stdout/stderr before storing child
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        *self.child.lock().unwrap() = Some(child);

        // Pipe stdout to log file in background thread
        if let Some(stdout) = stdout {
            let log_path = self.log_path.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                let mut file = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                    .ok();
                for line in reader.lines() {
                    if let Ok(line) = line {
                        println!("[backend] {}", line);
                        if let Some(ref mut f) = file {
                            let _ = writeln!(f, "{}", line);
                        }
                    }
                }
            });
        }

        if let Some(stderr) = stderr {
            let log_path = self.log_path.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                let mut file = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                    .ok();
                for line in reader.lines() {
                    if let Ok(line) = line {
                        eprintln!("[backend:err] {}", line);
                        if let Some(ref mut f) = file {
                            let _ = writeln!(f, "[stderr] {}", line);
                        }
                    }
                }
            });
        }

        Ok(())
    }

    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }

    pub fn shutdown(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            println!("[tauri] Shutting down backend sidecar...");

            let _ = child.kill();

            let start = Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        println!("[tauri] Backend sidecar stopped.");
                        return;
                    }
                    Ok(None) => {
                        if start.elapsed() > Duration::from_secs(5) {
                            println!("[tauri] Force killing backend sidecar.");
                            let _ = child.kill();
                            let _ = child.wait();
                            return;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                    Err(_) => return,
                }
            }
        }
    }

    pub fn spawn_with_retry(&self) -> Result<(), String> {
        let mut attempts = 0u32;

        loop {
            match self.spawn() {
                Ok(()) => return Ok(()),
                Err(e) => {
                    attempts += 1;
                    if attempts >= self.max_retries {
                        return Err(format!(
                            "Backend failed to start after {} attempts: {}",
                            self.max_retries, e
                        ));
                    }
                    let delay = Duration::from_secs(1 << (attempts - 1)); // 1s, 2s, 4s
                    println!(
                        "[tauri] Backend start failed (attempt {}), retrying in {:?}...",
                        attempts, delay
                    );
                    thread::sleep(delay);
                }
            }
        }
    }

    pub fn read_last_log_lines(&self, n: usize) -> Vec<String> {
        fs::read_to_string(&self.log_path)
            .unwrap_or_default()
            .lines()
            .rev()
            .take(n)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|s| s.to_string())
            .collect()
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}
