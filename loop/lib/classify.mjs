// 分类器：8 类，机械可判，first-match，拿不准就升级（default up）。
// 设计：design.md §6；规则表：RUNBOOK §2。

export const TYPES = ['bug', 'new-surface', 'redesign', 'arch', 'docs', 'chore', 'feature', 'fix-small'];

/** 门的"重量"排序；default up 沿这个方向升。 */
export const TYPE_RANK = {
    docs: 0,
    chore: 0,
    'fix-small': 1,
    bug: 1,
    feature: 2,
    arch: 3,
    redesign: 4,
    'new-surface': 5,
};

export const UPGRADE = {
    docs: 'arch',
    chore: 'arch',
    'fix-small': 'feature',
    bug: 'feature',
    feature: 'new-surface',
    arch: 'new-surface',
    redesign: 'new-surface',
    'new-surface': 'new-surface',
};

const RULES = [
    ['bug', (s) => s.hasRepro === true],
    ['new-surface', (s) => any(s.addedFiles, /(^|\/)(pages|views|view)\//)],
    ['redesign', (s) => any(s.changedFiles, /(tokens\.css$|\.scss$|(^|\/)components\/ui\/)/)],
    ['arch', (s) => any(s.changedFiles, /(^|\/)(shared|pkg)\//) || any(s.changedFiles, /(^|\/)(package\.json|deps-policy\.json)$/)],
    ['docs', (s) => all(s.changedFiles, /(\.md$|(^|\/)docs\/)/)],
    ['chore', (s) => all(s.changedFiles, /(package-lock\.json$|\.npmrc$|(^|\/)version\.cjs$)/)],
    ['feature', (s) => s.hints?.behaviorChange === true],
    ['fix-small', () => true],
];

function any(list, re) {
    return (list ?? []).some((f) => re.test(String(f)));
}

function all(list, re) {
    const l = list ?? [];
    return l.length > 0 && l.every((f) => re.test(String(f)));
}

/**
 * @param {object} signals { changedFiles?, addedFiles?, hasRepro?, hints?:{type?,behaviorChange?,uncertain?} }
 * @returns {{type:string, rule:string, escalated:boolean, signals:object}}
 */
export function classify(signals = {}) {
    const s = {
        changedFiles: signals.changedFiles ?? [],
        addedFiles: signals.addedFiles ?? [],
        hasRepro: signals.hasRepro === true,
        hints: signals.hints ?? {},
    };

    // 人工显式指定优先级最高，但仍然受"升级"约束（不可指定到更弱的类）。
    let type = null;
    let rule = null;
    for (const [name, test] of RULES) {
        if (test(s)) {
            type = name;
            rule = name;
            break;
        }
    }

    let escalated = false;
    if (s.hints.type && TYPE_RANK[s.hints.type] !== undefined) {
        if (TYPE_RANK[s.hints.type] > TYPE_RANK[type]) {
            type = s.hints.type;
            rule = 'hint';
            escalated = true;
        }
    }

    if (s.hints.uncertain === true) {
        const up = UPGRADE[type] ?? type;
        if (up !== type) {
            type = up;
            rule = `${rule}+uncertain-up`;
            escalated = true;
        }
    }

    return { type, rule, escalated, signals: s };
}
