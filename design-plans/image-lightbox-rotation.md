# 图片 Lightbox 旋转功能方案

## 背景
当前 Markdown 预览的图片灯箱（`ImageLightbox`）支持缩放和平移，但不支持旋转。用户希望在大图预览时能够旋转图片，例如查看截图方向不正确的图片。

## 目标
在现有 lightbox 基础上添加旋转功能，保持交互一致性，不破坏现有缩放/平移体验。

## 现有实现分析
- **组件**: `frontend/app/element/image-lightbox.tsx`
- **样式**: `frontend/app/element/image-lightbox.scss`
- **当前功能**: 
  - 鼠标滚轮缩放（25% - 400%）
  - 拖拽平移（缩放 > 1 时启用）
  - 双击切换“适应窗口”/“100%”
  - ESC / 点击背景 / 关闭按钮退出
- **变换方式**: CSS `transform: translate(${tx}px, ${ty}px) scale(${zoom})`
- **变换中心**: 图片中心（`transform-origin: center center`）

## 方案设计

### 1. 功能规格
- **旋转角度**: 支持 0°、90°、180°、270°（顺时针）
- **旋转中心**: 图片中心（与缩放中心一致）
- **交互方式**: 
  - 按钮：顺时针旋转 90°（每次点击）
  - 键盘快捷键：`R` 顺时针旋转 90°，`Shift+R` 逆时针旋转 90°
  - 可选：触摸手势双指旋转（桌面端可不实现）
- **状态重置**: 
  - 切换图片时旋转重置为 0°
  - 关闭 lightbox 时重置

### 2. UI 设计
- **按钮位置**: 关闭按钮左侧，保持相同尺寸和样式
- **按钮图标**: 使用 Font Awesome 图标 `fa-solid fa-rotate`（顺时针）
- **按钮提示**: "Rotate (R)"
- **布局**: 两个按钮（顺时针、逆时针）或一个按钮（循环旋转）。考虑到空间，建议单个按钮，每次点击顺时针旋转 90°，长按或右键显示菜单选择角度（复杂度高，可后续迭代）。

### 3. 技术实现

#### 3.1 状态管理
```typescript
const [rotation, setRotation] = useState(0); // 角度，0/90/180/270
```

#### 3.2 旋转逻辑
```typescript
const handleRotate = useCallback((clockwise = true) => {
  setRotation(prev => {
    const step = clockwise ? 90 : -90;
    return (prev + step + 360) % 360;
  });
}, []);
```

#### 3.3 CSS 变换顺序
当前：`translate(${tx}px, ${ty}px) scale(${zoom})`
建议：`translate(${tx}px, ${ty}px) rotate(${rotation}deg) scale(${zoom})`
- 旋转放在平移之后、缩放之前，确保旋转中心为图片中心
- 旋转后缩放，避免旋转导致缩放中心偏移

#### 3.4 键盘快捷键
```typescript
useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      handleRotate(!e.shiftKey); // Shift+R 逆时针
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [onClose, handleRotate]);
```

#### 3.5 按钮 UI
```tsx
<button 
  className="image-lightbox-rotate" 
  title="Rotate (R)" 
  onClick={() => handleRotate(true)}
  aria-label="Rotate image"
>
  <i className="fa-solid fa-rotate" />
</button>
```

#### 3.6 样式
```scss
.image-lightbox-rotate {
  // 复用 .image-lightbox-close 的样式
  position: absolute;
  top: 12px;
  right: 56px; // 关闭按钮左侧（36px 按钮 + 8px 间距）
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  font-size: 16px;

  &:hover {
    background: rgba(255, 255, 255, 0.22);
  }
}
```

### 4. 边界情况
- **旋转后平移**: 旋转改变图片边界框，但平移基于屏幕坐标，因此旋转后平移行为不变（图片围绕中心旋转，平移仍正常工作）。
- **旋转后缩放**: 缩放中心仍为图片中心，旋转后缩放视觉效果正常。
- **旋转与双击**: 双击切换“适应窗口”时，旋转状态应保留（只重置缩放和平移）。
- **旋转与重置**: 关闭或切换图片时重置旋转。

### 5. 测试用例
1. 打开 lightbox，点击旋转按钮，图片顺时针旋转 90°。
2. 连续点击 4 次，图片回到原始方向。
3. 按 `R` 键旋转，`Shift+R` 逆时针旋转。
4. 旋转后缩放、平移，验证交互正常。
5. 双击切换缩放，旋转状态保持。
6. 切换图片，旋转重置为 0°。
7. 关闭 lightbox，旋转重置。

## 替代方案
### 方案 A：仅按钮（推荐）
- 实现简单，符合现有 UI 风格
- 适合桌面端，按钮易于发现

### 方案 B：按钮 + 手势
- 添加双指旋转手势（桌面端触摸板或移动端）
- 复杂度高，需处理手势冲突

### 方案 C：右键菜单旋转
- 右键图片显示旋转选项（0°、90°、180°、270°）
- 隐藏交互，发现性差

## 建议
采用 **方案 A（仅按钮）**，实现快速且满足核心需求。如需手势支持，可作为后续迭代。

## 实施步骤
1. 在 `image-lightbox.tsx` 中添加 `rotation` 状态和 `handleRotate` 函数。
2. 修改 CSS 变换字符串，添加 `rotate(${rotation}deg)`。
3. 添加旋转按钮 UI 和样式。
4. 添加键盘快捷键。
5. 处理状态重置逻辑。
6. 测试边界情况。

## 风险与缓解
- **风险**: 旋转后平移/缩放体验异常。
  - **缓解**: 严格测试变换顺序，确保旋转中心正确。
- **风险**: 按钮与现有 UI 冲突。
  - **缓解**: 复用现有按钮样式，保持视觉一致性。

## 预估工作量
- 开发：2-3 小时
- 测试：1 小时

## 待确认
1. 是否需要支持逆时针旋转按钮（还是仅顺时针 + Shift）？
2. 是否需要触摸手势支持？
3. 旋转按钮位置（关闭按钮左侧 vs 其他位置）？

请确认方案或提出修改意见。