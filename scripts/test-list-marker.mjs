#!/usr/bin/env node
/**
 * 列表 marker 编号测试
 * 
 * 测试有序列表从非 1 编号开始时，编辑后是否能正确保留编号
 */

import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { document } = window;

// 模拟有序列表
document.body.innerHTML = `
<ol>
  <li>Item 1</li>
  <li>Item 2</li>
  <li>Item 3</li>
</ol>
`;

// 模拟编辑后删除了第一项，变成：
document.body.innerHTML = `
<ol>
  <li>Item 2</li>
  <li>Item 3</li>
</ol>
`;

const list = document.querySelector('ol');
const items = list.querySelectorAll('li');

// 序列化
const lines = [];
let n = 1; // 当前硬编码从 1 开始
for (const li of items) {
    const text = li.textContent || '';
    const prefix = `${n}. `;
    lines.push(prefix + text);
    n++;
}

console.log('当前序列化结果:');
console.log(lines.join('\n'));
console.log('\n问题: 如果原始列表从 "3." 开始，编辑后变成了 "1."');
console.log('用户期望: 应该保留起始编号');

console.log('\n\n模拟原始列表从 "5." 开始:');
const originalMarker = "5.";
const originalStart = parseInt(originalMarker) || 1;
console.log(`原始列表从 ${originalStart}. 开始`);
console.log('编辑后（删除前两项）:');

// 重新模拟：用户从 "5." 开始的列表删除了前两项
// 原始: "5. Item 1", "6. Item 2", "7. Item 3"
// 删除前两项后剩余: "Item 3" (但没有标记这是从 "7." 开始的)
// 序列化会变成 "1. Item 3" 而不是 "7. Item 3"

const remainingItems = ['Item 3'];
const serialized = remainingItems.map((text, i) => `${originalStart + i}. ${text}`);
console.log(serialized.join('\n'));
console.log('\n问题确认: 有序列表编辑后编号会从 1 开始，而不是保留原始起始编号');
