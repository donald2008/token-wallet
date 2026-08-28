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
    let mut builder = tauri::Builder::default()
        // 单实例锁: 二次启动聚焦已有实例, 不重复开窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .invoke_handler(tauri::generate_handler![get_bootstrap, update_tray_status])
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
    {
        builder = builder.plugin(tauri_plugin_playwright::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running token-wallet");
}
