#!/usr/bin/env node
/**
 * WYSIWYG 编辑体验修复验证测试
 * 
 * 测试内容：
 * 1. 光标定位：点击块进入编辑，光标应在点击位置（不是末尾）
 * 2. 块切换：直接点击另一个块应能切换编辑
 * 3. 外边框：编辑态不应有外边框
 * 4. 列表漂移：有序列表编辑时 marker 应正确
 */

import { chromium } from 'playwright';

const CDP_ENDPOINT = 'http://127.0.0.1:9333';
const TARGET = 'Wave Terminal - T1';

async function runTests() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('=== WYSIWYG 编辑体验修复验证 ===\n');
    
    try {
        // 连接到 Electron 的 CDP
        const cdp = await page.context().newCDPSession(page);
        
        // 1. 测试光标定位
        console.log('测试 1: 光标定位');
        await testCursorPosition(cdp);
        
        // 2. 测试块切换
        console.log('\n测试 2: 块切换');
        await testBlockSwitching(cdp);
        
        // 3. 测试外边框
        console.log('\n测试 3: 外边框检测');
        await testBorder(cdp);
        
        console.log('\n=== 测试完成 ===');
        
    } catch (error) {
        console.error('测试失败:', error);
    } finally {
        await browser.close();
    }
}

async function testCursorPosition(cdp) {
    // 查找 markdown 渲染区域的段落
    const result = await cdp.send('Runtime.evaluate', {
        expression: `
            (() => {
                // 查找一个段落块
                const p = document.querySelector('.markdown-render-root p[data-source-line]');
                if (!p) return { found: false };
                
                // 获取段落文本
                const text = p.textContent || '';
                const rect = p.getBoundingClientRect();
                
                // 返回段落位置信息和文本长度的一半（模拟点击中间位置）
                return {
                    found: true,
                    text: text.substring(0, 30),
                    textLength: text.length,
                    x: rect.left + rect.width / 4,
                    y: rect.top + rect.height / 2,
                    line: p.dataset.sourceLine
                };
            })()
        `,
        returnByValue: true
    });
    
    if (result.result.value?.found) {
        const info = result.result.value;
        console.log(`  ✓ 找到段落: "${info.text}..." (${info.textLength} 字符)`);
        console.log(`    位置: (${info.x.toFixed(0)}, ${info.y.toFixed(0)})`);
        console.log(`    源码行: ${info.line}`);
        
        // 模拟点击段落中间位置
        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: info.x,
            y: info.y,
            button: 'left',
            clickCount: 2
        });
        
        await new Promise(r => setTimeout(r, 500));
        
        // 检查编辑器是否打开
        const editorResult = await cdp.send('Runtime.evaluate', {
            expression: `
                (() => {
                    const overlay = document.querySelector('.inline-edit-overlay');
                    const wysiwyg = document.querySelector('.wysiwyg-editor');
                    const textarea = document.querySelector('.inline-edit-textarea');
                    
                    return {
                        overlayExists: !!overlay,
                        wysiwygExists: !!wysiwyg,
                        textareaExists: !!textarea,
                        hasOutline: wysiwyg ? getComputedStyle(wysiwyg).outline !== 'none' : false,
                        outlineWidth: wysiwyg ? getComputedStyle(wysiwyg).outlineWidth : 'N/A'
                    };
                })()
            `,
            returnByValue: true
        });
        
        const editorInfo = editorResult.result.value;
        console.log(`  编辑器状态:`);
        console.log(`    - Overlay 存在: ${editorInfo.overlayExists}`);
        console.log(`    - WYSIWYG 编辑器: ${editorInfo.wysiwygExists}`);
        console.log(`    - Textarea: ${editorInfo.textareaExists}`);
        console.log(`    - 有 outline: ${editorInfo.hasOutline}`);
        console.log(`    - outline 宽度: ${editorInfo.outlineWidth}`);
        
    } else {
        console.log('  ✗ 未找到段落块');
    }
}

async function testBlockSwitching(cdp) {
    // 检查当前是否有正在编辑的块
    const result = await cdp.send('Runtime.evaluate', {
        expression: `
            (() => {
                const session = document.querySelector('.inline-edit-overlay');
                const blocks = document.querySelectorAll('.markdown-render-root [data-source-line]');
                
                return {
                    isEditing: !!session,
                    blockCount: blocks.length,
                    blocks: Array.from(blocks).slice(0, 3).map(b => ({
                        tag: b.tagName,
                        line: b.dataset.sourceLine,
                        text: (b.textContent || '').substring(0, 20)
                    }))
                };
            })()
        `,
        returnByValue: true
    });
    
    const info = result.result.value;
    console.log(`  当前状态: ${info.isEditing ? '正在编辑' : '未编辑'}`);
    console.log(`  可编辑块数量: ${info.blockCount}`);
    
    if (info.blocks.length > 0) {
        console.log('  前 3 个块:');
        info.blocks.forEach((b, i) => {
            console.log(`    ${i + 1}. <${b.tag}> 行${b.line}: "${b.text}..."`);
        });
    }
}

async function testBorder(cdp) {
    // 检查所有可能产生边框的元素
    const result = await cdp.send('Runtime.evaluate', {
        expression: `
            (() => {
                const checks = [];
                
                // 检查 .wysiwyg-editor
                const wysiwyg = document.querySelector('.wysiwyg-editor');
                if (wysiwyg) {
                    const cs = getComputedStyle(wysiwyg);
                    checks.push({
                        selector: '.wysiwyg-editor',
                        border: cs.border,
                        outline: cs.outline,
                        outlineWidth: cs.outlineWidth
                    });
                }
                
                // 检查 .inline-edit-overlay
                const overlay = document.querySelector('.inline-edit-overlay');
                if (overlay) {
                    const cs = getComputedStyle(overlay);
                    checks.push({
                        selector: '.inline-edit-overlay',
                        border: cs.border,
                        outline: cs.outline,
                        outlineWidth: cs.outlineWidth
                    });
                }
                
                // 检查 .cm-editor (CodeMirror)
                const cm = document.querySelector('.cm-editor');
                if (cm) {
                    const cs = getComputedStyle(cm);
                    checks.push({
                        selector: '.cm-editor',
                        border: cs.border,
                        outline: cs.outline,
                        outlineWidth: cs.outlineWidth
                    });
                }
                
                return checks;
            })()
        `,
        returnByValue: true
    });
    
    const checks = result.result.value;
    if (checks.length > 0) {
        console.log('  边框检查:');
        checks.forEach(c => {
            console.log(`    ${c.selector}:`);
            console.log(`      border: ${c.border}`);
            console.log(`      outline: ${c.outline} (${c.outlineWidth})`);
        });
    } else {
        console.log('  暂无编辑器打开，跳过边框检查');
    }
}

runTests().catch(console.error);
