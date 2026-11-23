"""Fetch the Mawangdui silk Laozi A and B transcriptions (Wikisource Page: namespace, from the
2014 Jicheng plates) and build sources/mawangdui-a.json and sources/mawangdui-b.json by chapter.
Section labels like "5-38" mark the end of chapter 38. Slow on purpose (rate limits)."""
import urllib.request, urllib.parse, json, re, time, os, sys
UA = {'User-Agent': 'tao-personal-study/1.0'}
DOCS = {'a': '長沙馬王堆漢墓簡帛集成 第一冊 老子甲本 圖版.pdf', 'b': '長沙馬王堆漢墓簡帛集成 第一冊 老子乙本 圖版.pdf'}
RAW = 'sources/raw/variants/pages'
os.makedirs(RAW, exist_ok=True)

def get(title):
    url = 'https://zh.wikisource.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&page=' + urllib.parse.quote(title)
    for attempt in range(6):
        try:
            d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
            return d.get('parse', {}).get('wikitext')
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(30 * (attempt + 1)); continue
            raise
    return None

for key, doc in DOCS.items():
    chapters, buf, page = {}, '', 1
    while True:
        cache = f'{RAW}/{key}-{page:03d}.txt'
        if os.path.exists(cache):
            w = open(cache, encoding='utf8').read()
        else:
            time.sleep(8)
            w = get(f'Page:{doc}/{page}')
            if w is None: break
            open(cache, 'w', encoding='utf8').write(w)
        for name, text in re.findall(r'<section begin="([^"]+)"\s*/>(.*?)<section end="\1"\s*/>', w, re.S):
            buf += re.sub(r'<[^>]+>|\{\{[^}]*\}\}|\s', '', text)
            m = re.match(r'\d+-(\d+)$', name)
            if m:
                chapters[int(m.group(1))] = chapters.get(int(m.group(1)), '') + buf
                buf = ''
        page += 1
        if page > 200: break
    json.dump({str(k): chapters[k] for k in sorted(chapters)}, open(f'sources/mawangdui-{key}.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(key, 'pages', page - 1, 'chapters', len(chapters), file=sys.stderr)
