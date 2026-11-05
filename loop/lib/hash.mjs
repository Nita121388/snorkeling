// 冻结 hash。规则见 design §5.2/§5.3、RUNBOOK §3。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sha256Short(text, len = 12) {
    return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, len);
}

/**
 * prd_hash = sha256(`## Goal` … `## G1 签字` 之前)
 *
 * 为什么锚 `## Goal` 而不是文件开头：头部元信息（状态行、`Confirmed:` 行）本身
 * 会随签字动作变化。首版规则用"签字段之前全部内容"，签完补一行 `Confirmed:`
 * 就把自己的 hash 销毁了（2026-11-05 实测踩到）。
 */
export function prdHash(file) {
    const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const start = raw.indexOf('## Goal');
    if (start < 0) throw new Error(`prd.md missing "## Goal": ${file}`);
    const end = raw.indexOf('## G1 签字', start);
    const body = (end < 0 ? raw.slice(start) : raw.slice(start, end)).trimEnd();
    return sha256Short(body);
}

export function textHash(text) {
    return sha256Short(String(text).replace(/\r\n/g, '\n').trimEnd());
}

export function fileHash(file) {
    return textHash(readFileSync(file, 'utf8'));
}
