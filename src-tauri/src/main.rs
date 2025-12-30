// DEBUG: 콘솔 창 표시 (디버깅용 - 나중에 다시 활성화)
// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Child, Stdio};
use std::fs::File;
use std::sync::Mutex;
use std::path::PathBuf;
use tauri::Manager;

struct BackendProcess(Mutex<Option<Child>>);

fn get_app_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap())
}

fn start_backend() -> Option<Child> {
    let app_dir = get_app_dir();

    // python_env 경로
    let python_path = app_dir.join("python_env").join("python").join("python.exe");
    let backend_path = app_dir.join("backend.py");
    let log_path = app_dir.join("backend.log");

    println!("App dir: {:?}", app_dir);
    println!("Python: {:?}", python_path);
    println!("Backend: {:?}", backend_path);
    println!("Log: {:?}", log_path);

    // 로그 파일 생성
    let log_file = File::create(&log_path).ok();
    let stderr_file = File::create(app_dir.join("backend_err.log")).ok();

    if !python_path.exists() {
        eprintln!("Python not found at {:?}", python_path);
        // 개발 모드에서는 시스템 Python 사용
        let child = Command::new("python")
            .arg(&backend_path)
            .current_dir(&app_dir)
            .stdout(log_file.map(Stdio::from).unwrap_or(Stdio::null()))
            .stderr(stderr_file.map(Stdio::from).unwrap_or(Stdio::null()))
            .spawn()
            .ok();
        return child;
    }

    let child = Command::new(&python_path)
        .arg(&backend_path)
        .current_dir(&app_dir)
        .stdout(log_file.map(Stdio::from).unwrap_or(Stdio::null()))
        .stderr(stderr_file.map(Stdio::from).unwrap_or(Stdio::null()))
        .spawn()
        .ok();

    if child.is_some() {
        println!("Backend started successfully");
    } else {
        eprintln!("Failed to start backend");
    }

    child
}

fn main() {
    tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            // Start Python backend
            let child = start_backend();
            *app.state::<BackendProcess>().0.lock().unwrap() = child;
            
            // Wait for backend to start
            std::thread::sleep(std::time::Duration::from_millis(1500));
            
            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event.event() {
                // Kill backend on close
                let app = event.window().app_handle();
                if let Some(mut child) = app.state::<BackendProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running PeroPix");
}
