// How the draw works, sources, licenses, and where your data lives.
import { h, tetragram } from '../ui.js';
import { getGlossary } from '../data.js';
import { openGlossary } from '../notes.js';
import { howSection } from './how.js';

function src(text, links = []) {
  return h('li', {}, text, links.length ? h('span', { class: 'src-links' }, ...links.map(([label, href]) =>
    h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: label }))) : null);
}

export async function aboutView() {
  const gl = await getGlossary();
  const li = (...c) => h('li', {}, ...c);
  return h('section', { class: 'about' },
    h('h1', { text: 'About' }),
    h('p', { text: 'The Daodejing (道德經) is about 5,000 characters long and was put together in China during the Warring States period, around the 4th century BCE. Tradition names its author Laozi, “the Old Master.” This page offers a way to meet it one passage at a time: by chance, slowly, with room to write.' }),

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
      src('Paintings, prints, and rubbings: public-domain works from Wikimedia Commons; each credit names the artist, collection, and source page.', [['Wikimedia Commons', 'https://commons.wikimedia.org/']]),
      src('Brushwork: stroke data from Make Me a Hanzi, derived from Arphic PL KaitiM (Arphic Public License).', [['Make Me a Hanzi', 'https://github.com/skishore/makemeahanzi']]),
      src('Fonts: EB Garamond, Noto Serif TC, LXGW WenKai TC — SIL Open Font License.', [['EB Garamond', 'https://fonts.google.com/specimen/EB+Garamond'], ['Noto Serif TC', 'https://fonts.google.com/noto/specimen/Noto+Serif+TC'], ['LXGW WenKai TC', 'https://github.com/lxgw/LxgwWenkaiTC'], ['OFL', 'https://openfontlicense.org/']]),
      src('Inspiration: R. L. Wing, The Tao of Power (Doubleday, 1986), which used the same 64-stick method. Its text is not reproduced here.', [['Open Library', 'https://openlibrary.org/works/OL8050823W']]),
    ),

    h('h3', { text: 'Glossary' }),
    h('p', { class: 'muted small', text: 'Names and terms used in the notes. Tap one for more.' }),
    h('ul', { class: 'glossary-list' }, Object.entries(gl).sort((a, b) => a[1].term.localeCompare(b[1].term)).map(([k, e]) =>
      h('li', {}, h('button', { class: 'gloss', type: 'button', onclick: () => openGlossary(k) }, e.term), e.zh ? h('span', { lang: 'zh-Hant', class: 'muted', text: ` ${e.zh}` }) : null, ` — ${e.short}`))),

    h('h3', { text: 'Your journal lives in this browser' }),
    h('p', { text: 'Entries are stored only on this device, in this browser. Nothing is sent anywhere. Browsers can delete site data: Brave Shields with “forget me when I close this site,” clearing site data, Safari’s 7-day rule for sites you do not visit, or removing a home-screen app. Export from the Journal page now and then, and after anything you would hate to lose. Import merges files, so old and new backups can be combined.' }),
    h('p', { class: 'muted small', text: 'Tip: add this page to your home screen. It then works offline.' }),
  );
}
