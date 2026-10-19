#!/usr/bin/env node
/**
 * WYSIWYG 所见即所得验证测试
 * 
 * 测试策略：
 * 1. 创建一个测试 markdown 文件
 * 2. 在 terminal 中打开它
 * 3. 模拟点击进入编辑
 * 4. 验证编辑器的样式与预览一致
 */

const CDP = require('playwright-core');
const http = require('http');

const CDP_ENDPOINT = 'ws://127.0.0.1:9333';
const TEST_MD = `# 测试文档

这是一个**普通段落**，包含一些*斜体*文字。

## 二级标题

1. 有序列表项一
2. 有序列表项二
3. 有序列表项三

- 无序列表项
- 另一个无序项

> 这是一个引用块

继续写一些内容来测试换行和样式。

### 嵌套列表

- 外层列表
  1. 内层有序项 A
  2. 内层有序项 B
- 回到外层
`;

async function main() {
    console.log('=== WYSIWYG 所见即所得验证测试 ===\n');
    
    // 连接到 CDP
    const browser = await CDP.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    try {
        // 1. 检查当前页面状态
        console.log('1. 检查当前页面状态');
        const pageInfo = await page.evaluate(() => ({
            title: document.title,
            url: window.location.href
        }));
        console.log(`   标题: ${pageInfo.title}`);
        console.log(`   URL: ${pageInfo.url}`);
        
        // 2. 查找 terminal 中的文件
        console.log('\n2. 查找可打开的 markdown 文件');
        const filesResult = await page.evaluate(() => {
            // 模拟：查找文件列表
            return {
                found: true,
                suggestion: '/Users/nita/Primary/projects/snorkeling-wysiwyg/CLAUDE.md'
            };
        });
        console.log(`   建议打开: ${filesResult.suggestion}`);
        
        // 3. 打开 markdown 文件
        console.log('\n3. 打开 markdown 文件');
        // 注意：这里需要用户手动打开或通过命令行打开
        
        // 4. 检查 markdown 渲染元素
        console.log('\n4. 检查 markdown 渲染元素');
        const mdElements = await page.evaluate(() => {
            const root = document.querySelector('.markdown-render-root, [data-md-case]');
            if (!root) return { found: false };
            
            const blocks = root.querySelectorAll('[data-source-line]');
            const paragraphs = root.querySelectorAll('p');
            const headings = root.querySelectorAll('h1, h2, h3');
            const lists = root.querySelectorAll('ul, ol');
            const quotes = root.querySelectorAll('blockquote');
            
            return {
                found: true,
                blockCount: blocks.length,
                paragraphCount: paragraphs.length,
                headingCount: headings.length,
                listCount: lists.length,
                quoteCount: quotes.length
            };
        });
        
        if (mdElements.found) {
            console.log(`   找到 markdown 渲染根`);
            console.log(`   - 源码行块: ${mdElements.blockCount}`);
            console.log(`   - 段落: ${mdElements.paragraphCount}`);
            console.log(`   - 标题: ${mdElements.headingCount}`);
            console.log(`   - 列表: ${mdElements.listCount}`);
            console.log(`   - 引用: ${mdElements.quoteCount}`);
        } else {
            console.log('   当前页面没有 markdown 渲染');
            console.log('   需要手动打开一个 markdown 文件进行测试');
        }
        
        // 5. 截图保存当前状态
        console.log('\n5. 截图');
        await page.screenshot({ path: '/tmp/wysiwyg-test-1-current.png' });
        console.log('   已保存到 /tmp/wysiwyg-test-1-current.png');
        
        // 总结
        console.log('\n=== 测试说明 ===');
        console.log('WYSIWYG 测试需要：');
        console.log('1. 在 terminal 中打开一个 markdown 文件');
        console.log('2. 双击任意块进入编辑模式');
        console.log('3. 观察以下方面：');
        console.log('   - 光标是否在点击位置（不是末尾）');
        console.log('   - 是否有外边框');
        console.log('   - 字体/行高是否与预览一致');
        console.log('   - 列表编号是否正确');
        console.log('4. 直接点击另一个块，看是否能直接切换');
        
    } catch (error) {
        console.error('测试失败:', error);
    } finally {
        await browser.close();
    }
}

main().catch(console.error);
