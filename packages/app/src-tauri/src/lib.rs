//! token-wallet app 壳(D-001/D-003):
//! 系统托盘(4 色状态点 + tooltip 摘要) + 点击弹出面板 + 单实例锁 + 最小化到托盘。
//! 真实数据链路等 P0-5, 本壳只提供 IPC 骨架。

use serde::Serialize;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

mod redact;

const TRAY_ID: &str = "main-tray";
const MAIN_WINDOW: &str = "main";

/// 托盘四色状态点(绿/黄/红/灰, D-003), 嵌入编译产物, 零运行时文件依赖
const ICON_OK: &[u8] = include_bytes!("../icons/status-ok.png");
const ICON_WARN: &[u8] = include_bytes!("../icons/status-warn.png");
const ICON_BAD: &[u8] = include_bytes!("../icons/status-bad.png");
const ICON_UNKNOWN: &[u8] = include_bytes!("../icons/status-unknown.png");

fn status_icon(status: &str) -> Image<'static> {
    let bytes = match status {
        "ok" => ICON_OK,
        "warn" => ICON_WARN,
        "bad" => ICON_BAD,
        _ => ICON_UNKNOWN,
    };
    Image::from_bytes(bytes).expect("embedded status icons must decode")
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    /// 首开判定占位(§10): 初始零 provider 配置, 持久化接入前恒为 true
    first_run: bool,
    /// 主题默认追随系统(D-010), 可配置覆盖接入 settings 后返回用户值
    theme: String,
    version: String,
}

/// 运行时解析的存储路径(D-019): 配置(Roaming)与数据(Local)分家, 零硬编码字面量
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoragePaths {
    config_dir: String,
    data_dir: String,
}

#[tauri::command]
fn get_storage_paths(app: AppHandle) -> Result<StoragePaths, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(StoragePaths {
        config_dir: config_dir.to_string_lossy().into_owned(),
        data_dir: data_dir.to_string_lossy().into_owned(),
    })
}

/// 开机自启(D-024): 默认关。接入 autostart plugin 前返回 false 占位
#[tauri::command]
fn get_launch_at_login() -> bool {
    false
}

/// 开机自启设置(D-024): plugin 接入前为 no-op 占位
#[tauri::command]
fn set_launch_at_login(_enabled: bool) {} 

// ---------------- P0-5 真实数据链路(D-029/D-020) ----------------

/// OS 钥匙串读取 — keyring crate(Windows 凭据管理器 / Keychain / Secret Service)
#[tauri::command]
fn keyring_get(service: String, key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(&service, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// OS 钥匙串写入(D-029: 设置页保存凭据)
#[tauri::command]
fn keyring_set(service: String, key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// OS 钥匙串删除(删实例同步清条目 D-029)
#[tauri::command]
fn keyring_delete(service: String, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 真实 http GET — Rust 侧执行, 规避 webview CORS/CSP 限制。
/// 返回 { status, body }: body 已统一脱敏(D-029), 供前端 GenericHttpAdapter 判定状态码。
/// ⚠️ 不落日志 headers(Authorization 等敏感头不打印)。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpJsonResponse {
    status: u16,
    body: String,
}

#[tauri::command]
async fn http_get_json(
    url: String,
    headers: std::collections::HashMap<String, String>,
    timeout_ms: u64,
) -> Result<HttpJsonResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    // 统一出口脱敏(D-029): 即使上游错误体回显 key 也打码
    Ok(HttpJsonResponse {
        status,
        body: crate::redact::redact(&text),
    })
}

// ---- SQLite(Rust 侧执行, SCHEMA_SQL 单一来源来自 core 前端) ----

use std::sync::Mutex;

struct DbState(Mutex<Option<rusqlite::Connection>>);

/// 打开/复用 app_data_dir 下的 token-wallet.db(数据与配置分家 D-019)
fn db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("token-wallet.db"))
}

fn with_conn<T>(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, DbState>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    if guard.is_none() {
        let path = db_path(app)?;
        *guard = Some(
            rusqlite::Connection::open(&path)
                .map_err(|e| format!("open sqlite: {e}"))?,
        );
    }
    f(guard.as_ref().expect("db initialized"))
}

/// JSON 值 → rusqlite 值(参数绑定)
fn json_to_sqlite_values(params: Vec<serde_json::Value>) -> Vec<rusqlite::types::Value> {
    params
        .into_iter()
        .map(|v| match v {
            serde_json::Value::Null => rusqlite::types::Value::Null,
            serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(b as i64),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    rusqlite::types::Value::Integer(i)
                } else {
                    rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0))
                }
            }
            serde_json::Value::String(s) => rusqlite::types::Value::Text(s),
            other => rusqlite::types::Value::Text(other.to_string()),
        })
        .collect()
}

fn sqlite_row_to_json(v: rusqlite::types::Value) -> serde_json::Value {
    match v {
        rusqlite::types::Value::Null => serde_json::Value::Null,
        rusqlite::types::Value::Integer(i) => serde_json::Value::from(i),
        rusqlite::types::Value::Real(r) => serde_json::Value::from(r),
        rusqlite::types::Value::Text(t) => serde_json::Value::String(t),
        rusqlite::types::Value::Blob(b) => {
            serde_json::Value::String(String::from_utf8_lossy(&b).into_owned())
        }
    }
}

/// 批量执行 SQL(建表); SQL 文本由前端从 core SCHEMA_SQL 传入(单一来源)
#[tauri::command]
fn sqlite_batch(app: tauri::AppHandle, state: tauri::State<'_, DbState>, sql: String) -> Result<(), String> {
    with_conn(&app, &state, |conn| conn.execute_batch(&sql).map_err(|e| e.to_string()))
}

/// 单条 SQL + 参数执行(INSERT/UPDATE/DELETE); 返回影响行数
#[tauri::command]
fn sqlite_exec(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<usize, String> {
    with_conn(&app, &state, |conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params: Vec<rusqlite::types::Value> = json_to_sqlite_values(params);
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        stmt.execute(param_refs.as_slice()).map_err(|e| e.to_string())
    })
}

/// 查询 SQL; 返回行数组(每行数组, 与列序一致)。参数 JSON 数组。
#[tauri::command]
fn sqlite_query(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<Vec<serde_json::Value>>, String> {
    with_conn(&app, &state, |conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let col_count = stmt.column_count();
        let params = json_to_sqlite_values(params);
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mut out: Vec<serde_json::Value> = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    let v = row.get::<_, rusqlite::types::Value>(i).unwrap_or(rusqlite::types::Value::Null);
                    out.push(sqlite_row_to_json(v));
                }
                Ok(out)
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

#[tauri::command]
fn get_bootstrap() -> Bootstrap {
    Bootstrap {
        first_run: true,
        theme: "system".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

/// 前端把"全局最差状态 + tooltip 摘要"推到托盘(D-003/§6.2)
#[tauri::command]
fn update_tray_status(app: AppHandle, status: String, tooltip: String) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray icon not found".to_string())?;
    tray.set_icon(Some(status_icon(&status)))
        .map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 点击托盘弹出面板(§6.2): 可见则隐藏, 隐藏则弹出
fn toggle_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        match w.is_visible() {
            Ok(true) => {
                let _ = w.hide();
            }
            _ => show_main_window(app),
        }
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        // 单实例锁: 二次启动聚焦已有实例, 不重复开窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .manage(DbState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_bootstrap,
            update_tray_status,
            get_storage_paths,
            get_launch_at_login,
            set_launch_at_login,
            keyring_get,
            keyring_set,
            keyring_delete,
            http_get_json,
            sqlite_batch,
            sqlite_exec,
            sqlite_query
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "打开面板", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(status_icon("unknown"))
                .tooltip("token-wallet — 初始化中")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => show_main_window(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // 可最小化到托盘(D-003): 关闭按钮 = 隐藏到托盘, 真实退出走托盘菜单"退出"
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            Ok(())
        });

    // D-030 L2 技术前提: e2e-testing feature 仅测试构建开启, 生产构建不受影响
    #[cfg(feature = "e2e-testing")]
    let builder = builder.plugin(tauri_plugin_playwright::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running token-wallet");
}
