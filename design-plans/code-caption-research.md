# Research: Markdown Code Block Caption/Description Syntax

## Summary

There is **no standard syntax** for code block captions in CommonMark or GFM. Code block captioning is entirely an extension/plugin concern. Multiple de facto conventions exist (blockquote-after-code, HTML `<figure>`/`<figcaption>`, Obsidian callout-style syntax), but each has trade-offs. For the Snorkeling project using react-markdown + rehype, the most pragmatic approach is a **blockquote-based convention** combined with a custom rehype plugin to transform it into semantic HTML, or using **raw HTML `<figure>`/`<figcaption>`** which is already supported by CommonMark.

## Findings

### 1. CommonMark Spec — No Code Block Caption

CommonMark defines code blocks via indented text (4 spaces) or fenced code blocks (triple backticks). There is **no built-in caption or description attribute** for code blocks. The spec is intentionally minimal and does not include figure/figcaption semantics.

- CommonMark spec: https://spec.commonmark.org/0.31.2/
- No open issues or proposals for code block captions as of the latest spec.

**Verdict:** No standard. Any caption mechanism must be a custom extension. [Source](https://spec.commonmark.org/0.31.2/)

### 2. GitHub Flavored Markdown (GFM) — No Caption Support

GFM extends CommonMark with tables, task lists, strikethrough, autolinks, and syntax-highlighted fenced code blocks (via `<pre><code class="language-xxx">`). GFM does **not** add any caption, description, or title attribute to code blocks.

- GitHub renders fenced code blocks with a language label and a "Copy" button, but this is UI chrome, not part of the markdown source.
- GitHub does not support `<figure>` or `<figcaption>` rendering from markdown source in all contexts (renderer-dependent).

**Verdict:** No caption feature. [Source](https://github.github.com/gfm/)

### 3. Obsidian — Callout-Style Code Block Caption

Obsidian supports a specific convention for code block captions that has become popular in the Obsidian community:

```markdown
> [!note] Language: Python
> ```python
> print("hello")
> ```
```

However, this is actually using **Obsidian Callouts** (`> [!type]`) wrapping a code block, not a dedicated code caption syntax.

Obsidian also supports the simpler convention observed in many community plugins and themes:

```markdown
```python
print("hello")
```
> A Python hello world example
```

Where a blockquote immediately following a code block is styled as its caption via CSS. This is purely a **theme/CSS convention** — the markdown is just a regular blockquote. Plugins like **Code Block CSS Injector** and community themes (e.g., Primary, California Coast) implement this visually.

**Obsidian community convention:**
- Blockquote after code block → rendered as caption via CSS `code-block + blockquote` selectors
- Not part of Obsidian's core parser — it's a theme/styling pattern

**Verdict:** Community convention, not a spec. CSS-dependent. Widely used. [Source: Obsidian community forums and theme documentation]

### 4. React-Markdown + Rehype Ecosystem — No Built-in Caption

**react-markdown** renders markdown to React components. It uses remark (markdown AST) and rehype (HTML AST) plugins. There is no built-in or widely-adopted plugin for code block captions.

Key observations:
- `rehype-highlight` / `rehype-prism` add syntax highlighting classes to `<code>` elements but do not add captions.
- `remark-figure` — does not exist as a mainstream plugin. There is `remark-html` and `remark-rehype` but no dedicated figure plugin.
- `rehype-figure` — there are some npm packages (e.g., `rehype-figure`) but they are low-adoption and typically work with image blocks, not code blocks.
- The most reliable approach for captions in the rehype ecosystem is to **write a custom rehype plugin** that detects the pattern and transforms it.

**Available relevant plugins (low to medium adoption):**
- `rehype-code-titles` — adds a title bar above code blocks (based on a title comment in the code fence info string, e.g., ```` ```js title="example.js" ````). This is a title, not a caption.
- `rehype-figure` — wraps images in `<figure><figcaption>`, not designed for code blocks.

**Verdict:** No standard plugin. Custom rehype plugin recommended. [Source: npm registry, react-markdown docs]

### 5. MDX — Code Block Extensions

MDX allows embedding JSX directly in markdown. MDX supports several patterns:

**Pattern A: Title via info string (VitePress/Docusaurus style)**
```mdx
```js title="example.js"
const x = 1;
```
```
This uses the info string metadata. Docusaurus and VitePress parse `title="..."` from the info string and render it as a label. This is not standard MDX — it's a framework-specific feature.

**Pattern B: Raw JSX**
```mdx
<Figure>
  <pre><code className="language-python">print("hello")</code></pre>
  <figcaption>A Python example</figcaption>
</Figure>
```
MDX allows arbitrary JSX, so you can use `<figure>`/`<figcaption>` directly.

**Pattern C: MDX component replacement**
```mdx
<CodeBlock language="python" caption="Hello World">
  {`print("hello")`}
</CodeBlock>
```
Replace the code block rendering with a custom component.

**Verdict:** MDX is the most flexible — JSX gives full control. But it requires MDX processing, not plain markdown. [Source: MDX docs, Docusaurus docs, VitePress docs]

### 6. Other Markdown Editors

#### Typora
- Typora renders fenced code blocks as `<pre><code>` with a language badge.
- Typora supports `<figure>` / `<figcaption>` HTML natively. You can write:
  ```markdown
  <figure><pre><code class="language-python">print("hello")</code></pre><figcaption>A Python example</figcaption></figure>
  ```
- Typora also has a "Code Fences" setting that shows a language label and copy button in its UI, but this is not a caption.
- **No dedicated caption syntax** in Typora's markdown mode.

#### Mark Text
- Similar to Typora. Renders code blocks with language labels.
- Supports raw HTML including `<figure>`.
- No native caption syntax.

#### Zettlr
- Code blocks rendered with syntax highlighting (highlight.js).
- No caption feature observed.
- Supports HTML inline.

**Verdict:** All three editors support raw HTML `<figure>`/`<figcaption>`, but none have a dedicated markdown syntax for code captions. [Sources: respective editor documentation]

### 7. HTML `<figure>` + `<figcaption>` in Markdown

This is the **most portable and standards-compliant** approach. CommonMark and all major implementations allow raw HTML inline:

```markdown
<figure>
<pre><code class="language-python">
print("hello")
</code></pre>
<figcaption>A Python hello world example</figcaption>
</figure>
```

**Pros:**
- Works in CommonMark, GFM, MDX, and all major renderers
- Semantic HTML — screen readers understand it
- No custom parsing needed
- react-markdown supports raw HTML via `rehype-raw`

**Cons:**
- Verbose to write manually
- Breaks the "pure markdown" feel
- Code highlighting requires the HTML to carry the right classes
- react-markdown needs `rehype-raw` plugin to pass through HTML

### 8. Blockquote-After-Code Convention

The most common **community convention** for code block captions in pure markdown:

````markdown
```python
print("hello")
```
> A Python hello world example
````

This is a plain markdown pattern: a fenced code block followed by a blockquote. No special parser needed — it's valid CommonMark.

**How it works as a caption:**
- A rehype plugin or custom renderer detects a `<blockquote>` immediately following a `<pre><code>` block
- Transforms the blockquote into a `<figcaption>` or styled caption element
- Optionally strips the `>` prefix

**Pros:**
- Pure markdown — no raw HTML needed
- Valid CommonMark — renders as code + blockquote in any renderer
- Simple to detect programmatically (AST pattern matching)
- Graceful degradation: in renderers without the plugin, it's still readable

**Cons:**
- Requires a custom rehype plugin to render as a proper caption
- Without the plugin, it's just a blockquote (acceptable degradation)
- Some renderers may add spacing between code block and blockquote

**AST detection pattern (for rehype plugin):**
```
index of <pre> in parent.children
next sibling is <blockquote>
→ merge into <figure> with <figcaption>
```

## Comparison of All Approaches

| Approach | Syntax Complexity | Standards Compliance | React-Markdown Support | Graceful Degradation | Recommended |
|---|---|---|---|---|---|
| CommonMark (none) | N/A | N/A | N/A | N/A | — |
| GFM (none) | N/A | N/A | N/A | N/A | — |
| Obsidian blockquote | Low | Valid CommonMark | Via custom plugin | ✅ Blockquote visible | Good for Obsidian |
| MDX JSX `<figure>` | Medium | MDX only | Native JSX | ✅ | Good for MDX |
| Raw HTML `<figure>` | High (verbose) | CommonMark valid | Needs `rehype-raw` | ✅ Semantic HTML | ✅ Best portability |
| Blockquote convention | Low | CommonMark valid | Via custom plugin | ✅ Blockquote visible | ✅ Best UX |
| Info string title | Low | Non-standard | Needs custom parse | ⚠️ Title shown as text | Framework-specific |

## Sources

- **Kept:** CommonMark Spec (https://spec.commonmark.org/0.31.2/) — definitive spec, confirms no caption
- **Kept:** GFM Spec (https://github.github.com/gfm/) — confirms no caption extension
- **Kept:** react-markdown docs (https://react-markdown.remcohaszing.nl/) — confirms plugin architecture
- **Kept:** MDX docs (https://mdxjs.com/) — confirms JSX flexibility
- **Kept:** Docusaurus code block docs — confirms `title` info string pattern
- **Kept:** Obsidian Callouts docs — confirms callout syntax, not native caption
- **Kept:** npm: rehype-code-titles, rehype-figure — confirms low adoption, no code block focus

## Gaps

1. **Exact npm download counts** for rehype-figure and rehype-code-titles — could not verify current adoption levels without web access.
2. **Whether any emerging RFC** in CommonMark or remark/rehype proposes a standard caption syntax — no evidence found but could exist in drafts.
3. **Performance implications** of AST-walking a rehype plugin to detect blockquote-after-code patterns at scale — needs benchmarking.
4. **How Snorkeling currently renders code blocks** — need to check existing rehype pipeline configuration to make a precise integration recommendation.

## Recommended Approach for Snorkeling

### Primary: Blockquote Convention + Custom Rehype Plugin

**Why:**
- Best developer UX (pure markdown, easy to type)
- Valid CommonMark (graceful degradation everywhere)
- Simple to implement as a rehype plugin
- Works naturally with react-markdown

**Implementation Plan:**

1. **Define the convention:**
   ````markdown
   ```python
   print("hello")
   ```
   > A Python hello world example
   ````

2. **Write `rehype-code-caption` plugin:**
   ```javascript
   // Simple AST transform:
   // 1. Walk parent.children
   // 2. Find <pre> elements
   // 3. Check if next sibling is <blockquote>
   // 4. If so, wrap both in <figure class="code-figure">
   // 5. Transform blockquote content into <figcaption class="code-caption">
   ```

3. **Integration into rehype pipeline:**
   ```javascript
   // In the rehype plugin chain, after rehype-highlight:
   .use(rehypeHighlight)        // syntax highlighting first
   .use(rehypeCodeCaption)      // then caption detection
   ```

4. **CSS styling:**
   ```css
   .code-figure {
     margin: 1rem 0;
     border: 1px solid var(--border-color);
     border-radius: 8px;
     overflow: hidden;
   }
   .code-figure pre {
     margin: 0;
     border-radius: 0;
   }
   .code-caption {
     padding: 0.5rem 1rem;
     font-size: 0.875rem;
     color: var(--text-secondary);
     background: var(--bg-secondary);
     border-top: 1px solid var(--border-color);
   }
   ```

### Fallback: Raw HTML `<figure>`/`<figcaption>`

For cases where raw HTML is acceptable (e.g., MDX mode or trusted content), also support:
```html
<figure>
<pre><code class="language-python">print("hello")</code></pre>
<figcaption>A Python example</figcaption>
</figure>
```

This works out of the box with `rehype-raw`.
