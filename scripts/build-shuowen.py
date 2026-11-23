"""Build sources/shuowen.txt from the Wikisource volumes in sources/raw/shuowen/.
Keeps the text inside templates such as {{yw|…}} and {{+|…}}; drops files, tags, table syntax."""
import re, html
out = []
for i in range(1, 16):
    w = open(f'sources/raw/shuowen/{i:02d}.txt', encoding='utf8').read()
    w = re.sub(r'\[\[File:[^\]]*\]\]', '', w)
    for _ in range(4):  # unwrap nested templates: keep the last argument
        w = re.sub(r'\{\{[^{}|]*\|([^{}]*)\}\}', lambda m: m.group(1).split('|')[-1], w)
    w = re.sub(r'\{\{[^{}]*\}\}', '', w)
    w = re.sub(r'<[^>]+>', '', w)
    w = w.replace("'''", '')
    w = re.sub(r'^\s*(\{\||\|\}|\|-.*|!.*)$', '', w, flags=re.M)        # table rows
    w = re.sub(r'^\|[^|\n]*?\|\s*', '', w, flags=re.M)                  # cell attrs "| style=… |"
    out.append(html.unescape(w))
open('sources/shuowen.txt', 'w', encoding='utf8').write('\n'.join(out))
print('shuowen.txt', sum(map(len, out)))
