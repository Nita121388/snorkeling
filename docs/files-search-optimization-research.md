# Files Search 功能查询匹配优化方案 — 深入调研报告

## 1. 现状分析

### 1.1 当前实现架构

Files（files-community/Files）的搜索功能包含两个并行搜索通道：

#### 文件名搜索（FileName Search）
- **实现方式**：Go 的 `filepath.WalkDir` 遍历目录树
- **匹配逻辑**：简单字符串包含匹配（`strings.Contains`）
- **智能大小写**：当查询包含大写字母时区分大小写，否则不区分
- **跳过目录**：`.git`, `.svn`, 隐藏目录等

#### 文件内容搜索（File Content Search）
- **首选方案**：Ripgrep（`rg`）外部进程，使用 JSON 输出解析
- **回退方案**：Go 实现的逐行文件扫描
- **过滤条件**：排除 `.git`, `node_modules`, `dist`, `build`, `target`, `vendor`, `.venv` 等

### 1.2 关键参数

| 参数 | 默认值 | 最大值 |
|------|--------|--------|
| SearchLimit | 500 | 2000 |
| SearchMaxFileSize | 1MB | - |
| SearchAutoSubmitMs | 250ms | - |
| SearchClickDelayMs | 350ms | - |

### 1.3 现存痛点

1. **搜索速度慢**：无索引时需遍历整个目录树
2. **大目录性能差**：超过 SearchLimit 后截断结果
3. **无增量搜索**：每次搜索重新遍历
4. **无索引缓存**：搜索结果不持久化
5. **过滤功能有限**：不支持按日期、大小、类型等高级过滤

---

## 2. VSCode 搜索实现深度分析

### 2.1 架构概览

VSCode 采用 **Provider 模式** 架构，将搜索逻辑抽象为可扩展的接口：

```
┌─────────────────────────────────────────────────────────────┐
│                     SearchService                           │
│  (搜索服务核心，管理搜索提供者和调度)                           │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ FileSearch   │  │ TextSearch   │  │ AITextSearch │      │
│  │ Provider     │  │ Provider     │  │ Provider     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ QueryBuilder │  │ FileSearch   │  │ TextSearch   │      │
│  │              │  │ Manager      │  │ Manager      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 搜索类型

| 类型 | 说明 | 实现位置 |
|------|------|----------|
| **File Search** | 文件名搜索（Quick Open） | `fileSearchManager.ts` |
| **Text Search** | 文件内容搜索（搜索面板） | `textSearchManager.ts` |
| **AI Text Search** | AI 辅助搜索 | `AISearch/` |

### 2.3 文件名搜索实现

#### 核心流程
```typescript
// fileSearchManager.ts
class FileSearchEngine {
    private filePattern?: string;
    private includePattern?: glob.ParsedExpression;
    private maxResults?: number;
    private excludePattern?: glob.ParsedExpression;

    constructor(private config: IFileQuery, private provider: FileSearchProvider2) {
        this.filePattern = config.filePattern;
        this.includePattern = config.includePattern && glob.parse(config.includePattern);
        this.excludePattern = config.excludePattern && glob.parse(config.excludePattern);
    }

    async search(onResult: (match: IInternalFileMatch) => void): Promise<IInternalSearchComplete> {
        // 1. 搜索额外文件资源
        if (this.config.extraFileResources) {
            this.config.extraFileResources.forEach(extraFile => {
                this.matchFile(onResult, { base: extraFile, basename: path.basename(extraFile.toString()) });
            });
        }

        // 2. 搜索文件夹
        const folderQueries = this.config.folderQueries || [];
        await this.doSearch(folderQueries, onResult);

        return { limitHit: this.isLimitHit };
    }
}
```

#### 关键特性

**1. Glob 模式支持**
```typescript
// 支持复杂的 glob 模式
const includePattern = glob.parse('**/*.{ts,js}', { ignoreCase: true });
const excludePattern = glob.parse('**/node_modules/**');

// 测试文件是否匹配
if (includePattern(fileBasename) && !excludePattern(filePath)) {
    // 匹配成功
}
```

**2. 智能大小写（Smart Case）**
```typescript
// 当查询包含大写字母时区分大小写
private isCaseSensitive(pattern: IPatternInfo, options: ITextQueryBuilderOptions): boolean {
    if (options.isCaseSensitive !== undefined) {
        return options.isCaseSensitive;
    }
    return /[A-Z]/.test(pattern.pattern);
}
```

**3. 结果限制与截断**
```typescript
private maxResults = config.maxResults || DEFAULT_MAX_SEARCH_RESULTS; // 默认 25600

// 达到限制时设置 isLimitHit
if (this.resultCount >= this.maxResults!) {
    this.isLimitHit = true;
    return;
}
```

**4. 取消支持**
```typescript
private activeCancellationTokens: Set<CancellationTokenSource> = new Set();

cancel(): void {
    this.isCanceled = true;
    this.activeCancellationTokens.forEach(t => t.cancel());
    this.activeCancellationTokens = new Set();
}
```

### 2.4 内容搜索实现

#### 核心流程
```typescript
// textSearchManager.ts
class TextSearchManager {
    private collector: TextSearchCompleteCollector;

    async search(query: ITextQuery, token: CancellationToken): Promise<ISearchComplete> {
        // 1. 分割同步/异步搜索
        const { syncResults, asyncResults } = this.textSearchSplitSyncAsync(query, token);

        // 2. 合并结果
        const openEditorResults = syncResults;
        const otherResults = await asyncResults;

        return {
            limitHit: otherResults.limitHit || openEditorResults.limitHit,
            results: [...otherResults.results, ...openEditorResults.results],
            messages: [...otherResults.messages, ...openEditorResults.messages]
        };
    }

    private textSearchSplitSyncAsync(query: ITextQuery, token: CancellationToken) {
        // 同步搜索：已打开的编辑器
        const openEditorResults = this.getOpenEditorResults(query);

        // 异步搜索：文件系统
        const getAsyncResults = async () => {
            return await this.doSearch(query, token, onProviderProgress);
        };

        return {
            syncResults: openEditorResults,
            asyncResults: getAsyncResults()
        };
    }
}
```

#### 关键特性

**1. 正则表达式支持**
```typescript
// 支持完整的正则表达式
interface IPatternInfo {
    pattern: string;
    isRegExp?: boolean;
    isCaseSensitive?: boolean;
    isWordMatch?: boolean;
    isMultiline?: boolean;
    wordSeparators?: string;
}

// 正则表达式转换
if (pattern.isRegExp) {
    pattern.pattern = pattern.pattern.replace(/\r?\n/g, '\\n');
}
```

**2. 上下文预览**
```typescript
interface ITextSearchPreviewOptions {
    matchLines: number;      // 显示的匹配行数
    before: number;          // 匹配前的行数
    after: number;           // 匹配后的行数
}
```

**3. Notebook 搜索支持**
```typescript
// 支持 Notebook 文件搜索
notebookSearchConfig?: {
    includeMarkupInput: boolean;    // 包含 Markdown 输入
    includeMarkupPreview: boolean;  // 包含 Markdown 预览
    includeCodeInput: boolean;      // 包含代码输入
    includeOutput: boolean;         // 包含输出
};
```

**4. AI 搜索集成**
```typescript
// 新增 AI 搜索支持
async aiTextSearch(query: IAITextQuery, token?: CancellationToken): Promise<ISearchComplete> {
    const provider = this.getSearchProvider(QueryType.aiText).get(Schemas.file);
    return await provider?.provideTextSearchResults(query, token);
}
```

### 2.5 查询构建器（QueryBuilder）

#### 查询构建流程
```typescript
class QueryBuilder {
    constructor(
        @IConfigurationService private readonly configurationService: IConfigurationService,
        @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
        @IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
        @ILogService private readonly logService: ILogService,
        @IPathService private readonly pathService: IPathService
    ) {}

    // 文件名搜索查询
    file(folders: (IWorkspaceFolderData | URI)[], options: IFileQueryBuilderOptions = {}): IFileQuery {
        const commonQuery = this.commonQuery(folders, options);
        return {
            ...commonQuery,
            type: QueryType.File,
            filePattern: options.filePattern,
            exists: options.exists,
            sortByScore: options.sortByScore,
            cacheKey: options.cacheKey,
        };
    }

    // 内容搜索查询
    text(contentPattern: IPatternInfo, folderResources?: URI[], options: ITextQueryBuilderOptions = {}): ITextQuery {
        const commonQuery = this.commonQuery(folderResources?.map(toWorkspaceFolder), options);
        return {
            ...commonQuery,
            type: QueryType.Text,
            contentPattern: this.getContentPattern(contentPattern, options),
            previewOptions: options.previewOptions,
            maxFileSize: options.maxFileSize,
            surroundingContext: options.surroundingContext,
        };
    }
}
```

#### 查询优化策略

**1. 排除模式处理**
```typescript
private getExcludePattern(excludePattern: ISearchPatternBuilder, folder?: IWorkspaceFolderData | URI) {
    const excludeExpression: glob.IExpression = {};

    if (typeof excludePattern === 'string') {
        excludeExpression[excludePattern] = true;
    } else if (Array.isArray(excludePattern)) {
        excludePattern.forEach(pattern => {
            excludeExpression[pattern] = true;
        });
    }

    return excludeExpression;
}
```

**2. 文件大小限制**
```typescript
// 可配置最大文件大小
maxFileSize?: number;

// 搜索时跳过大文件
if (fileInfo.size > query.maxFileSize) {
    return;
}
```

### 2.6 与 Files 搜索对比

| 特性 | VSCode | Files |
|------|--------|-------|
| **搜索架构** | Provider 模式，可扩展 | 单一实现，Ripgrep + Go |
| **搜索类型** | 文件名 + 内容 + AI | 文件名 + 内容 |
| **索引策略** | 无索引，实时搜索 | 无索引，实时搜索 |
| **取消支持** | 完善的 CancellationToken | 有限的取消支持 |
| **结果限制** | 可配置，默认 25600 | 固定 500-2000 |
| **Glob 模式** | 完整支持 | 不支持 |
| **正则表达式** | 完整支持 | 不支持 |
| **智能大小写** | 支持 | 支持 |
| **文件大小过滤** | 支持 | 支持（仅内容搜索） |
| **排除模式** | 配置驱动 | 硬编码 |
| **同步/异步分离** | 支持 | 不支持 |

---

## 3. 优化方案调研

### 3.1 方案一：集成 Everything Search（推荐 ⭐）

#### 概述
Everything（voidtools）是一个基于 NTFS USN Journal 的即时文件搜索引擎，搜索速度极快。

#### 优势
- **即时搜索**：基于 NTFS USN Journal 的增量索引，搜索延迟 <10ms
- **低资源占用**：索引大小仅为 Windows Search 的 1/10
- **成熟的 SDK**：Everything SDK 支持 C/C++/C#/Python 等多语言
- **社区验证**：已有多款应用集成（Listary, Total Commander, Flow Launcher）

#### 实现方式

**方式 A：可选集成（推荐）**
```csharp
// 设置界面提供搜索引擎选择
public enum PreferredSearchEngine
{
    SystemSearch,
    Everything
}

// 检测 Everything 是否运行
if (EverythingService.IsRunning())
{
    // 使用 Everything SDK 搜索
    var results = await EverythingService.SearchAsync(query);
}
else
{
    // 回退到 Windows Search
    var results = await WindowsSearchService.SearchAsync(query);
}
```

**方式 B：独立进程集成**
- 维护独立的 Tantivy 索引进程
- 类似 Everything 的工作方式，但不依赖外部软件

#### 关键代码参考

```go
// Go 版本可以通过 CGO 或 gRPC 调用 Everything SDK
// 或使用 Everything 的命令行接口

// 示例：通过 Everything Service IPC
func SearchEverything(query string) ([]FileResult, error) {
    // 连接到 Everything Service
    // 发送搜索请求
    // 解析返回结果
}
```

#### 社区讨论要点
- **Issue #5845**：39 条评论，持续讨论 4 年
- **PR #17336**：已实现 Everything 集成，但尚未合并
- **核心争议**：是否需要用户单独安装 Everything
- **折中方案**：可选集成 + 引导安装 + 回退机制

---

### 3.2 方案二：自建文件索引

#### 概述
维护自己的文件索引，类似于 Everything 的工作方式，但不依赖外部软件。

#### 技术选型

| 技术 | 优势 | 劣势 |
|------|------|------|
| **Tantivy** | Rust 实现，高性能全文搜索 | 需要维护索引进程 |
| **SQLite FTS5** | 内嵌数据库，无需外部依赖 | 性能不如专业搜索引擎 |
| **Bleve** | Go 原生全文搜索库 | 索引体积较大 |
| **BoltDB + 自定义索引** | 轻量级，易于维护 | 需要自己实现搜索逻辑 |

#### Tantivy 方案（推荐）

```rust
// 独立索引进程
pub struct FileIndexService {
    index: Index,
    writer: IndexWriter,
}

impl FileIndexService {
    pub fn search(&self, query: &str) -> Vec<FileResult> {
        let searcher = self.index.reader().searcher();
        let query_parser = QueryParser::for_index(&self.index, vec![self.path_field, self.name_field]);
        let query = query_parser.parse_query(query).unwrap();
        
        searcher.search(&query, &TopDocs::with_limit(500))
            .unwrap()
            .iter()
            .map(|(_, doc_addr)| self.doc_to_result(*doc_addr))
            .collect()
    }
    
    pub fn update_index(&mut self, path: &str) {
        // 增量更新索引
        // 监听文件系统变化
    }
}
```

#### 索引策略

1. **全量索引**：首次启动时遍历目录树
2. **增量更新**：监听文件系统变化事件（inotify/FSEvents/USN Journal）
3. **定期刷新**：每 N 分钟重新扫描变更的目录

---

### 3.3 方案三：Windows Search API 集成

#### 概述
使用 Windows 内置的 Windows Search 服务进行索引搜索。

#### 优势
- 无需额外安装
- 已有系统级索引
- 支持属性过滤（日期、大小、类型等）

#### 劣势
- 索引可能不完整
- 搜索延迟较高（100ms-1s）
- 资源占用较高

#### 实现示例

```csharp
// 使用 Windows Search API (ODBC)
using (var connection = new OleDbConnection("Provider=Search.CollatorDSO;Extended Properties='Application=Windows'"))
{
    connection.Open();
    var command = new OleDbCommand(
        $"SELECT System.ItemName, System.ItemPathDisplay FROM SystemIndex WHERE SCOPE='file:{path}' AND System.ItemName LIKE '%{query}%'",
        connection);
    
    using (var reader = command.ExecuteReader())
    {
        while (reader.Read())
        {
            // 处理搜索结果
        }
    }
}
```

---

### 3.4 方案四：查询匹配算法优化

#### 3.4.1 模糊匹配

```typescript
// 当前实现：简单字符串包含
function matchesFileNameSearchQuery(label: string, query: string): boolean {
    const hasUppercaseLetters = /[A-Z]/.test(query);
    if (hasUppercaseLetters) {
        return label.includes(query);
    }
    return label.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

// 优化方案：支持模糊匹配
function fuzzyMatch(label: string, query: string): number {
    // 1. 完全匹配 → 分数 100
    if (label === query) return 100;
    
    // 2. 前缀匹配 → 分数 90
    if (label.startsWith(query)) return 90;
    
    // 3. 包含匹配 → 分数 70
    if (label.includes(query)) return 70;
    
    // 4. 子序列匹配 → 分数 50-60
    const subsequenceScore = longestCommonSubsequence(label, query);
    if (subsequenceScore > query.length * 0.6) {
        return 50 + (subsequenceScore / query.length) * 10;
    }
    
    // 5. 编辑距离匹配 → 分数 30-40
    const editDistance = levenshteinDistance(label, query);
    if (editDistance <= 3) {
        return 30 + (1 - editDistance / 3) * 10;
    }
    
    return 0;
}
```

#### 3.4.2 搜索结果排序优化

```typescript
// 当前实现：简单排序（目录优先 + 自然字符串比较）
function sortFileNameMatches(matches: FileNameSearchMatch[]): FileNameSearchMatch[] {
    return [...matches].sort((left, right) => {
        const leftDir = left.isdir ? 0 : 1;
        const rightDir = right.isdir ? 0 : 1;
        if (leftDir !== rightDir) {
            return leftDir - rightDir;
        }
        const leftLabel = (left.relpath ?? left.path).toLocaleLowerCase();
        const rightLabel = (right.relpath ?? right.path).toLocaleLowerCase();
        if (leftLabel !== rightLabel) {
            return naturalStringCompare(leftLabel, rightLabel);
        }
        return naturalStringCompare(left.path, right.path);
    });
}

// 优化方案：多维度评分排序
function rankSearchResults(matches: FileNameSearchMatch[], query: string): FileNameSearchMatch[] {
    return matches
        .map(match => ({
            ...match,
            score: calculateRelevanceScore(match, query)
        }))
        .sort((a, b) => b.score - a.score);
}

function calculateRelevanceScore(match: FileNameSearchMatch, query: string): number {
    let score = 0;
    const name = match.relpath ?? match.path;
    
    // 1. 匹配质量分数
    score += fuzzyMatch(name, query) * 0.4;
    
    // 2. 路径深度分数（浅层路径优先）
    const depth = name.split('/').length;
    score += Math.max(0, 10 - depth) * 0.2;
    
    // 3. 最近修改时间分数
    if (match.lastModified) {
        const daysSinceModified = (Date.now() - match.lastModified) / (1000 * 60 * 60 * 24);
        score += Math.max(0, 30 - daysSinceModified) * 0.1;
    }
    
    // 4. 访问频率分数（如果有统计）
    if (match.accessCount) {
        score += Math.min(match.accessCount, 10) * 0.1;
    }
    
    return score;
}
```

#### 3.4.3 查询语法扩展

```typescript
// 支持高级查询语法
interface SearchQuery {
    text: string;
    path?: string;
    ext?: string;
    size?: { min?: number; max?: number };
    modified?: { after?: Date; before?: Date };
    type?: 'file' | 'dir';
}

function parseSearchQuery(rawQuery: string): SearchQuery {
    const query: SearchQuery = { text: '' };
    
    // 支持的语法：
    // - path:src 按路径过滤
    // - ext:ts 按扩展名过滤
    // - size:>1MB 按大小过滤
    // - modified:>2024-01-01 按修改时间过滤
    // - type:file 按类型过滤
    
    const tokens = tokenize(rawQuery);
    for (const token of tokens) {
        if (token.startsWith('path:')) {
            query.path = token.slice(5);
        } else if (token.startsWith('ext:')) {
            query.ext = token.slice(4);
        } else if (token.startsWith('size:')) {
            query.size = parseSizeFilter(token.slice(5));
        } else if (token.startsWith('modified:')) {
            query.modified = parseDateFilter(token.slice(9));
        } else if (token.startsWith('type:')) {
            query.type = token.slice(5) as 'file' | 'dir';
        } else {
            query.text += (query.text ? ' ' : '') + token;
        }
    }
    
    return query;
}
```

---

### 3.5 方案五：性能优化

#### 3.5.1 搜索结果缓存

```typescript
class SearchCache {
    private cache = new Map<string, { results: any[], timestamp: number }>();
    private maxAge = 5000; // 5秒缓存
    
    get(key: string): any[] | null {
        const entry = this.cache.get(key);
        if (entry && Date.now() - entry.timestamp < this.maxAge) {
            return entry.results;
        }
        this.cache.delete(key);
        return null;
    }
    
    set(key: string, results: any[]): void {
        this.cache.set(key, { results, timestamp: Date.now() });
    }
}
```

#### 3.5.2 搜索结果流式处理

```typescript
// 当前实现已使用流式处理（AsyncGenerator）
// 优化点：增加取消支持和进度反馈
async function* searchWithProgress(query: string): AsyncGenerator<SearchResult, void, boolean> {
    const abortController = new AbortController();
    
    try {
        yield* searchFiles(query, abortController.signal);
    } catch (error) {
        if (error.name === 'AbortError') {
            return; // 用户取消
        }
        throw error;
    }
}
```

#### 3.5.3 后台索引预热

```typescript
// 应用启动时后台预热索引
async function warmUpIndex(rootPath: string) {
    // 1. 扫描常用目录
    const commonDirs = await getFrequentlyUsedDirectories();
    
    // 2. 预构建目录树缓存
    for (const dir of commonDirs) {
        await buildDirectoryTreeCache(dir);
    }
    
    // 3. 预索引最近修改的文件
    const recentFiles = await getRecentlyModifiedFiles(rootPath, 1000);
    await indexFiles(recentFiles);
}
```

---

## 4. 实施建议

### 4.1 短期优化（1-2 周）

1. **查询语法扩展**：支持 glob/正则/全词匹配（参考 VSCode QueryBuilder）
2. **Provider 模式架构**：抽象 `ISearchProvider` 接口，支持多种搜索后端
3. **同步/异步搜索分离**：先搜已打开文件（同步），再搜磁盘（异步流式）
4. **完善取消支持**：全链路 CancellationToken
5. **排除模式配置化**：支持 .gitignore + 配置驱动

### 4.2 中期优化（1-2 月）

1. **Everything 集成**：可选集成 Everything Search
2. **索引预热**：后台预热常用目录
3. **搜索结果持久化**：缓存搜索结果到本地
4. **AI 搜索集成**：自然语言搜索支持

### 4.3 长期优化（3-6 月）

1. **自建索引服务**：使用 Tantivy 或类似技术
2. **机器学习排序**：基于用户行为学习排序
3. **跨平台搜索优化**：macOS/Linux 适配

---

## 5. 参考资源

### 5.1 GitHub Issues & PRs
- [#5845](https://github.com/files-community/Files/issues/5845) - Everything search integration
- [#17336](https://github.com/files-community/Files/pull/17336) - Everything 集成 PR
- [#17457](https://github.com/files-community/Files/issues/17457) - Natural Language Search
- [#4813](https://github.com/files-community/Files/issues/4813) - Search filters UI
- [#9711](https://github.com/files-community/Files/issues/9711) - Regex to AQS conversion

### 5.2 技术资源
- [Everything SDK](https://www.voidtools.com/support/everything/sdk/) - Everything 搜索引擎 SDK
- [EverythingSharp](https://github.com/Riboe/EverythingSharp) - C# SDK 封装
- [Tantivy](https://github.com/quickwit-oss/tantivy) - Rust 全文搜索引擎
- [Windows Search API](https://learn.microsoft.com/en-us/windows/win32/search/-search-7x-about) - Windows 搜索 API 文档

### 5.3 VSCode 源码
- [searchService.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/search/common/searchService.ts) - 搜索服务核心
- [fileSearchManager.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/search/common/fileSearchManager.ts) - 文件名搜索管理
- [textSearchManager.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/search/common/textSearchManager.ts) - 内容搜索管理
- [queryBuilder.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/search/common/queryBuilder.ts) - 查询构建器

### 5.4 相关项目
- [Everything Toolbar](https://github.com/stnkl/EverythingToolbar) - Everything 工具栏
- [Listary](https://www.listary.com/) - 文件搜索工具
- [Flow Launcher](https://github.com/Flow-Launcher/Flow.Launcher) - 启动器，支持 Everything

---

## 6. 总结

Files 的搜索功能优化应优先考虑：

1. **短期**：查询语法扩展 + Provider 模式架构 + 同步/异步分离
2. **中期**：Everything 可选集成 + 索引预热 + AI 搜索
3. **长期**：自建索引服务 + 机器学习排序

推荐的实施路径：
1. 先实现查询语法扩展和 Provider 抽象（参考 VSCode 架构，低风险，快速见效）
2. 再集成 Everything（需要处理安装依赖问题）
3. 最后考虑自建索引（高投入，高收益）

---

*报告生成时间：2026-09-02*
*调研来源：VSCode 源码分析、GitHub Issues/PRs、代码库分析、社区讨论*
