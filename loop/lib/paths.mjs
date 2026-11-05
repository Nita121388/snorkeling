// 路径安全：所有相对路径必须先过 safeResolve，再（存在时）过 realpath 复核。
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url)); // loop/lib

export const LOOP_DIR = resolve(HERE, '..'); // loop
export const REPO_ROOT = resolve(LOOP_DIR, '..'); // repo root

function withSep(p) {
    return p.endsWith(sep) ? p : p + sep;
}

/** 把相对路径解析到 root 下；越界（含 ..、绝对路径逃逸）直接抛错。 */
export function safeResolve(root, rel) {
    const rootAbs = resolve(root);
    const abs = resolve(rootAbs, rel);
    if (abs !== rootAbs && !abs.startsWith(withSep(rootAbs))) {
        throw new Error(`path escapes root: ${rel}`);
    }
    if (existsSync(abs)) {
        const realRoot = realpathSync(rootAbs);
        const real = realpathSync(abs);
        if (real !== realRoot && !real.startsWith(withSep(realRoot))) {
            throw new Error(`symlink escapes root: ${rel}`);
        }
    }
    return abs;
}

/**
 * `loop/` 唯一被允许写 `.trellis/` 的两处白名单。
 * 任何其他 .trellis 写入都必须被拒绝（PRD N5 / design §10）。
 */
const TRELLIS_WRITE_ALLOW = [/^\.trellis[\\/]tasks[\\/][^\\/]+[\\/]prd\.md$/, /^\.trellis[\\/]config\.yaml$/];

export function assertTrellisWritable(relPath) {
    const norm = relPath.split(sep).join('/').replace(/^\.\//, '');
    if (!TRELLIS_WRITE_ALLOW.some((re) => re.test(norm))) {
        throw new Error(`refusing to write .trellis (not whitelisted): ${norm}`);
    }
    return true;
}

/** 相对 repo root 的展示用路径（统一正斜杠）。 */
export function relPath(abs) {
    return resolve(abs).slice(REPO_ROOT.length + 1).split(sep).join('/');
}
