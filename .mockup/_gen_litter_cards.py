import json, html, os

with open(os.path.join(os.path.dirname(__file__), '_litter_themes.json'), encoding='utf-8') as f:
    themes = json.load(f)


def brightness(hex_color):
    if not hex_color or not hex_color.startswith('#'):
        return 1.0
    h = hex_color.lstrip('#')
    if len(h) != 6:
        return 1.0
    r = int(h[0:2], 16) / 255
    g = int(h[2:4], 16) / 255
    b = int(h[4:6], 16) / 255
    return 0.299 * r + 0.587 * g + 0.114 * b


def adjust(hex_color, amount):
    if not hex_color or not hex_color.startswith('#'):
        return hex_color
    h = hex_color.lstrip('#')
    if len(h) != 6:
        return hex_color
    r = int(h[0:2], 16) / 255
    g = int(h[2:4], 16) / 255
    b = int(h[4:6], 16) / 255
    nr = max(0, min(1, r + amount))
    ng = max(0, min(1, g + amount))
    nb = max(0, min(1, b + amount))
    return '#%02X%02X%02X' % (int(nr * 255), int(ng * 255), int(nb * 255))


def text_on(hex_color):
    return '#0D0D0D' if brightness(hex_color) > 0.55 else '#FFFFFF'


blocks = []
for i, t in enumerate(themes, start=12):
    accent = t['accent'] or '#0169cc'
    bg = t['background'] or '#ffffff'
    fg = t['foreground'] or '#1f2937'
    side_bar_bg = t['sideBarBg'] or adjust(bg, -0.02)
    side_bar_fg = t['sideBarFg'] or adjust(fg, 0)
    border = t['border'] or adjust(bg, -0.06)
    comment = t['comment'] or '#6b7280'
    string = t['string'] or '#065f46'
    keyword = t['keyword'] or '#7c3aed'
    func = t['function'] or '#2563eb'
    type_c = t['type'] or keyword
    number = t['number'] or func
    ansi_red = t['ansiRed'] or '#d53538'
    ansi_green = t['ansiGreen'] or '#008809'
    ansi_yellow = t['ansiYellow'] or '#e2a644'
    ansi_blue = t['ansiBlue'] or '#0169cc'
    ansi_cyan = t['ansiCyan'] or ansi_blue
    ansi_magenta = t['ansiMagenta'] or '#751ED9'
    text_on_accent = text_on(accent)
    editor_bg = side_bar_bg
    gutter = adjust(fg, 0.4) if brightness(bg) > 0.5 else adjust(fg, -0.4)

    name = html.escape(t['name'])
    slug = html.escape(t['slug'])

    card = []
    card.append('  <!-- 方案%d: Litter / %s -->' % (i, name))
    card.append('  <div class="theme-card" id="theme-%d" data-slug="%s">' % (i, slug))
    card.append('    <div class="theme-header" style="background: %s; border-bottom-color: %s;">' % (side_bar_bg, border))
    card.append('      <h3 style="color: %s;">方案%d: Litter / %s</h3>' % (fg, i, name))
    card.append('    </div>')
    card.append('    <div class="theme-body">')
    card.append('      <div class="theme-name" style="color: %s;">配色: %s | accent: <span style="font-family: monospace;">%s</span></div>' % (fg, name, html.escape(accent)))
    card.append('')
    card.append('      <div class="section">')
    card.append('        <div class="section-title" style="color: %s;">Icon 示例</div>' % side_bar_fg)
    card.append('        <div class="icon-sample">')
    card.append('          <div class="icon-size" style="background: %s; color: %s; border-radius: 6px; font-size: 14px;">%s</div>' % (accent, text_on_accent, html.escape('⚙')))
    card.append('          <div class="icon-text" style="color: %s;">主图标</div>' % side_bar_fg)
    card.append('        </div>')
    card.append('        <div style="display: flex; gap: 12px; margin-top: 8px;">')
    for icon, label in [('terminal', 'Terminal'), ('code', 'Editor'), ('wrench', 'Settings'), ('cube', 'Blocks')]:
        card.append('          <div style="display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-%s" style="color: %s; font-size: 14px;"></i><span style="font-size: 11px; color: %s;">%s</span></div>' % (icon, accent, side_bar_fg, label))
    card.append('        </div>')
    card.append('      </div>')
    card.append('')
    card.append('      <div class="section">')
    card.append('        <div class="section-title" style="color: %s;">代码编辑器</div>' % side_bar_fg)
    card.append('        <div class="editor-sample" style="background: %s; border-color: %s; color: %s;">' % (editor_bg, border, fg))
    card.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">01</span><span class="editor-code"><span class="editor-keyword" style="color: %s;">import</span> { Session } <span class="editor-keyword" style="color: %s;">from</span> <span class="editor-string" style="color: %s;">\'./core\'</span>;</span></div>' % (gutter, keyword, keyword, string))
    card.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">02</span><span class="editor-code"><span class="editor-keyword" style="color: %s;">async</span> <span class="editor-function" style="color: %s;">connect</span>(host: <span style="color: %s;">string</span>) {</span></div>' % (gutter, keyword, func, type_c))
    card.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">03</span><span class="editor-code">  <span class="editor-comment" style="color: %s;">// 建立连接</span></span></div>' % (gutter, comment))
    card.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">04</span><span class="editor-code">  <span class="editor-keyword" style="color: %s;">const</span> port = <span style="color: %s;">8080</span>;</span></div>' % (gutter, keyword, number))
    card.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">05</span><span class="editor-code">  <span class="editor-keyword" style="color: %s;">return</span> <span class="editor-keyword" style="color: %s;">new</span> Session(host, port);</span></div>' % (gutter, keyword, keyword))
    card.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">06</span><span class="editor-code">}</span></div>' % gutter)
    card.append('        </div>')
    card.append('      </div>')
    card.append('')
    card.append('      <div class="section">')
    card.append('        <div class="section-title" style="color: %s;">Terminal</div>' % side_bar_fg)
    card.append('        <div class="terminal-sample" style="background: %s; color: %s; border-color: %s;">' % (bg, fg, border))
    card.append('          <div class="terminal-header" style="border-bottom-color: %s;">' % border)
    card.append('            <div class="terminal-dot red"></div>')
    card.append('            <div class="terminal-dot yellow"></div>')
    card.append('            <div class="terminal-dot green"></div>')
    card.append('            <span class="terminal-text" style="color: %s; font-size: 11px;">%s</span>' % (side_bar_fg, slug))
    card.append('          </div>')
    card.append('          <div class="terminal-output">')
    card.append('            <span class="terminal-prompt" style="color: %s;">$</span> npm start<br/>' % ansi_green)
    card.append('            <span style="color: %s;">> %s v1.0.0</span><br/>' % (side_bar_fg, name))
    card.append('            <span style="color: %s;">> Starting server...</span><br/>' % ansi_blue)
    card.append('            <span style="color: %s;">Server running on http://localhost:8080</span><br/>' % ansi_green)
    card.append('            <span class="terminal-prompt" style="color: %s;">$</span> git status<br/>' % ansi_green)
    card.append('            <span style="color: %s;">On branch main, working tree clean</span>' % side_bar_fg)
    card.append('          </div>')
    card.append('        </div>')
    card.append('      </div>')
    card.append('')
    card.append('      <div class="section">')
    card.append('        <div class="section-title" style="color: %s;">Tooltip</div>' % side_bar_fg)
    card.append('        <div class="tooltip-sample">')
    card.append('          <div class="tooltip-trigger" style="background: %s; color: %s; border: 1px solid %s;">%s Tooltip</div>' % (side_bar_bg, fg, border, name))
    card.append('          <div class="tooltip-content" style="background: %s; color: %s; border: 1px solid %s;">%s 主题的提示信息。</div>' % (fg, bg, border, name))
    card.append('        </div>')
    card.append('      </div>')
    card.append('')
    card.append('      <div class="section">')
    card.append('        <div class="section-title" style="color: %s;">按钮</div>' % side_bar_fg)
    card.append('        <div class="btn-group">')
    card.append('          <button class="btn btn-primary" style="background: %s; color: %s; border-color: %s;">主要按钮</button>' % (accent, text_on_accent, accent))
    card.append('          <button class="btn btn-secondary" style="background: %s; color: %s; border-color: %s;">次要按钮</button>' % (side_bar_bg, fg, border))
    card.append('          <button class="btn btn-outline" style="background: transparent; color: %s; border: 1px solid %s;">描边按钮</button>' % (accent, accent))
    card.append('        </div>')
    card.append('      </div>')
    card.append('')
    card.append('      <div class="section">')
    card.append('        <div class="section-title" style="color: %s;">调色板</div>' % side_bar_fg)
    card.append('        <div style="display: flex; gap: 4px; flex-wrap: wrap;">')
    pal = [('background', bg), ('surface', side_bar_bg), ('foreground', fg), ('accent', accent), ('border', border), ('comment', comment), ('string', string), ('keyword', keyword), ('function', func), ('type', type_c), ('ansiRed', ansi_red), ('ansiGreen', ansi_green), ('ansiYellow', ansi_yellow), ('ansiBlue', ansi_blue), ('ansiMagenta', ansi_magenta), ('ansiCyan', ansi_cyan)]
    for label, color in pal:
        card.append('          <div title="%s" style="width: 24px; height: 24px; background: %s; border: 1px solid %s; border-radius: 4px;"></div>' % (label, color, border))
    card.append('        </div>')
    card.append('      </div>')
    card.append('    </div>')
    card.append('  </div>')
    card.append('')
    blocks.append('\n'.join(card))

with open('.mockup/_litter_cards.html', 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(blocks))

print('OK %d cards' % len(blocks))
