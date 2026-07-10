import html as _html


BG = '#faf7f0'        # 项目当前米黄主背景
SURFACE = '#fffdf8'   # 实色面板
OVERLAY = '#f3efe4'   # 叠加层
BORDER = '#d6cfbe'    # 米黄边框
FG = '#3c3836'        # 暗棕前景 (gruvbox-light 同源, 与米黄适配)
MUTED = '#6b7280'


def text_on(hex_color):
    h = hex_color.lstrip('#')
    r = int(h[0:2], 16) / 255
    g = int(h[2:4], 16) / 255
    b = int(h[4:6], 16) / 255
    return '#0D0D0D' if (0.299 * r + 0.587 * g + 0.114 * b) > 0.55 else '#FFFFFF'


def mix(hex_color, amount, target):
    """interpolate hex_color toward target by amount (0..1)"""
    h = hex_color.lstrip('#')
    t = target.lstrip('#')
    r = int(h[0:2], 16) / 255
    g = int(h[2:4], 16) / 255
    b = int(h[4:6], 16) / 255
    tr = int(t[0:2], 16) / 255
    tg = int(t[2:4], 16) / 255
    tb = int(t[4:6], 16) / 255
    nr = r + (tr - r) * amount
    ng = g + (tg - g) * amount
    nb = b + (tb - b) * amount
    return '#%02X%02X%02X' % (int(nr * 255), int(ng * 255), int(nb * 255))


def lighten(c, amt):
    return mix(c, amt, '#FFFFFF')


def darken(c, amt):
    return mix(c, amt, '#000000')


def build(idx, slug, name, accent, accent_hover=None, accent_strong=None,
          tone_desc=''):
    accent_hover = accent_hover or lighten(accent, 0.08)
    accent_strong = accent_strong or darken(accent, 0.12)
    text_on_accent = text_on(accent)
    # editor/terminal colors derived from accent (analogous to existing cards)
    keyword = accent
    func = darken(accent, 0.18)
    string = mix(accent, 0.55, '#0d7a3f')  # greenish string
    type_c = darken(accent, 0.25)
    number = mix(accent, 0.7, '#b06535')
    comment = MUTED
    ansi_green = mix(accent, 0.6, '#008809')
    ansi_blue = mix(accent, 0.45, '#0169cc')
    ansi_red = '#d53538'
    ansi_yellow = '#e2a644'
    ansi_magenta = darken(accent, 0.10)
    ansi_cyan = mix(accent, 0.45, '#179299')

    cards = []
    cards.append('  <!-- 方案%d: %s (米黄背景 / accent %s) -->' % (idx, _html.escape(name), accent))
    cards.append('  <div class="theme-card" id="theme-%d" data-slug="%s">' % (idx, _html.escape(slug)))
    cards.append('    <div class="theme-header" style="background: %s; border-bottom-color: %s;">' % (SURFACE, BORDER))
    cards.append('      <h3 style="color: %s;">方案%d: %s</h3>' % (FG, idx, _html.escape(name)))
    cards.append('    </div>')
    cards.append('    <div class="theme-body">')
    cards.append('      <div class="theme-name" style="color: %s;">配色: %s | accent: <span style="font-family: monospace; background:%s; color:%s; padding:1px 5px; border-radius:3px;">%s</span> | 背景: <span style="font-family: monospace;">%s</span> | %s</div>' % (FG, _html.escape(name), accent, text_on_accent, accent, BG, tone_desc))
    cards.append('')
    # Icon section
    cards.append('      <div class="section">')
    cards.append('        <div class="section-title" style="color: %s;">Icon 示例</div>' % MUTED)
    cards.append('        <div class="icon-sample">')
    cards.append('          <div class="icon-size" style="background: %s; color: %s; border-radius: 6px; font-size: 14px;">%s</div>' % (accent, text_on_accent, _html.escape('⚙')))
    cards.append('          <div class="icon-text" style="color: %s;">主图标</div>' % MUTED)
    cards.append('        </div>')
    cards.append('        <div style="display: flex; gap: 12px; margin-top: 8px;">')
    for icon, label in [('terminal', 'Terminal'), ('code', 'Editor'), ('wrench', 'Settings'), ('cube', 'Blocks')]:
        cards.append('          <div style="display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-%s" style="color: %s; font-size: 14px;"></i><span style="font-size: 11px; color: %s;">%s</span></div>' % (icon, accent, MUTED, label))
    cards.append('        </div>')
    cards.append('      </div>')
    cards.append('')
    # Editor
    cards.append('      <div class="section">')
    cards.append('        <div class="section-title" style="color: %s;">代码编辑器</div>' % MUTED)
    cards.append('        <div class="editor-sample" style="background: %s; border-color: %s; color: %s;">' % (SURFACE, BORDER, FG))
    cards.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">01</span><span class="editor-code"><span class="editor-keyword" style="color: %s;">import</span> { Session } <span class="editor-keyword" style="color: %s;">from</span> <span class="editor-string" style="color: %s;">\'./core\'</span>;</span></div>' % (MUTED, keyword, keyword, string))
    cards.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">02</span><span class="editor-code"><span class="editor-keyword" style="color: %s;">async</span> <span class="editor-function" style="color: %s;">connect</span>(host: <span style="color: %s;">string</span>) {</span></div>' % (MUTED, keyword, func, type_c))
    cards.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">03</span><span class="editor-code">  <span class="editor-comment" style="color: %s;">// 建立连接</span></span></div>' % (MUTED, comment))
    cards.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">04</span><span class="editor-code">  <span class="editor-keyword" style="color: %s;">const</span> port = <span style="color: %s;">8080</span>;</span></div>' % (MUTED, keyword, number))
    cards.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">05</span><span class="editor-code">  <span class="editor-keyword" style="color: %s;">return</span> <span class="editor-keyword" style="color: %s;">new</span> Session(host, port);</span></div>' % (MUTED, keyword, keyword))
    cards.append('          <div class="editor-line"><span class="editor-gutter" style="color: %s;">06</span><span class="editor-code">}</span></div>' % MUTED)
    cards.append('        </div>')
    cards.append('      </div>')
    cards.append('')
    # Terminal (浅色背景)
    cards.append('      <div class="section">')
    cards.append('        <div class="section-title" style="color: %s;">Terminal</div>' % MUTED)
    cards.append('        <div class="terminal-sample" style="background: %s; color: %s; border-color: %s;">' % (BG, FG, BORDER))
    cards.append('          <div class="terminal-header" style="border-bottom-color: %s;">' % BORDER)
    cards.append('            <div class="terminal-dot red"></div>')
    cards.append('            <div class="terminal-dot yellow"></div>')
    cards.append('            <div class="terminal-dot green" style="background: %s;"></div>' % accent)
    cards.append('            <span class="terminal-text" style="color: %s; font-size: 11px;">%s</span>' % (MUTED, slug))
    cards.append('          </div>')
    cards.append('          <div class="terminal-output">')
    cards.append('            <span class="terminal-prompt" style="color: %s;">$</span> npm start<br/>' % accent)
    cards.append('            <span style="color: %s;">> %s v1.0.0</span><br/>' % (MUTED, _html.escape(name)))
    cards.append('            <span style="color: %s;">> Starting server...</span><br/>' % ansi_blue)
    cards.append('            <span style="color: %s;">Server running on http://localhost:8080</span><br/>' % ansi_green)
    cards.append('            <span class="terminal-prompt" style="color: %s;">$</span> git status<br/>' % accent)
    cards.append('            <span style="color: %s;">On branch main, working tree clean</span>' % MUTED)
    cards.append('          </div>')
    cards.append('        </div>')
    cards.append('      </div>')
    cards.append('')
    # Tooltip
    cards.append('      <div class="section">')
    cards.append('        <div class="section-title" style="color: %s;">Tooltip</div>' % MUTED)
    cards.append('        <div class="tooltip-sample">')
    cards.append('          <div class="tooltip-trigger" style="background: %s; color: %s; border: 1px solid %s;">%s Tooltip</div>' % (SURFACE, FG, BORDER, _html.escape(name)))
    cards.append('          <div class="tooltip-content" style="background: %s; color: %s; border: 1px solid %s;">%s 主题的提示信息。</div>' % (FG, BG, BORDER, _html.escape(name)))
    cards.append('        </div>')
    cards.append('      </div>')
    cards.append('')
    # Buttons
    cards.append('      <div class="section">')
    cards.append('        <div class="section-title" style="color: %s;">按钮</div>' % MUTED)
    cards.append('        <div class="btn-group">')
    cards.append('          <button class="btn btn-primary" style="background: %s; color: %s; border-color: %s;">主要按钮</button>' % (accent, text_on_accent, accent))
    cards.append('          <button class="btn btn-secondary" style="background: %s; color: %s; border-color: %s;">次要按钮</button>' % (SURFACE, FG, BORDER))
    cards.append('          <button class="btn btn-outline" style="background: transparent; color: %s; border: 1px solid %s;">描边按钮</button>' % (accent, accent))
    cards.append('        </div>')
    cards.append('      </div>')
    cards.append('')
    # Toggle
    cards.append('      <div class="section">')
    cards.append('        <div class="section-title" style="color: %s;">开关控件</div>' % MUTED)
    cards.append('        <div class="toggle-sample">')
    cards.append('          <label style="font-size: 11px; color: %s;">自动连接</label>' % MUTED)
    cards.append('          <label class="toggle-switch">')
    cards.append('            <input type="checkbox" checked>')
    cards.append('            <span class="toggle-slider" style="background: %s;"></span>' % accent)  # checked bg via inline style override? CSS uses .toggle-switch input:checked. Inline bg on slider applies to base; fine for visual since checked state uses CSS rule below — we keep base BG
    cards.append('          </label>')
    cards.append('        </div>')
    cards.append('      </div>')
    cards.append('')
    # Palette
    cards.append('      <div class="section">')
    cards.append('        <div class="section-title" style="color: %s;">调色板</div>' % MUTED)
    cards.append('        <div style="display: flex; gap: 4px; flex-wrap: wrap;">')
    pal = [('背景 bg', BG), ('面板 surface', SURFACE), ('叠加 overlay', OVERLAY), ('前景 fg', FG), ('边框 border', BORDER), ('accent', accent), ('accent-hover', accent_hover), ('accent-strong', accent_strong), ('comment', comment), ('string', string), ('keyword', keyword), ('function', func), ('type', type_c), ('number', number), ('ansiGreen', ansi_green), ('ansiBlue', ansi_blue), ('ansiRed', ansi_red), ('ansiYellow', ansi_yellow), ('ansiMagenta', ansi_magenta), ('ansiCyan', ansi_cyan)]
    for label, color in pal:
        cards.append('          <div title="%s" style="width: 24px; height: 24px; background: %s; border: 1px solid %s; border-radius: 4px;"></div>' % (label, color, BORDER))
    cards.append('        </div>')
    cards.append('      </div>')
    cards.append('    </div>')
    cards.append('  </div>')
    cards.append('')
    return '\n'.join(cards)


THEMES = [
    (38, 'snazzy-green-cream', 'Snazzy 绿 (米黄背景)', '#2DAE58', '#34BF66', '#208E45',
     '饱和绿 · 来自 snazzy-light'),
    (39, 'olive-green-cream', '橄榄绿 (不饱和绿 · 米黄背景)', '#5C7A4A', '#6B8C57', '#475E39',
     '低饱和橄榄绿 · 自然沉稳'),
    (40, 'obsidian-purple-cream', 'Obsidian 紫 (米黄背景)', '#7C4DFF', '#8F66FF', '#6539D6',
     '中性亮紫 · Obsidian logo'),
    (41, 'dusty-purple-cream', '灰紫 (不饱和紫 · 米黄背景)', '#8A7CA8', '#9C8EBB', '#6E6188',
     'muted purple · 柔和灰紫'),
]

header = ('  <!-- ===== 以下为按 accent 调整、维持项目当前米黄背景 #faf7f0 的方案 (38-41) ===== -->\n'
          '  <div style="grid-column: 1 / -1; margin: 24px 0 8px 0; padding: 10px 14px; background: #fffdf8; border-left: 4px solid #b06535; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">\n'
          '    <div style="font-size: 14px; font-weight: 600; color: #3c3836;">米黄背景 · accent 变体系列</div>\n'
          '    <div style="font-size: 11px; color: #6b7280; margin-top: 4px;">背景统一采用项目当前米黄 <code style="background:rgba(176,101,53,0.06);padding:1px 5px;border-radius:3px;">#faf7f0</code> / 面板 <code style="background:rgba(176,101,53,0.06);padding:1px 5px;border-radius:3px;">#fffdf8</code> / 边框 <code style="background:rgba(176,101,53,0.06);padding:1px 5px;border-radius:3px;">#d6cfbe</code>，仅替换 accent 色调。</div>\n'
          '  </div>\n')

all_cards = header
for t in THEMES:
    all_cards += build(*t)

with open('.mockup/_cream_accent_cards.html', 'w', encoding='utf-8', newline='\n') as f:
    f.write(all_cards)
print('OK insertion html size:', len(all_cards))
