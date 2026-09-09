# Image Alt Text Editor — Implementation Result

## Summary

Implemented hover-to-edit alt text for Markdown images in the preview.

## Changes Made

### 1. `frontend/app/element/markdown-util.ts`
- Added `updateImageAltInLine(lineText, src, newAlt)` function
- Replaces the alt text between `![` and `](src...)` while preserving src, title, and size suffix

### 2. `frontend/app/element/markdown.tsx`
- Added import for `updateImageAltInLine`
- Added `altEditing` and `altDraft` state to `MarkdownImg` component
- Added `commitAltEdit()` handler that commits the alt text change via `editImageSyntaxInFullText`
- Added hover-reveal UI: `.markdown-img-alt-display` shows current alt (or "+ Add description" if empty)
- Added inline input UI: `.markdown-img-alt-editor` with Enter to commit, Esc to cancel, blur to commit

### 3. `frontend/app/element/markdown.scss`
- Added `.markdown-img-alt-display` styles (dashed border, hover highlight, text ellipsis)
- Added `.markdown-img-alt-editor` and `.markdown-img-alt-input` styles (accent border, matching theme)

## Behavior
- Hover over an image → shows alt text below (or "+ Add description" if no alt)
- Click the alt display → inline input appears with current alt text
- Type new alt → Enter or blur commits the change to markdown source
- Esc cancels editing without changes
- Only visible when `canEdit` is true (inline editing enabled, has source line)

## Files Changed
- `frontend/app/element/markdown-util.ts` (+22 lines)
- `frontend/app/element/markdown.tsx` (+50 lines)
- `frontend/app/element/markdown.scss` (+60 lines)
