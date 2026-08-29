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
    /// 首开判定(§10): 由 configDir/settings.json 的 consent 状态决定(P0-7 接真)
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

// ---------------- P0-7: 实例配置持久化(DESIGN §5.0.1, D-019/D-032) ----------------

/// instances.yaml 路径: configDir/instances.yaml(配置 Roaming 与数据 Local 分家 D-019)
fn instances_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("instances.yaml"))
}

/// 读 instances.yaml → JSON 值(YAML 解析在 Rust, zod 校验权威仍在前端 schema.ts)。
/// 文件不存在/空 → Ok(None)(首开零配置); YAML 语法损坏 → Err(fail-fast, 不静默丢配置)。
#[tauri::command]
fn instances_load(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = instances_file_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 instances.yaml 失败: {e}"))?;
    if text.trim().is_empty() {
        return Ok(None);
    }
    let yaml: serde_yaml::Value =
        serde_yaml::from_str(&text).map_err(|e| format!("instances.yaml 解析失败: {e}"))?;
    serde_json::to_value(yaml)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// 原子写(tmp + sync_all + rename 覆盖替换), instances.yaml / settings.json 共用。
///
/// rename 覆盖语义有 Rust 官方文档背书:
/// <https://doc.rust-lang.org/std/fs/fn.rename.html> — "replacing the original file
/// if `to` already exists"(Windows 对应 MoveFileExW, Win10 1607+ 行为与 Unix 一致)。
/// ⚠️ 禁止改回"先 remove_file 再 rename": remove 成功、rename 前崩溃/断电 →
/// 配置文件彻底消失 → 载入走"文件不存在"分支被当首开零配置**静默吞掉**,
/// 比它想防的半写损坏(YAML 解析失败 fail-fast)后果严重得多。
fn atomic_write(path: &std::path::Path, contents: &[u8]) -> Result<(), String> {
    use std::io::Write as _;
    let mut tmp_os = path.as_os_str().to_os_string();
    tmp_os.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp_os);
    let write_err = |e: std::io::Error| format!("写入 {} 失败: {e}", path.display());
    let mut f = std::fs::File::create(&tmp).map_err(write_err)?;
    f.write_all(contents).map_err(write_err)?;
    // 写完先 flush 到盘再 rename, 保证断电时 tmp 内容完整(真原子替换)
    f.sync_all().map_err(write_err)?;
    drop(f);
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// 写 instances.yaml(入参已由前端 zod 校验): 原子写(tmp+sync+rename 覆盖), 防半写损坏。
/// 落盘的只有 CredentialRef 引用, secret 值只进 OS 钥匙串(D-029 不变)。
#[tauri::command]
fn instances_save(app: AppHandle, file: serde_json::Value) -> Result<(), String> {
    let path = instances_file_path(&app)?;
    let yaml = serde_yaml::to_string(&file).map_err(|e| e.to_string())?;
    atomic_write(&path, yaml.as_bytes())
}

// ---- 首开判定(§10/D-021): consent 落 configDir/settings.json(配置侧 D-019) ----

/// 全局设置文件(§5.0.1 三层之 settings 层; P0-7 先落 consent, 主题/轮询等后续并入)
#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SettingsFile {
    version: u32,
    consent_agreed: bool,
    /// 同意时间(unix 秒)
    consent_at: Option<u64>,
    /// 前瞻字段直通透传(OCP): 主题/轮询等并入后, 旧版本 read-modify-write 也不丢它们
    #[serde(flatten)]
    extra: std::collections::BTreeMap<String, serde_json::Value>,
}

fn settings_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn read_settings(app: &AppHandle) -> SettingsFile {
    let Ok(path) = settings_file_path(app) else {
        return SettingsFile::default();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return SettingsFile::default();
    };
    // settings 损坏时保守回退首开态(重弹 consent), 不带崩应用
    serde_json::from_str(&text).unwrap_or_default()
}

/// consent 落盘的 read-modify-write 核心(纯函数, 可单测):
/// 只改 consent 两字段, 既有/前瞻字段(theme/轮询等)原样保留(OCP),
/// 杜绝"同意一次把其他设置清回默认"。损坏时保守回退首开态(重弹 consent, 不崩应用)。
fn consent_settings_json(existing: Option<&str>, now: u64) -> Result<String, String> {
    let mut settings: SettingsFile = existing
        .and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_default();
    settings.version = 1;
    settings.consent_agreed = true;
    settings.consent_at = Some(now);
    serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())
}

/// 用户同意隐私声明 → 落盘(§10): 之后 get_bootstrap 返回 first_run=false。
/// read-modify-write(OCP): 保留 settings.json 其余字段, 走 tmp+sync+rename 原子写。
#[tauri::command]
fn record_consent(app: AppHandle) -> Result<(), String> {
    let path = settings_file_path(&app)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let existing = std::fs::read_to_string(&path).ok(); // 不存在/读失败 → 首开态
    let text = consent_settings_json(existing.as_deref(), now)?;
    atomic_write(&path, text.as_bytes())
}

#[tauri::command]
fn get_bootstrap(app: AppHandle) -> Bootstrap {
    let settings = read_settings(&app);
    Bootstrap {
        // 首开判定接真(§10): consent 已同意 → 不再弹隐私声明页
        first_run: !settings.consent_agreed,
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
            sqlite_query,
            instances_load,
            instances_save,
            record_consent
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

#[cfg(test)]
mod tests {
    use super::*;

    /// W2: record_consent 是 read-modify-write —— settings.json 里既有/前瞻字段
    /// (theme/轮询等后续并入)在同意操作后必须原样保留, 不被清回默认。
    #[test]
    fn consent_read_modify_write_preserves_other_fields() {
        let existing = r#"{"version":1,"consentAgreed":false,"theme":"dark","pollInterval":"5m"}"#;
        let out = consent_settings_json(Some(existing), 1_700_000_000).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["consentAgreed"], true);
        assert_eq!(v["consentAt"], 1_700_000_000u64);
        // 前瞻字段不丢(serde flatten 直通透传)
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["pollInterval"], "5m");
        // 往返再写一次仍不丢(幂等)
        let out2 = consent_settings_json(Some(&out), 1_700_000_100).unwrap();
        let v2: serde_json::Value = serde_json::from_str(&out2).unwrap();
        assert_eq!(v2["theme"], "dark");
        assert_eq!(v2["consentAt"], 1_700_000_100u64);
    }

    /// settings 损坏 → 保守回退首开态重写, 不崩应用
    #[test]
    fn consent_corrupt_settings_falls_back_to_fresh() {
        let out = consent_settings_json(Some("{ not json"), 42).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["consentAgreed"], true);
        assert_eq!(v["consentAt"], 42u64);
    }

    /// W1: atomic_write 真原子替换 —— 直接 rename 覆盖既有文件(无 remove_file),
    /// 覆盖后内容完整, tmp 不残留。
    #[test]
    fn atomic_write_overwrites_existing_and_cleans_tmp() {
        let dir = std::env::temp_dir().join(format!("tw-atomic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("instances.yaml");
        atomic_write(&path, b"v1").unwrap();
        atomic_write(&path, b"v2-longer-content").unwrap(); // 覆盖既有文件
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "v2-longer-content");
        assert!(!dir.join("instances.yaml.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
