// How the draw works, sources, licenses, and where your data lives.
import { h, s as svgEl, tetragram } from '../ui.js';
import { getGlossary, getArt, getMap } from '../data.js';
import { openGlossary, openChar, linkRefsIn } from '../notes.js';
import { howSection } from './how.js';
import { getWing } from '../data.js';
import { openWingNote, openArt } from './passage.js';

function src(text, links = []) {
  return h('li', {}, text, links.length ? h('span', { class: 'src-links' }, ...links.map(([label, href]) =>
    h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: label }))) : null);
}

/** Scroll to a section after route() has put the page on screen (it scrolls to the top first). */
function scrollToSection(id) {
  if (!id) return;
  setTimeout(() => {
    const el = document.getElementById(`s-${id}`);
    if (!el) return;
    const bar = document.querySelector('.bar')?.offsetHeight || 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - bar - 12, behavior: 'auto' });
  }, 0);
}

export async function aboutView(section) {
  const [gl, wing, art, map] = await Promise.all([getGlossary(), getWing(), getArt(), getMap().catch(() => null)]);
  ART = art;
  const wingIntro = (wing.passages?.['0'] || [])[0];
  const li = (...c) => h('li', {}, ...c);
  scrollToSection(section); // runs after route() attaches the page
  return linkRefsIn(h('section', { class: 'about' },
    h('h1', { text: 'About' }),
    h('p', { class: 'lead', text: 'This is an interactive tool for exploring the Tao Te Ching. It offers a way to meet the text one passage at a time: by chance, slowly, with room to write. Below: where the text came from, who has used it and why, and how you might use it, and this tool, today.' }),

    history(map),
    useToday(),

    howSection(),

    h('h3', { text: 'The texts and sources' }),
    h('ul', { class: 'sources' },
      src('Chinese: the received text with Wang Bi’s commentary (王弼, 226–249 CE). Public domain.', [['Wikisource: 道德經 (王弼本)', 'https://zh.wikisource.org/wiki/%E9%81%93%E5%BE%B7%E7%B6%93_(%E7%8E%8B%E5%BC%BC%E6%9C%AC)']]),
      src('James Legge, “The Tâo Teh King,” Sacred Books of the East vol. 39 (1891). Public domain.', [['Wikisource: Tâo Teh King', 'https://en.wikisource.org/wiki/T%C3%A2o_Teh_King']]),
      src('The English renderings, titles, reflections, notes, and echoes are new, written for this page from the Chinese.'),
      src('Character data: the Unicode Unihan database (© Unicode, Inc., Unicode License).', [['Unihan database', 'https://www.unicode.org/charts/unihan.html'], ['Unicode License', 'https://www.unicode.org/license.txt']]),
      src('Shuowen Jiezi (說文解字), Xu Shen, c. 100 CE. Public domain. Every quotation is checked against this text.', [['Wikisource: 說文解字', 'https://zh.wikisource.org/wiki/%E8%AA%AA%E6%96%87%E8%A7%A3%E5%AD%97']]),
      src('Wiktionary (CC BY-SA): facts paraphrased and credited in the notes; each character sheet links to its entry.', [['Wiktionary', 'https://en.wiktionary.org/']]),
      src('Variant readings: the Mawangdui silk manuscripts (2nd c. BCE). Readings are marked “reported” unless confirmed; the Wikisource text is a modern collated reconstruction.', [['About the silk texts', 'https://en.wikipedia.org/wiki/Mawangdui_Silk_Texts'], ['Wikisource: 老子 (帛書校勘版)', 'https://zh.wikisource.org/wiki/%E8%80%81%E5%AD%90_(%E5%B8%9B%E6%9B%B8%E6%A0%A1%E5%8B%98%E7%89%88)']]),
      src('Echoes and stories quote the original texts, freshly translated: Zhuangzi, Sunzi, the Yijing, Sima Qian’s Shiji, Liezi, the Story of the Stone (紅樓夢), and Miyamoto Musashi’s Book of Five Rings (五輪書, the Yoshida-family manuscript).', [
        ['莊子', 'https://zh.wikisource.org/wiki/%E8%8E%8A%E5%AD%90'], ['孫子兵法', 'https://zh.wikisource.org/wiki/%E5%AD%AB%E5%AD%90%E5%85%B5%E6%B3%95'],
        ['周易', 'https://zh.wikisource.org/wiki/%E5%91%A8%E6%98%93'], ['史記 卷63', 'https://zh.wikisource.org/wiki/%E5%8F%B2%E8%A8%98/%E5%8D%B7063'],
        ['紅樓夢', 'https://zh.wikisource.org/wiki/%E7%B4%85%E6%A8%93%E5%A4%A2'], ['Book of Five Rings', 'https://en.wikipedia.org/wiki/The_Book_of_Five_Rings']]),
      src('Paintings, prints, rubbings, and objects: public-domain works from Wikimedia Commons and the open-access (CC0) collections of the Cleveland Museum of Art and the Art Institute of Chicago. Each credit names the artist, collection, and source page.', [['Wikimedia Commons', 'https://commons.wikimedia.org/'], ['Cleveland Open Access', 'https://www.clevelandart.org/open-access'], ['Art Institute of Chicago', 'https://www.artic.edu/open-access/open-access-images']]),
      src('Brushwork: stroke data from Make Me a Hanzi, derived from Arphic PL KaitiM (Arphic Public License).', [['Make Me a Hanzi', 'https://github.com/skishore/makemeahanzi']]),
      src('Pronunciation: Mandarin syllable recordings by Chen Wang, from the audio-cmn collection (CC BY-SA), played from this site; readings with no recording use your device’s own Chinese voice.', [['audio-cmn', 'https://github.com/hugolpz/audio-cmn'], ['CC BY-SA', 'https://creativecommons.org/licenses/by-sa/4.0/']]),
      src('Rare characters that phones have no font for are drawn from GlyphWiki outlines (free to use).', [['GlyphWiki', 'https://glyphwiki.org/']]),
      src('Search: a trimmed copy of the Model2Vec potion-retrieval-32M static embedding model by MinishLab (MIT License), distilled from BAAI’s bge-base-en-v1.5 (MIT License). It runs entirely in your browser; nothing you type is sent anywhere.', [['potion-retrieval-32M', 'https://huggingface.co/minishlab/potion-retrieval-32M'], ['Model2Vec', 'https://github.com/MinishLab/model2vec'], ['MIT License', 'https://opensource.org/license/mit']]),
      src('Fonts: EB Garamond, Noto Serif TC, LXGW WenKai TC — SIL Open Font License.', [['EB Garamond', 'https://fonts.google.com/specimen/EB+Garamond'], ['Noto Serif TC', 'https://fonts.google.com/noto/specimen/Noto+Serif+TC'], ['LXGW WenKai TC', 'https://github.com/lxgw/LxgwWenkaiTC'], ['OFL', 'https://openfontlicense.org/']]),
      src('Inspiration: R. L. Wing, The Tao of Power (Doubleday, 1986), which used the same 64-stick method. Its text is not reproduced here.', [['Open Library', 'https://openlibrary.org/works/OL8050823W']]),
    ),

    wingIntro ? h('div', {}, h('h3', { text: 'R. L. Wing’s Tao of Power' }),
      h('button', { class: 'story-btn wing-btn', type: 'button', onclick: () => openWingNote(wingIntro, wing.book) },
        h('span', { class: 'kind', text: 'About the book that inspired this page' }), h('span', { text: wingIntro.title }))) : null,

    h('h3', { text: 'Glossary' }),
    h('p', { class: 'muted small', text: 'Names and terms used in the notes. Tap one for more.' }),
    h('ul', { class: 'glossary-list' }, Object.entries(gl).sort((a, b) => a[1].term.localeCompare(b[1].term)).map(([k, e]) =>
      h('li', {}, h('button', { class: 'gloss', type: 'button', onclick: () => openGlossary(k) }, e.term), e.zh ? h('span', { lang: 'zh-Hant', class: 'muted', text: ` ${e.zh}` }) : null, ` — ${e.short}`))),

    h('h3', { text: 'Your journal lives in this browser' }),
    h('p', { text: 'Entries are stored on this device, in this browser. Unless you turn on sync, nothing is sent anywhere. Browsers can delete site data: Brave Shields with “forget me when I close this site,” clearing site data, Safari’s 7-day rule for sites you do not visit, or removing a home-screen app. Export from the Journal page now and then, and after anything you would hate to lose. Import merges files, so old and new backups can be combined.' }),
    h('h3', { text: 'Sync with a passkey (optional)' }),
    h('p', { text: 'On the Journal page you can turn on sync with a passkey: no email, no password. Then your phone and computer share one journal, including the draw history. When sync is on, your journal is stored on our server so your other devices can get it. It is not end-to-end encrypted. “Delete synced copy” removes it; database backups expire within 30 days. Export still works and keeps a copy that does not depend on the server.' }),
    h('h3', { text: 'What this site counts' }),
    h('p', { text: 'To learn which parts of the site people use, the site counts page visits and a few actions (a draw, a search, a tap on a character or a note), with a random ID kept in your browser and the route you came from. It does not record your journal, the words you search for, your IP address, or anything that names you. If your browser sends “Do Not Track” or Global Privacy Control, nothing is counted. Cloudflare Web Analytics also counts page loads, without cookies.' }),
    h('p', { class: 'muted small', text: 'Tip: add this page to your home screen. It then works offline.' }),
  ));
}

const para = (t) => h('p', { text: t });
const NAME = [['道', 'dào', 'way'], ['德', 'dé', 'power, virtue'], ['經', 'jīng', 'warp; classic']];
/** Move "More" buttons out of each paragraph into a row of their own below it. */
function liftMore(root) {
  for (const p of [...root.querySelectorAll('p')]) {
    const btns = [...p.querySelectorAll(':scope > .more-link')];
    if (!btns.length) continue;
    const row = h('p', { class: 'more-row' }, btns);
    p.after(row);
    p.lastChild && p.lastChild.nodeType === 3 && (p.lastChild.textContent = p.lastChild.textContent.replace(/\s+$/, ''));
  }
  return root;
}
/** A small "More" link that opens a glossary pop-up. */
const more = (key, label = 'More') => h('button', { class: 'more-link', type: 'button', onclick: () => openGlossary(key) }, label === 'More' ? 'More ›' : `${label} ›`);
const zh = (t) => h('span', { lang: 'zh-Hant', text: t });

function history(map) {
  return liftMore(h('div', { class: 'history' },
    h('h2', { text: 'The name' }),
    h('p', {}, 'The title has three characters. Tap one to see how it is built.'),
    h('div', { class: 'name-chars' }, NAME.map(([c, py, en]) => h('button', {
      class: 'name-char', type: 'button', 'aria-label': `${c} ${py}, ${en}: open the character`, onclick: () => openChar(c),
    }, h('span', { class: 'nc-han', lang: 'zh-Hant', text: c }), h('span', { class: 'nc-py', text: py }), h('span', { class: 'nc-en', text: en })))),
    h('p', {}, h('b', {}, zh('道'), ' dào'), ' is a road, a way. It is also the verb “to speak”, and “to lead”. The character joins a foot walking along a road (', zh('辶'), ') with a head (', zh('首'), '). The book opens with a play on the word: ', zh('道可道'), ', “a way that can be spoken” (or walked). This site leaves it as “Dao”, because every English word for it brings its own frame. ', more('dao')),
    h('p', {}, h('b', {}, zh('德'), ' dé'), ' is the power a thing has when it is true to its way: the pull of a good teacher, the healing in a herb. Old English used “virtue” in this sense. The character is commonly explained as a step (', zh('彳'), ') with a straight heart (', zh('直'), ' over ', zh('心'), '), and it sounds like ', zh('得'), ', “to get”. ', more('de')),
    h('p', {}, h('b', {}, zh('經'), ' jīng'), ' is the warp, the threads that are strung first on a loom and stay fixed while the weft passes through. From that it came to mean a constant, and then a classic: a book that the rest of life is woven through. ', more('jing')),

    h('h3', { text: 'The Dao part and the De part' }),
    h('p', {}, 'The book has two parts, named after their first lines. The Dao part, ', zh('道經'), ' (chapters 1–37), opens ', zh('道可道'), '. The De part, ', zh('德經'), ' (chapters 38–81), opens ', zh('上德不德'), ', “the highest de is not de”. So the title simply names the two parts and calls them a classic: “The Classic of the Way and its Power”. In the oldest complete copies, the silk manuscripts from Mawangdui, the De part comes first. ', more('daojing', 'Dao part'), ' ', more('dejing', 'De part'), ' ', more('mawangdui', 'Mawangdui')),
    figure('laozi-ox-zhanglu', 'Laozi Riding an Ox, by Zhang Lu (Ming dynasty, early 1500s): the “Old Master” of the book’s first title.'),
    h('p', {}, 'For its first centuries the book had no grand title. People called it the Laozi, “the Old Master”, after its supposed author: ', zh('老'), ' is old, and ', zh('子'), ', a child, is also a title of respect for a teacher. The title with ', zh('經'), ' is traditionally traced to the Han dynasty (206 BCE–220 CE), when the court began to treat the book as a classic. ', more('laozi', 'Laozi')),
    h('p', {}, '“Tao Te Ching” and “Daodejing” are one name in two spellings. “Tao Te Ching” is the older Wade–Giles spelling, in which T stands for a sound close to English d. “Daodejing” is pinyin, the spelling China adopted in 1958. The notes on this site use pinyin. ', more('daodejing', 'Daodejing')),
    h('p', {}, 'You will meet other spellings too. For ', zh('老子'), ': Lao Tzu, Lao-tse, Laotse, Lao Tse, Lao Tsu. For ', zh('道德經'), ': Tâo Teh King (Legge’s 1891 title), Tao Te King (common in German and many French books), Tao-tö king (also French), Dao De Jing. They come from different ways of writing Chinese sounds in the Latin alphabet, and from different languages’ habits. All of them name the same figure and the same book.'),

    h('h2', { text: 'The text' }),
    para('The book is about 5,000 Chinese characters in 81 short chapters.'),
    para('It is written in a compressed, often rhymed, often paradoxical style. Many lines have no stated subject and no tense. That openness is one reason why there are hundreds of translations, and why they differ so widely.'),

    h('h3', { text: 'Who wrote it?' }),
    figure('confucius-laozi-rubbing', 'Confucius (left) meets Laozi: a rubbing from a Han dynasty stone relief, carved about 1,800 years ago.'),
    h('p', {}, 'Nobody knows. The oldest surviving biography is by the historian Sima Qian, in his Records of the Grand Historian (', zh('史記'), ', about 94 BCE). He says Laozi was Li Er, also called Dan, a man from the state of Chu who kept the archives at the Zhou royal court. Confucius is said to have visited him to ask about ritual, and to have come away comparing him to a dragon. When Laozi saw the Zhou kingdom decline, he left. At the pass (later tradition puts it on the western frontier), the keeper of the pass, Yin Xi, asked him to write down his teaching. Laozi wrote a book in two parts, “more than five thousand words” about the Way and its power, and then left. “No one knows where he ended,” Sima Qian writes.', ' ', more('simaqian', 'Sima Qian'), ' ', more('shiji', 'The Shiji')),
    figure('yinxi-woodblock', 'Yin Xi, the keeper of the pass who asked Laozi to write. A Ming woodblock print.'),
    para('Sima Qian himself was not sure. In the same chapter he names two other men who might be Laozi: Lao Laizi, a man from Chu who wrote a book on the uses of the Way, and the Grand Historian Dan (儋, a different character from Li Er’s 聃), who met a Qin ruler 129 years after Confucius died. On who Laozi really was, he concludes: “The world does not know if this is so.” He also reports that Laozi lived more than 160 years, “some say more than 200”. Later legend added the ox that Laozi rides through the pass and a birth after many decades in the womb.'),
    h('h4', { id: 's-ox', text: 'Why is Laozi on an ox?' }),
    h('p', {}, 'Sima Qian says nothing about an ox. The ox comes from later legend. A passage often quoted from the Han dynasty ', h('i', { text: 'Biographies of Immortals' }), ' (', zh('列仙傳'), ', credited to Liu Xiang) says that the keeper of the pass saw a purple vapour drifting over it from the east, and then Laozi came through riding a ', zh('青牛'), ', a dark ox. The purple vapour gave Chinese a saying still used for good fortune arriving: ', zh('紫氣東來'), ', “purple vapour comes from the east”. Painters made the ox a water buffalo, the slow animal of the rice fields.'),
    para('Why an ox and not a horse? The legend does not say, but readers have long found it fitting. A horse is for war and speed; passage 46 sets the war horse against the horse that works the fields. An ox is slow, strong, patient, and low to the ground, the plainest way to travel. The sage leaves the world on the humblest mount there is. Much later, Chan Buddhists drew a series of “ox-herding” pictures in which the ox stands for one’s own mind; some of those paintings are in this app.'),
    para('Most scholars now think that the text is not the work of one hand at one time. It looks like a collection of sayings, some perhaps old proverbs or verses for memorizing, that were gathered, arranged, and edited over generations. “Laozi” (“the Old Master”) may have been a real archivist, a name given to a school of thought, or both.'),

    map ? mapSection(map) : null,

    h('h3', { text: 'What the tombs showed' }),
    para('Three finds changed what we know. The two known tombs are the square marks on the map above.'),
    para('In 1973, at Mawangdui in Hunan, archaeologists opened a tomb sealed in 168 BCE. It held two copies of the Laozi on silk. Both are nearly complete. Both put the De part first and the Dao part second.'),
    para('In 1993, at Guodian in Hubei, a tomb from about 300 BCE gave up bundles of bamboo strips. They hold about two-fifths of the text, in a different order, alongside other writings. The Guodian strips show that much of the material existed by the late 4th century BCE, but perhaps not yet as one fixed book. A Han dynasty bamboo copy adds a third early witness. Peking University acquired it in 2009 from the antiquities market, so, unlike the other two, its tomb is not known.'),
    figure('bamboo-slips', 'Bamboo slips from a Chu tomb of the same age as Guodian. Texts were written in a column down each strip, and the strips were tied into a roll.'),
    para('This site reads the received text that Wang Bi used in the 3rd century CE. Where the early manuscripts differ in a way that matters, a “Variant reading” note says so.'),

    timeline(),
    para('Why has it lasted? It is short. It is open enough that each age can find itself in it. And it says something that each age seems to need: that softness can outlast force, that less can be more, and that every extreme turns back toward its opposite.'),
  ));
}

function useToday() {
  return h('div', { class: 'history' },
    h('h2', { text: 'Using it today' }),
    para('The text is not a rulebook. It works more like a mirror, or a stone that you turn over in your hand. Some ways that people read it:'),
    h('ul', {},
      h('li', { text: 'Read one passage slowly, then read it again aloud. Many of them were made to be heard.' }),
      h('li', { text: 'Stay with one passage for a day or a week. Notice where it shows up in your life.' }),
      h('li', { text: 'Watch for the pairs: being and non-being, hard and soft, full and empty. The text often favors the soft, the low, and the still, but as a correction to a world that prizes the other side. Each side makes the other, and each turns into the other.' }),
      h('li', { text: 'Compare translations. Where they disagree, the Chinese is usually open, and the open place is often the point.' }),
      h('li', { text: 'Write. What you think the passage says, where you agree, where you resist, and what that resistance shows you.' })),
    h('h3', { text: 'How to use this tool' }),
    h('ol', { class: 'steps' },
      h('li', {}, h('b', { text: 'Draw or browse. ' }), 'The Draw page lets chance choose a passage, with the 64-stick method described below. Browse lets you choose one yourself.'),
      h('li', {}, h('b', { text: 'Read. ' }), 'Each passage has a new English rendering. Tap an underlined phrase for a note on the Chinese: what the characters picture, where English must choose, the history, the paired opposites. Tap any Chinese character for its dictionary entry and ancient forms.'),
      h('li', {}, h('b', { text: 'Look around it. ' }), 'Below the rendering: reflections through different lenses, paintings and stories, echoes in other classics, and a character to sit with, written by brush.'),
      h('li', {}, h('b', { text: 'Sit with it. ' }), 'Each passage ends with questions. Each one takes a claim from the passage and asks you to test it against your own life: whether you agree, where your view comes from, and what happens when you hold the opposite view for a while.'),
      h('li', {}, h('b', { text: 'Write. ' }), 'Tap “Write about this” on a question, or just write. Your notes collect on the Journal page. They stay in this browser; export them now and then.'),
      h('li', {}, h('b', { text: 'Search and wander. ' }), h('a', { href: '#/search', text: 'Search' }), ' finds passages, notes, stories, and art by idea, not only by word: try “letting go” or “grief”. Or browse every ', h('a', { href: '#/art', text: 'painting and object' }), ' and every ', h('a', { href: '#/stories', text: 'story' }), ', and the songs, films, books, and shows that echo each passage ', h('a', { href: '#/culture', text: 'in our time' }), '.')),
  );
}

let ART = { catalog: {}, passages: {} };

function artUse(id) {
  const used = Object.entries(ART.passages || {}).flatMap(([n, l]) => l.filter((e) => e.id === id).map((e) => [Number(n), e]));
  return { a: ART.catalog?.[id], used };
}

/** A public-domain picture from the app's art catalog; tap to look closer. */
function figure(id, caption) {
  const { a, used } = artUse(id);
  if (!a) return null;
  return h('figure', { class: 'about-fig' },
    h('button', { class: 'art-btn', type: 'button', 'aria-label': `Look closer: ${a.title}`,
      onclick: () => openArt(a, used[0]?.[1] || {}, {}, { passages: used.map(([n]) => n) }) },
    h('img', { src: a.file, alt: a.alt || a.title, width: a.w, height: a.h, loading: 'lazy', decoding: 'async' })),
    h('figcaption', { class: 'muted small', text: caption }));
}
function figures(...pairs) {
  return h('div', { class: 'about-figs' }, pairs.map(([id, cap]) => figure(id, cap)));
}

// Places, by longitude and latitude. Coordinates of modern towns; old sites are approximate.
const PLACES = [
  [112.45, 34.62, 'Luoyang', 'Eastern Zhou royal capital, where Laozi is said to have kept the archives', 'right'],
  [110.92, 34.63, 'Hangu Pass', 'one traditional site of the pass where Laozi wrote the book', 'above'],
  [115.48, 33.86, 'Luyi', 'old Ku county in Chu: Laozi’s birthplace in the Shiji', 'right'],
  [116.99, 35.58, 'Qufu', 'home of Confucius, in the state of Lu', 'right'],
  [108.94, 34.34, 'Xi’an', 'Chang’an, capital of the Western Han and the Tang. Just east lie the First Emperor’s tomb and his Terracotta Army', 'below'],
  [112.18, 30.52, 'Guodian tomb', 'bamboo slips with about two-fifths of the text, buried about 300 BCE, found 1993 (Shayang, near ancient Jinancheng)', 'left', 'tomb'],
  [113.03, 28.20, 'Mawangdui tomb', 'two silk copies of the whole text, tomb sealed 168 BCE, opened 1973 (Changsha)', 'right', 'tomb'],
  [116.40, 39.90, 'Beijing', 'today’s capital, for reference', 'right'],
];
const RIVER_LABELS = [['Yellow River', 108.6, 40.9], ['Yangtze', 117.3, 29.6], ['Han River', 109.4, 32.3]];

function mapSection(m) {
  const k = Math.cos(m.lat0 * Math.PI / 180);
  const [W0, , , N0] = m.window;
  const xy = (lon, lat) => [(lon - W0) * k * m.scale, (N0 - lat) * m.scale];
  const svg = svgEl('svg', { class: 'about-map', viewBox: `0 0 ${m.width} ${m.height}`, role: 'group',
    'aria-label': 'Map of the Yellow River and Yangtze region. Each place is a button.' },
  svgEl('rect', { x: 0, y: 0, width: m.width, height: m.height, class: 'map-sea' }),
  svgEl('path', { d: m.land, class: 'map-land' }),
  ...m.rivers.map((r) => svgEl('path', { d: r.d, class: 'map-river' })),
  ...RIVER_LABELS.map(([t, lon, lat]) => { const [x, y] = xy(lon, lat); return svgEl('text', { x, y, class: 'map-river-label' }, t); }),
  ...PLACES.map(([lon, lat, name, what, side, type], i) => {
    const [x, y] = xy(lon, lat);
    return svgEl('g', { class: `map-pt${type === 'tomb' ? ' tomb' : ''}`, 'data-i': i, role: 'button', tabindex: 0, 'aria-label': `${name}: ${what}` },
      svgEl('circle', { cx: x, cy: y, r: 26, class: 'map-hit' }),
      type === 'tomb'
        ? svgEl('rect', { x: x - 8, y: y - 8, width: 16, height: 16, rx: 2, class: 'map-dot' })
        : svgEl('circle', { cx: x, cy: y, r: 7, class: 'map-dot' }),
      svgEl('text', {
        x: side === 'left' ? x - 12 : side === 'right' ? x + 12 : x,
        y: side === 'above' ? y - 16 : side === 'below' ? y + 32 : y + 8,
        class: 'map-label', 'text-anchor': side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle',
      }, name));
  }));
  const key = h('ul', { class: 'map-key' }, PLACES.map(([, , name, what, , type], i) => h('li', {},
    h('button', { class: 'map-key-btn', type: 'button', 'data-i': i },
      h('span', { class: `key-sym${type === 'tomb' ? ' tomb' : ''}`, 'aria-hidden': 'true' }), h('b', { text: `${name}: ` }), what))));
  // Tap a place on the map or in the list: both light up.
  let on = -1;
  const select = (i, from) => {
    on = on === i ? -1 : i;
    svg.querySelectorAll('.map-pt').forEach((g) => g.classList.toggle('on', Number(g.dataset.i) === on));
    key.querySelectorAll('.map-key-btn').forEach((b) => {
      const hit = Number(b.dataset.i) === on;
      b.classList.toggle('on', hit);
      b.setAttribute('aria-pressed', String(hit));
    });
    if (on < 0) return;
    const target = from === 'map' ? key.querySelector(`.map-key-btn[data-i="${on}"]`) : svg;
    const r = target.getBoundingClientRect();
    if (r.top < 60 || r.bottom > innerHeight) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  };
  svg.addEventListener('click', (e) => { const g = e.target.closest('.map-pt'); if (g) select(Number(g.dataset.i), 'map'); });
  svg.addEventListener('keydown', (e) => { const g = e.target.closest('.map-pt'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(Number(g.dataset.i), 'map'); } });
  key.addEventListener('click', (e) => { const b = e.target.closest('.map-key-btn'); if (b) select(Number(b.dataset.i), 'list'); });
  return h('section', { class: 'about-map-wrap' },
    h('h3', { text: 'Where it happened' }),
    h('div', { class: 'map-box' }, svg),
    h('p', { class: 'muted small map-legend' }, h('span', { class: 'key-sym', 'aria-hidden': 'true' }), 'places in the story  ',
      h('span', { class: 'key-sym tomb', 'aria-hidden': 'true' }), 'tombs where the oldest copies were found. Tap a place on the map or in the list.'),
    key,
    h('p', { class: 'muted small', text: 'Coastline and rivers from Natural Earth (public domain). Modern coastline; the coast and the river courses have moved over the centuries, and no borders are drawn because they changed so often.' }));
}

// Peak areas: rough estimates in million km² (Taagepera); other estimates differ widely.
const DYNASTIES = [
  ['Shang', 'c. 1600–1046 BCE', null, ['fangyou-wine-vessel', 'shang-ding'], 'Bronze ritual vessels, and the oldest Chinese writing, on oracle bones.'],
  ['Zhou', '1046–256 BCE', null, ['bell-zhong', 'inlaid-hu-jar'], 'Kings ruled by the “Mandate of Heaven”. After 771 BCE their power faded: the Spring and Autumn period, then the Warring States (475–221 BCE). The Daodejing took shape in this age.'],
  ['Qin', '221–206 BCE', null, ['terracotta-pit1', 'terracotta-embedded'], 'The First Emperor, Qin Shi Huang, joined the states into one empire and took the new title 皇帝, “emperor”. One script, one coinage, one law. Near Xi’an he built a vast tomb, guarded by an army of some 8,000 life-size clay soldiers that farmers digging a well found in 1974.'],
  ['Han', '206 BCE–220 CE', 6.5, ['han-chariot', 'mirror-daoist-deities', 'confucius-laozi-rubbing'], 'The Laozi became a classic; the Mawangdui tomb was sealed in 168 BCE; Laozi became a god.'],
  ['Division', '220–589', null, ['xiwangmu-mirror'], 'Three Kingdoms, Jin, and the Northern and Southern dynasties. Wang Bi wrote his commentary; Buddhism spread.'],
  ['Sui', '581–618', null, ['sui-guanyin'], 'Reunified the country and dug the Grand Canal.'],
  ['Tang', '618–907', 5.4, ['han-gan-white', 'star-chart'], 'The ruling Li family claimed Laozi as its ancestor; the text was set for the state exams.'],
  ['Song', '960–1279', 3.1, ['fan-kuan-travelers', 'ma-yuan-waterfall'], 'Reunified most of China after the Five Dynasties (907–960). Printing spread; the great landscape painters, many of them in this app.'],
  ['Yuan', '1271–1368', 11.0, ['huang-gongwang', 'zhao-mengfu-river-village'], 'Mongol rule under Khubilai Khan and his heirs.'],
  ['Ming', '1368–1644', 6.5, ['qiu-ying-peach', 'laozi-ox-chen'], 'Its founder, Zhu Yuanzhang, wrote a commentary on the Laozi.'],
  ['Qing', '1644–1912', 14.7, ['bada-fish', 'kuncan-valley'], 'Manchu rule; China’s largest empire. Jesuits and then Protestant missionaries carried the text to Europe.'],
  ['Republic', '1912–1949 (mainland)', null, [], 'The last emperor, Puyi, gave up the throne in 1912. After 1949 the Republic continued on Taiwan.'],
  ['People’s Republic', '1949–', 9.6, ['bamboo-slips'], 'Today’s area, for comparison. The Guodian and Mawangdui finds came in this era.'],
];

// Width via the CSSOM: the CSP forbids inline style attributes, not script-set styles.
function fillBar(frac) {
  const el = h('span', { class: 'dyn-fill' });
  el.style.width = `${Math.max(2, Math.round(frac * 100))}%`;
  return el;
}

const BOOK = {
  "Zhou": [["Warring States (5th–3rd c. BCE)", 'An age of states at war. The text spoke to rulers and to people who wanted to stay whole in dangerous times. The oldest surviving commentary, on selected passages, is kept in the Han Feizi, a book credited to the philosopher Han Fei. It reads the text as advice on how to rule, and parts of it as advice on care of the self.']],
  "Han": [["Early Han court (2nd c. BCE)", 'After the wars, early Han rulers, above all Emperors Wen and Jing, followed “Huang-Lao” thought, named for the Yellow Emperor and Laozi: light taxes, few laws, and a ruler who did not interfere. Sima Qian says the Empress Dowager Dou made the emperor, the crown prince, and her own clan read the Yellow Emperor and the Laozi.'], ["Body and breath (Eastern Han)", 'The Heshang Gong commentary, credited to a legendary “Old Man by the River”, read the text on two levels: how to govern a state and how to nourish the body for a long life. Those two levels run through much of later Daoist practice.'], ["A god and a scripture (2nd c. CE)", 'Laozi became a god. In the 160s CE the emperor himself made sacrifices to him. The Celestial Masters, the first organized Daoist religion, recited the text as scripture.']],
  "Division": [["Philosophy (3rd c. CE)", 'Wang Bi (226–249) died at 23. He wrote the commentary that made the text a work of philosophy about being and non-being. The received text handed down with his commentary is the one most people read, and the one on this site. Scholars note that later copyists brought it closer to other editions, so in places it differs from the text that Wang Bi himself comments on.'], ["Buddhism", 'When Buddhism came to China, translators borrowed Daoist words, even 道 itself, to explain Indian ideas. A story arose that Laozi went west and taught the barbarians, or even became the Buddha. Later Daoists turned it into a weapon against Buddhism. Chan (Zen) Buddhism took in much of the Laozi’s spirit.']],
  "Tang": [["Tang dynasty (618–907)", 'The ruling Li family claimed Laozi, Li Er, as their ancestor. Emperor Xuanzong wrote his own commentary and ordered every household to keep a copy. The text was set for the state examinations. Tang sources report that the monk Xuanzang was ordered to translate it into Sanskrit for an Indian king; that version does not survive.']],
  "Ming": [["Later China, Korea, Japan", 'Scholars, poets, painters, and martial artists returned to it again and again. The Ming founder, Zhu Yuanzhang, who rose from poverty to rule all China, wrote a commentary on it.']],
  "Qing": [["Europe (18th–19th c.)", 'Jesuit missionaries searched it for traces of Christian truth. In 1823 the French scholar Abel-Rémusat suggested that three sounds in passage 14 spelled the name of the biblical God. Stanislas Julien published a full French translation in 1842. James Legge, a Scottish missionary who became Oxford’s first professor of Chinese, published his English version in 1891. It is included on this site for comparison.']],
  "Republic": [["Late 19th and 20th centuries", 'In the 1890s Tolstoy read it closely and helped with a Russian version. Bertolt Brecht wrote a poem about the customs officer at the pass. Martin Heidegger worked on a German translation with the Chinese scholar Paul Shih-yi Hsiao in 1946. It became one of the most translated books in the world.']],
  "People’s Republic": [["Today", 'People read it for meditation, for tai chi and other martial arts, for leadership and management, for psychology and therapy, and for ecology, as a voice for living with nature and not against it. Some uses are deep. Some flatten it into slogans.']],
};

/** Pictures from the era; tap one to look closer. */
function eraArt(ids) {
  const list = (ids || []).map((id) => [id, artUse(id)]).filter(([, u]) => u.a);
  if (!list.length) return null;
  return h('div', { class: 'era-art' }, list.map(([, { a, used }]) => h('button', {
    class: 'era-pic', type: 'button', 'aria-label': `Look closer: ${a.title}`,
    onclick: () => openArt(a, used[0]?.[1] || {}, {}, { passages: used.map(([n]) => n) }),
  }, h('img', { src: a.file.replace(/^art\//, 'art/thumbs/'), alt: a.alt || a.title, loading: 'lazy', decoding: 'async' }))));
}

/** One timeline: China's eras, and what the book was in each. A slider moves through it. */
function timeline() {
  const max = 15;
  const eras = DYNASTIES.map(([name, dates, area, arts, note], i) => h('li', { class: 'era', 'data-i': i },
    h('div', { class: 'dyn-head' }, h('b', { text: name }), h('span', { class: 'muted small', text: dates })),
    eraArt(arts),
    area ? h('div', { class: 'dyn-bar', role: 'img', 'aria-label': `Peak area about ${area} million square kilometres` },
      fillBar(area / max), h('span', { class: 'dyn-val small', text: `≈ ${area} million km²` })) : null,
    h('p', { class: 'dyn-note', text: note }),
    BOOK[name] ? h('div', { class: 'era-book' }, h('p', { class: 'era-book-h', text: 'The book in this age' }),
      h('ul', {}, BOOK[name].map(([label, text]) => h('li', {}, h('b', { text: `${label}. ` }), text)))) : null));
  const label = h('span', { class: 'era-label', 'aria-hidden': 'true' });
  const slider = h('input', { type: 'range', min: 0, max: DYNASTIES.length - 1, step: 1, value: 0, 'aria-label': 'Move through the eras' });
  const bar = h('div', { class: 'era-slider' }, label, slider);
  const show = (i) => {
    const [name, dates] = DYNASTIES[i];
    label.textContent = `${name} · ${dates}`;
    slider.value = String(i);
    slider.setAttribute('aria-valuetext', `${name}, ${dates}`);
    eras.forEach((e, k) => e.classList.toggle('now', k === i));
  };
  let dragging = 0;
  slider.addEventListener('input', () => {
    dragging = Date.now();
    const i = Number(slider.value);
    show(i);
    const offset = (document.querySelector('.bar')?.offsetHeight || 0) + bar.offsetHeight + 10;
    window.scrollTo({ top: eras[i].getBoundingClientRect().top + scrollY - offset, behavior: 'auto' });
  });
  // As the reader scrolls, the slider follows the era near the top of the screen.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((ents) => {
      if (Date.now() - dragging < 400) return;
      const vis = ents.filter((e) => e.isIntersecting).map((e) => Number(e.target.dataset.i));
      if (vis.length) show(Math.min(...vis));
    }, { rootMargin: '-30% 0px -60% 0px' });
    eras.forEach((e) => io.observe(e));
  }
  show(0);
  return h('section', { class: 'dynasties' },
    h('h3', { text: 'A timeline: China, and the book in it' }),
    h('p', {}, 'From 221 BCE until imperial rule ended in 1912, China was ruled by emperors. A dynasty held power while it kept the “Mandate of Heaven”; floods, famine, and revolt were read as signs that heaven had withdrawn it. Borders grew and shrank with each dynasty, and for long periods several states shared the land. The Daodejing took shape in a time of division, and every age after read it in its own way. Drag the slider to move through the ages.'),
    bar, h('ol', { class: 'dyn-list' }, eras),
    h('p', { class: 'muted small', text: 'Bars: peak area, rough estimates (after the political scientist Rein Taagepera); other estimates differ widely, because borders were often claimed more than held. Today’s China is about 9.6 million km².' }));
}
