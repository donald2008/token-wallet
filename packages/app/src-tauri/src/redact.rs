//! 日志统一出口脱敏 — DESIGN.md §7.2 (D-029)
//!
//! Rust 侧任何可能接触凭据的文本(sk- 前缀 key / Bearer token)在进入
//! 日志/错误消息前统一打码。与 core src/redact.ts 同语义, 双端一致。
//! 零额外依赖: 手写扫描, 不引 regex crate。

/// 把字符串中的密钥形态统一打码: sk-xxx → sk-***, Bearer xxx → Bearer ***
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut i = 0;
    let n = bytes.len();
    while i < n {
        // sk- 前缀 → 吃掉直到非 [A-Za-z0-9_-] 的整段, 只留 "sk-***"
        if n - i >= 3 && &bytes[i..i + 3] == b"sk-" && i + 3 < n && is_key_char(bytes[i + 3]) {
            out.push_str("sk-***");
            i += 3;
            while i < n && is_key_char(bytes[i]) {
                i += 1;
            }
            continue;
        }
        // Bearer <token> → 吃 token 段
        if n - i >= 7 && text[i..i + 7].eq_ignore_ascii_case("Bearer ") {
            out.push_str("Bearer ***");
            i += 7;
            while i < n && !bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            continue;
        }
        // 其余字符原样拷贝(按 UTF-8 边界推进)
        let ch_len = utf8_len(bytes[i]);
        out.push_str(&text[i..i + ch_len]);
        i += ch_len;
    }
    out
}

fn is_key_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn utf8_len(b: u8) -> usize {
    if b < 0x80 {
        1
    } else if b >> 5 == 0b110 {
        2
    } else if b >> 4 == 0b1110 {
        3
    } else {
        4
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_sk_keys_and_bearer() {
        assert_eq!(redact("key=sk-abc1234567890"), "key=sk-***");
        assert!(redact("Authorization: Bearer sk-live-abcdef").contains("Bearer ***"));
        assert_eq!(redact("余额 448.45 CNY"), "余额 448.45 CNY");
        // 中文多字节安全
        assert_eq!(redact("深 key=sk-x"), "深 key=sk-***");
    }
}
