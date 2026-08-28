// 桌面入口: 发布构建禁用控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    token_wallet_lib::run();
}
