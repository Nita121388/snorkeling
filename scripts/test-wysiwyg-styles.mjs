#!/usr/bin/env node
/**
 * WYSIWYG 样式 parity 测试
 * 
 * 检查编辑器样式与预览样式的对比
 */

import { JSDOM } from 'jsdom';

const { window } = new JSDOM(`<!DOCTYPE html>
<html>
<head>
<style>
.content p {
    font-family: -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: #333;
}
.wysiwyg-editor {
    font-family: -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: #333;
}
.wysiwyg-editor.wysiwyg-heading.is-1 {
    font-size: 2em;
    font-weight: bold;
    border-bottom: 1px solid var(--border-color);
}
.inline-edit-overlay {
    border: 1px solid transparent;
    outline: none;
}
.inline-edit-overlay:has(.wysiwyg-editor) {
    border-color: transparent;
}
</style>
</head>
<body>
<div class="content">
    <p data-source-line="1">这是一个普通段落</p>
    <h1 data-source-line="2">二级标题</h1>
    <ol data-source-line="4">
        <li>列表项一</li>
        <li>列表项二</li>
    </ol>
</div>
<div class="inline-edit-overlay">
    <div class="wysiwyg-editor wysiwyg-paragraph" contenteditable="true">这是一个普通段落</div>
</div>
</body>
</html>`);

const { document } = window;

// 测试 1: 检查 WYSIWYG 编辑器样式
console.log('=== WYSIWYG 样式检查 ===\n');

// 1. 检查 outline
const wysiwyg = document.querySelector('.wysiwyg-editor');
const overlay = document.querySelector('.inline-edit-overlay');

if (wysiwyg) {
    const cs = window.getComputedStyle(wysiwyg);
    console.log('1. WYSIWYG 编辑器样式:');
    console.log(`   outline: ${cs.outline}`);
    console.log(`   border: ${cs.border}`);
    console.log(`   font-size: ${cs.fontSize}`);
    console.log(`   font-family: ${cs.fontFamily}`);
    console.log(`   line-height: ${cs.lineHeight}`);
    console.log(`   outline-offset: ${cs.outlineOffset}`);
    console.log(`   outline-width: ${cs.outlineWidth}`);
    console.log(`   outline-style: ${cs.outlineStyle}`);
    console.log(`   outline-color: ${cs.outlineColor}`);
    
    // 检查 outline 是否为 none
    if (cs.outline === 'none' || cs.outlineWidth === '0px' || cs.outlineStyle === 'none') {
        console.log('   ✓ 无外边框');
    } else {
        console.log('   ✗ 有外边框!');
        console.log(`      完整 outline: ${cs.outline}`);
    }
} else {
    console.log('1. 未找到 WYSIWYG 编辑器');
}

// 2. 检查 overlay
if (overlay) {
    const cs = window.getComputedStyle(overlay);
    console.log('\n2. Overlay 容器样式:');
    console.log(`   border: ${cs.border}`);
    console.log(`   outline: ${cs.outline}`);
    console.log(`   z-index: ${cs.zIndex}`);
}

console.log('\n=== 问题分析 ===');
console.log('WYSIWYG 编辑器常见样式问题:');
console.log('1. 浏览器默认 contentEditable 可能有 outline');
console.log('2. 编辑器容器可能没有正确继承预览样式');
console.log('3. 有序列表编号可能与预览不一致');

console.log('\n=== 建议的修复 ===');
console.log('1. 确保 .wysiwyg-editor 有 outline: none !important');
console.log('2. 确保字体、字号、行高从父元素继承');
console.log('3. 确保列表编号使用 CSS counter 或正确的 marker 样式');
