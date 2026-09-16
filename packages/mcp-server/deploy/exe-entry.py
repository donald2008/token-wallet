"""PyInstaller onefile 入口 — 间接 import 保住 mcp_server 包上下文。

直接对 src/mcp_server/__main__.py 打包会丢包身份（相对 import 失败），
必须经包路径导入后调 main()。构建脚本: build-exe.ps1（同目录）。
"""
from mcp_server.__main__ import main

if __name__ == "__main__":
    main()
