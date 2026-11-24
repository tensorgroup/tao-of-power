// How the draw works, sources, licenses, and where your data lives.
import { h, tetragram } from '../ui.js';
import { getGlossary } from '../data.js';
import { openGlossary, openChar } from '../notes.js';
import { howSection } from './how.js';
import { getWing } from '../data.js';
import { openWingNote } from './passage.js';

function src(text, links = []) {
  return h('li', {}, text, links.length ? h('span', { class: 'src-links' }, ...links.map(([label, href]) =>
    h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: label }))) : null);
}

export async function aboutView() {
  const [gl, wing] = await Promise.all([getGlossary(), getWing()]);
  const wingIntro = (wing.passages?.['0'] || [])[0];
  const li = (...c) => h('li', {}, ...c);
  return h('section', { class: 'about' },
    h('h1', { text: 'About' }),
    h('p', { class: 'lead', text: 'This is an interactive tool for exploring the Tao Te Ching. It offers a way to meet the text one passage at a time: by chance, slowly, with room to write. Below: where the text came from, who has used it and why, and how you might use it, and this tool, today.' }),

    history(),
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
    h('p', { text: 'Entries are stored only on this device, in this browser. Nothing is sent anywhere. Browsers can delete site data: Brave Shields with “forget me when I close this site,” clearing site data, Safari’s 7-day rule for sites you do not visit, or removing a home-screen app. Export from the Journal page now and then, and after anything you would hate to lose. Import merges files, so old and new backups can be combined.' }),
    h('p', { class: 'muted small', text: 'Tip: add this page to your home screen. It then works offline.' }),
  );
}

const para = (t) => h('p', { text: t });
const NAME = [['道', 'dào', 'way'], ['德', 'dé', 'power, virtue'], ['經', 'jīng', 'warp; classic']];
/** A small "More" link that opens a glossary pop-up. */
const more = (key, label = 'More') => h('button', { class: 'more-link', type: 'button', onclick: () => openGlossary(key) }, label === 'More' ? 'More ›' : `${label} ›`);
const zh = (t) => h('span', { lang: 'zh-Hant', text: t });

function history() {
  return h('div', { class: 'history' },
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
    h('p', {}, 'For its first centuries the book had no grand title. People called it the Laozi, “the Old Master”, after its supposed author: ', zh('老'), ' is old, and ', zh('子'), ', a child, is also a title of respect for a teacher. The title with ', zh('經'), ' is traditionally traced to the Han dynasty (206 BCE–220 CE), when the court began to treat the book as a classic. ', more('laozi', 'Laozi')),
    h('p', {}, '“Tao Te Ching” and “Daodejing” are one name in two spellings. “Tao Te Ching” is the older Wade–Giles spelling, in which T stands for a sound close to English d. “Daodejing” is pinyin, the spelling China adopted in 1958. The notes on this site use pinyin. ', more('daodejing', 'Daodejing')),

    h('h2', { text: 'The text' }),
    para('The book is about 5,000 Chinese characters in 81 short chapters.'),
    para('It is written in a compressed, often rhymed, often paradoxical style. Many lines have no stated subject and no tense. That openness is one reason why there are hundreds of translations, and why they differ so widely.'),

    h('h3', { text: 'Who wrote it?' }),
    h('p', {}, 'Nobody knows. The oldest surviving biography is by the historian Sima Qian, in his Records of the Grand Historian (', zh('史記'), ', about 94 BCE). He says Laozi was Li Er, also called Dan, a man from the state of Chu who kept the archives at the Zhou royal court. Confucius is said to have visited him to ask about ritual, and to have come away comparing him to a dragon. When Laozi saw the Zhou kingdom decline, he left. At the pass (later tradition puts it on the western frontier), the keeper of the pass, Yin Xi, asked him to write down his teaching. Laozi wrote a book in two parts, “more than five thousand words” about the Way and its power, and then left. “No one knows where he ended,” Sima Qian writes.'),
    para('Sima Qian himself was not sure. In the same chapter he names two other men who might be Laozi: Lao Laizi, a man from Chu who wrote a book on the uses of the Way, and the Grand Historian Dan (儋, a different character from Li Er’s 聃), who met a Qin ruler 129 years after Confucius died. On who Laozi really was, he concludes: “The world does not know if this is so.” He also reports that Laozi lived more than 160 years, “some say more than 200”. Later legend added the ox that Laozi rides through the pass and a birth after many decades in the womb.'),
    para('Most scholars now think that the text is not the work of one hand at one time. It looks like a collection of sayings, some perhaps old proverbs or verses for memorizing, that were gathered, arranged, and edited over generations. “Laozi” (“the Old Master”) may have been a real archivist, a name given to a school of thought, or both.'),

    h('h3', { text: 'What the tombs showed' }),
    para('Three finds changed what we know. In 1973, at Mawangdui in Hunan, archaeologists opened a tomb sealed in 168 BCE. It held two copies of the Laozi on silk. Both are nearly complete. Both put the De part first and the Dao part second.'),
    para('In 1993, at Guodian in Hubei, a tomb from about 300 BCE gave up bundles of bamboo strips. They hold about two-fifths of the text, in a different order, alongside other writings. The Guodian strips show that much of the material existed by the late 4th century BCE, but perhaps not yet as one fixed book. A Han dynasty bamboo copy adds a third early witness. Peking University acquired it in 2009 from the antiquities market, so, unlike the other two, its tomb is not known.'),
    para('This site reads the received text that Wang Bi used in the 3rd century CE. Where the early manuscripts differ in a way that matters, a “Variant reading” note says so.'),

    h('h3', { text: 'Who has used it, and how' }),
    h('ul', { class: 'timeline' },
      h('li', {}, h('b', { text: 'Warring States (5th–3rd c. BCE). ' }), 'An age of states at war. The text spoke to rulers and to people who wanted to stay whole in dangerous times. The oldest surviving commentary, on selected passages, is kept in the Han Feizi, a book credited to the philosopher Han Fei. It reads the text as advice on how to rule, and parts of it as advice on care of the self.'),
      h('li', {}, h('b', { text: 'Early Han court (2nd c. BCE). ' }), 'After the wars, early Han rulers, above all Emperors Wen and Jing, followed “Huang-Lao” thought, named for the Yellow Emperor and Laozi: light taxes, few laws, and a ruler who did not interfere. Sima Qian says the Empress Dowager Dou made the emperor, the crown prince, and her own clan read the Yellow Emperor and the Laozi.'),
      h('li', {}, h('b', { text: 'Body and breath (Eastern Han). ' }), 'The Heshang Gong commentary, credited to a legendary “Old Man by the River”, read the text on two levels: how to govern a state and how to nourish the body for a long life. Those two levels run through much of later Daoist practice.'),
      h('li', {}, h('b', { text: 'A god and a scripture (2nd c. CE). ' }), 'Laozi became a god. In the 160s CE the emperor himself made sacrifices to him. The Celestial Masters, the first organized Daoist religion, recited the text as scripture.'),
      h('li', {}, h('b', { text: 'Philosophy (3rd c. CE). ' }), 'Wang Bi (226–249) died at 23. He wrote the commentary that made the text a work of philosophy about being and non-being. The received text handed down with his commentary is the one most people read, and the one on this site. Scholars note that later copyists brought it closer to other editions, so in places it differs from the text that Wang Bi himself comments on.'),
      h('li', {}, h('b', { text: 'Buddhism. ' }), 'When Buddhism came to China, translators borrowed Daoist words, even 道 itself, to explain Indian ideas. A story arose that Laozi went west and taught the barbarians, or even became the Buddha. Later Daoists turned it into a weapon against Buddhism. Chan (Zen) Buddhism took in much of the Laozi’s spirit.'),
      h('li', {}, h('b', { text: 'Tang dynasty (618–907). ' }), 'The ruling Li family claimed Laozi, Li Er, as their ancestor. Emperor Xuanzong wrote his own commentary and ordered every household to keep a copy. The text was set for the state examinations. Tang sources report that the monk Xuanzang was ordered to translate it into Sanskrit for an Indian king; that version does not survive.'),
      h('li', {}, h('b', { text: 'Later China, Korea, Japan. ' }), 'Scholars, poets, painters, and martial artists returned to it again and again. The Ming founder, Zhu Yuanzhang, who rose from poverty to rule all China, wrote a commentary on it.'),
      h('li', {}, h('b', { text: 'Europe (18th–19th c.). ' }), 'Jesuit missionaries searched it for traces of Christian truth. In 1823 the French scholar Abel-Rémusat suggested that three sounds in chapter 14 spelled the name of the biblical God. Stanislas Julien published a full French translation in 1842. James Legge, a Scottish missionary who became Oxford’s first professor of Chinese, published his English version in 1891. It is included on this site for comparison.'),
      h('li', {}, h('b', { text: 'Late 19th and 20th centuries. ' }), 'In the 1890s Tolstoy read it closely and helped with a Russian version. Bertolt Brecht wrote a poem about the customs officer at the pass. Martin Heidegger worked on a German translation with the Chinese scholar Paul Shih-yi Hsiao in 1946. It became one of the most translated books in the world.'),
      h('li', {}, h('b', { text: 'Today. ' }), 'People read it for meditation, for tai chi and other martial arts, for leadership and management, for psychology and therapy, and for ecology, as a voice for living with nature and not against it. Some uses are deep. Some flatten it into slogans.')),
    para('Why has it lasted? It is short. It is open enough that each age can find itself in it. And it says something that each age seems to need: that softness can outlast force, that less can be more, and that every extreme turns back toward its opposite.'),
  );
}

function useToday() {
  return h('div', { class: 'history' },
    h('h2', { text: 'Using it today' }),
    para('The text is not a rulebook. It works more like a mirror, or a stone that you turn over in your hand. Some ways that people read it:'),
    h('ul', {},
      h('li', { text: 'Read one passage slowly, then read it again aloud. Many chapters were made to be heard.' }),
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
