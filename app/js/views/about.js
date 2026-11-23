// How the draw works, sources, licenses, and where your data lives.
import { h, tetragram } from '../ui.js';
import { getGlossary } from '../data.js';
import { openGlossary } from '../notes.js';
import { howSection } from './how.js';

export async function aboutView() {
  const gl = await getGlossary();
  const li = (...c) => h('li', {}, ...c);
  return h('section', { class: 'about' },
    h('h1', { text: 'About' }),
    h('p', { text: 'The Daodejing (道德經) is about 5,000 characters long and was put together in China during the Warring States period, around the 4th century BCE. Tradition names its author Laozi, “the Old Master.” This page offers a way to meet it one passage at a time: by chance, slowly, with room to write.' }),

    howSection(),

    h('h3', { text: 'The texts' }),
    h('ul', {},
      li('Chinese: the received text with Wang Bi’s commentary (王弼, 226–249 CE), from Wikisource. Public domain.'),
      li('James Legge, “The Tâo Teh King,” Sacred Books of the East vol. 39 (1891), from Wikisource. Public domain.'),
      li('The English renderings, titles, reflections, and notes are new, written for this page from the Chinese.'),
      li('Character data: Unicode Unihan database (© Unicode, Inc., used under the Unicode License). Shuowen Jiezi (說文解字, Xu Shen, c. 100 CE). Facts paraphrased from Wiktionary (CC BY-SA) are credited in the notes.'),
      li('Fonts: EB Garamond, Noto Serif TC, LXGW WenKai TC — SIL Open Font License.'),
      li('Brushwork: stroke data from Make Me a Hanzi, derived from Arphic PL KaitiM (Arphic Public License).'),
      li('Paintings, prints, and rubbings: public-domain works from Wikimedia Commons; each credit names the artist, collection, and source. The stories are new retellings of ancient texts (Zhuangzi, Sima Qian’s Shiji, and others).'),
      li('Variant readings: the Mawangdui silk manuscripts (2nd c. BCE), collated text from Wikisource.'),
    ),
    h('p', { class: 'muted small', text: 'Made in the spirit of R. L. Wing’s The Tao of Power (1986), which used the same 64-stick method and taught that a chance meeting with a passage can be the right one.' }),

    h('h3', { text: 'Glossary' }),
    h('p', { class: 'muted small', text: 'Names and terms used in the notes. Tap one for more.' }),
    h('ul', { class: 'glossary-list' }, Object.entries(gl).sort((a, b) => a[1].term.localeCompare(b[1].term)).map(([k, e]) =>
      h('li', {}, h('button', { class: 'gloss', type: 'button', onclick: () => openGlossary(k) }, e.term), e.zh ? h('span', { lang: 'zh-Hant', class: 'muted', text: ` ${e.zh}` }) : null, ` — ${e.short}`))),

    h('h3', { text: 'Your journal lives in this browser' }),
    h('p', { text: 'Entries are stored only on this device, in this browser. Nothing is sent anywhere. Browsers can delete site data: Brave Shields with “forget me when I close this site,” clearing site data, Safari’s 7-day rule for sites you do not visit, or removing a home-screen app. Export from the Journal page now and then, and after anything you would hate to lose. Import merges files, so old and new backups can be combined.' }),
    h('p', { class: 'muted small', text: 'Tip: add this page to your home screen. It then works offline.' }),
  );
}
