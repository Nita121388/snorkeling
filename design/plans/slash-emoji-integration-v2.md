# Slash 命令中集成 Emoji 选择功能设计方案（v2）

## 背景

当前项目中：
- `/` 命令在行首触发，用于块级转换（标题、列表、代码块等）
- `:` 命令在行内边界后触发，用于 emoji 选择
- 用户希望在 `/` 命令中也能选择 emoji，以便在笔记中插入 emoji

## 设计原则

1. **开闭原则（OCP）**：对扩展开放，对修改关闭。添加新类型的命令不应修改现有代码
2. **单一职责原则（SRP）**：每个模块只负责一件事情
3. **依赖倒置原则（DIP）**：高层模块不应依赖低层模块，两者都应依赖抽象
4. **接口隔离原则（ISP）**：客户端不应依赖它不需要的接口
5. **封装性**：内部实现细节隐藏，只暴露必要的接口

## 设计目标

在 `/` 命令列表中添加一个 "Emoji" 命令，用户选择后可以打开 emoji 选择器，选择 emoji 后将其插入到当前光标位置。

## 架构设计

### 1. 命令结果类型重构

**问题：** 原方案在 `SlashCommandRunResult` 中添加 `openEmojiPicker` 标记，违反开闭原则

**解决方案：** 引入命令结果类型系统

```typescript
// frontend/app/element/block-editor/registry.ts

/** 命令结果基础类型 */
export interface SlashCommandResultBase {
    /** 结果类型标识 */
    type: string;
}

/** 直接文本替换结果（现有行为） */
export interface TextReplaceResult extends SlashCommandResultBase {
    type: "text-replace";
    text: string;
    caret?: number;
    focusLine?: number;
}

/** 打开选择器结果 */
export interface OpenPickerResult extends SlashCommandResultBase {
    type: "open-picker";
    /** 选择器类型 */
    pickerType: "emoji" | "file" | "date" | string;
    /** 选择器配置 */
    pickerConfig?: Record<string, unknown>;
    /** 选择回调 */
    onPick: (value: unknown) => void;
}

/** 复合结果（同时替换文本并打开选择器） */
export interface CompositeResult extends SlashCommandResultBase {
    type: "composite";
    /** 文本替换部分 */
    textReplace?: {
        text: string;
        caret?: number;
        focusLine?: number;
    };
    /** 选择器部分 */
    openPicker?: {
        pickerType: string;
        pickerConfig?: Record<string, unknown>;
        onPick: (value: unknown) => void;
    };
}

/** 命令运行结果联合类型 */
export type SlashCommandRunResult = 
    | TextReplaceResult 
    | OpenPickerResult 
    | CompositeResult;

/** 向后兼容：简化结果类型（自动转换为 TextReplaceResult） */
export interface SlashCommandSimpleResult {
    text: string;
    caret?: number;
    focusLine?: number;
}
```

### 2. 命令执行器重构

**问题：** 原方案在 `handleSlashPick` 中硬编码处理逻辑

**解决方案：** 引入命令执行器模式

```typescript
// frontend/app/element/block-editor/command-executor.ts

import type { SlashCommandRunResult } from "./registry";

/** 命令执行上下文 */
export interface CommandExecutionContext {
    /** 当前文档文本 */
    documentText: string;
    /** 当前块文本 */
    blockText: string;
    /** 光标位置 */
    caretPosition: number;
    /** 块起始行号 */
    blockStartLine: number;
    /** 块结束行号 */
    blockEndLine: number;
}

/** 命令执行结果处理器接口 */
export interface CommandResultHandler {
    /** 处理文本替换结果 */
    handleTextReplace(result: TextReplaceResult, context: CommandExecutionContext): void;
    
    /** 处理打开选择器结果 */
    handleOpenPicker(result: OpenPickerResult, context: CommandExecutionContext): void;
    
    /** 处理复合结果 */
    handleComposite(result: CompositeResult, context: CommandExecutionContext): void;
}

/** 默认命令执行器 */
export class DefaultCommandExecutor {
    constructor(private handler: CommandResultHandler) {}
    
    execute(result: SlashCommandRunResult, context: CommandExecutionContext): void {
        switch (result.type) {
            case "text-replace":
                this.handler.handleTextReplace(result, context);
                break;
            case "open-picker":
                this.handler.handleOpenPicker(result, context);
                break;
            case "composite":
                this.handler.handleComposite(result, context);
                break;
        }
    }
}
```

### 3. Emoji 命令实现

```typescript
// frontend/app/element/block-editor/commands/slash.ts

import type { SlashCommandSpec } from "../registry";

/** Emoji 选择器配置 */
export interface EmojiPickerConfig {
    /** 初始搜索查询 */
    initialQuery?: string;
    /** 是否显示最近使用 */
    showRecent?: boolean;
    /** 最大数量限制 */
    limit?: number;
}

/** 创建 Emoji 命令 */
function createEmojiCommand(): SlashCommandSpec {
    return {
        id: "emoji",
        label: "Emoji",
        hint: "😀",
        keywords: ["emoji", "表情", "emoticon"],
        group: "insert",
        run: (ctx) => {
            return {
                type: "open-picker",
                pickerType: "emoji",
                pickerConfig: {
                    showRecent: true,
                    limit: 48,
                } as EmojiPickerConfig,
            };
        },
    };
}
```

### 4. 选择器管理器

**问题：** 原方案状态管理分散，与 markdown.tsx 紧密耦合

**解决方案：** 引入选择器管理器

```typescript
// frontend/app/element/block-editor/picker-manager.ts

/** 选择器类型定义 */
export interface PickerDefinition<TConfig = unknown> {
    /** 选择器类型标识 */
    type: string;
    /** 渲染函数 */
    render: (config: TConfig, callbacks: PickerCallbacks<T>) => React.ReactNode;
    /** 键盘导航处理 */
    handleKeyDown?: (event: KeyboardEvent, config: TConfig) => boolean;
}

/** 选择器回调 */
export interface PickerCallbacks<T> {
    onPick: (value: T) => void;
    onClose: () => void;
    onQueryChange?: (query: string) => void;
}

/** 选择器管理器 */
export class PickerManager {
    private definitions = new Map<string, PickerDefinition>();
    
    /** 注册选择器类型 */
    register<T>(definition: PickerDefinition<T>): void {
        this.definitions.set(definition.type, definition);
    }
    
    /** 获取选择器定义 */
    get(type: string): PickerDefinition | undefined {
        return this.definitions.get(type);
    }
    
    /** 检查选择器类型是否已注册 */
    has(type: string): boolean {
        return this.definitions.has(type);
    }
}

// 全局实例
export const pickerManager = new PickerManager();

// 注册内置选择器
pickerManager.register({
    type: "emoji",
    render: (config: EmojiPickerConfig, callbacks) => {
        // 渲染 EmojiPicker 组件
        return <EmojiPicker ... />;
    },
});
```

### 5. Markdown 组件集成

```typescript
// frontend/app/element/markdown.tsx

import { pickerManager } from "./block-editor/picker-manager";

/** 选择器状态 */
interface PickerState {
    isOpen: boolean;
    type: string | null;
    config: unknown;
    anchor: { top: number; left: number } | null;
    query: string;
    activeIndex: number;
}

/** Markdown 组件中的集成 */
const Markdown = () => {
    const [pickerState, setPickerState] = useState<PickerState>({
        isOpen: false,
        type: null,
        config: null,
        anchor: null,
        query: "",
        activeIndex: 0,
    });
    
    /** 命令结果处理器 */
    const commandHandler: CommandResultHandler = useMemo(() => ({
        handleTextReplace: (result, context) => {
            // 现有文本替换逻辑
            handleInlineEditCommit(result.text, ...);
            if (result.focusLine != null) {
                refocusCommittedBlock(result.text, result.focusLine, result.caret);
            }
        },
        
        handleOpenPicker: (result, context) => {
            // 打开选择器
            const anchor = calculatePickerAnchor(context);
            setPickerState({
                isOpen: true,
                type: result.pickerType,
                config: result.pickerConfig,
                anchor,
                query: "",
                activeIndex: 0,
            });
        },
        
        handleComposite: (result, context) => {
            // 处理复合结果
            if (result.textReplace) {
                commandHandler.handleTextReplace(result.textReplace, context);
            }
            if (result.openPicker) {
                commandHandler.handleOpenPicker(result.openPicker, context);
            }
        },
    }), []);
    
    /** 命令执行器 */
    const commandExecutor = useMemo(
        () => new DefaultCommandExecutor(commandHandler),
        [commandHandler]
    );
    
    /** 处理命令选择 */
    const handleSlashPick = useCallback((cmd: SlashCommandSpec) => {
        const session = inlineEdit.editSession;
        if (session == null || slashState == null) {
            return;
        }
        
        const result = execSlashCommand(...);
        setSlashState(null);
        
        if (result == null) {
            return;
        }
        
        // 使用命令执行器处理结果
        const context: CommandExecutionContext = {
            documentText: text,
            blockText: inlineEdit.draftText,
            caretPosition: inlineEdit.textareaRef.current?.selectionStart ?? 0,
            blockStartLine: session.startLine,
            blockEndLine: session.endLine,
        };
        
        commandExecutor.execute(result, context);
    }, [...]);
    
    /** 渲染选择器 */
    const renderPicker = () => {
        if (!pickerState.isOpen || pickerState.type == null) {
            return null;
        }
        
        const definition = pickerManager.get(pickerState.type);
        if (definition == null) {
            return null;
        }
        
        const callbacks: PickerCallbacks<unknown> = {
            onPick: (value) => {
                // 处理选择
                handlePickerPick(pickerState.type, value);
                setPickerState(prev => ({ ...prev, isOpen: false }));
            },
            onClose: () => {
                setPickerState(prev => ({ ...prev, isOpen: false }));
            },
            onQueryChange: (query) => {
                setPickerState(prev => ({ ...prev, query }));
            },
        };
        
        return definition.render(pickerState.config, callbacks);
    };
    
    return (
        <div>
            {/* 现有内容 */}
            
            {/* 渲染选择器 */}
            {renderPicker()}
        </div>
    );
};
```

## 优势与对比

### 原方案问题
1. **违反开闭原则**：每次添加新选择器都需要修改 `SlashCommandRunResult`
2. **违反单一职责原则**：`handleSlashPick` 处理多种不同类型的结果
3. **封装性差**：状态管理分散，与组件紧密耦合
4. **可扩展性差**：添加新功能需要修改多处代码

### 新方案优势
1. **符合开闭原则**：添加新选择器只需注册新的 `PickerDefinition`
2. **符合单一职责原则**：每个模块职责清晰
3. **良好的封装性**：选择器管理器封装了选择器的注册和管理
4. **优秀的可扩展性**：通过插件化架构支持未来扩展
5. **向后兼容**：支持简化结果类型，现有命令无需修改

### 扩展性示例

**添加文件选择器：**
```typescript
pickerManager.register({
    type: "file",
    render: (config: FilePickerConfig, callbacks) => {
        return <FilePicker ... />;
    },
});

// 在命令中使用
run: (ctx) => ({
    type: "open-picker",
    pickerType: "file",
    pickerConfig: { accept: ".md,.txt" },
})
```

**添加日期选择器：**
```typescript
pickerManager.register({
    type: "date",
    render: (config: DatePickerConfig, callbacks) => {
        return <DatePicker ... />;
    },
});

// 在命令中使用
run: (ctx) => ({
    type: "open-picker",
    pickerType: "date",
    pickerConfig: { format: "YYYY-MM-DD" },
})
```

## 实现步骤

### 第一阶段：类型系统重构
1. 定义命令结果类型系统
2. 修改 `SlashCommandSpec` 使用新类型
3. 保持向后兼容（简化结果自动转换）

### 第二阶段：命令执行器
1. 实现 `CommandResultHandler` 接口
2. 实现 `DefaultCommandExecutor`
3. 在 markdown.tsx 中集成执行器

### 第三阶段：选择器管理器
1. 实现 `PickerManager`
2. 注册现有的 emoji 选择器
3. 在 markdown.tsx 中集成选择器渲染

### 第四阶段：Emoji 命令实现
1. 创建 emoji 命令
2. 测试和调试

### 第五阶段：清理和文档
1. 更新相关文档
2. 添加单元测试
3. 代码审查

## 测试用例

### 单元测试
1. 测试命令结果类型转换
2. 测试命令执行器
3. 测试选择器管理器

### 集成测试
1. 测试 emoji 命令触发
2. 测试选择器打开和关闭
3. 测试 emoji 选择和插入

### 端到端测试
1. 测试完整用户流程
2. 测试键盘导航
3. 测试边界情况

## 风险评估

### 技术风险
1. **类型系统复杂性**：需要确保类型定义清晰且易于理解
2. **向后兼容性**：需要确保现有命令不受影响
3. **性能影响**：需要确保新架构不会引入性能问题

### 缓解措施
1. **渐进式重构**：分阶段实施，每阶段都保持功能完整
2. **充分测试**：为每个模块添加单元测试
3. **性能监控**：监控关键路径的性能指标

## 总结

本方案通过引入类型系统、命令执行器和选择器管理器，实现了：
1. **良好的封装性**：每个模块职责清晰，内部实现隐藏
2. **优秀的可扩展性**：通过插件化架构支持未来扩展
3. **符合软件设计原则**：开闭原则、单一职责原则、依赖倒置原则
4. **向后兼容**：支持现有命令无需修改

推荐采用此方案，它为未来的功能扩展奠定了良好的架构基础。
