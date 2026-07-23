export interface DailyQuote {
  text: string;
  author?: string;
}

// Shown one per day, in sequence, wrapping back to the start. Order matters.
export const DAILY_QUOTES: DailyQuote[] = [
  { text: 'Living well depends on constantly reordering your loves.' },
  { text: 'When you remove superficial metrics, you can accomplish way more.' },
  { text: 'Your life starts moving once you start owning your responsibilities.' },
  {
    text: "Erta yoki kech turadigan bo'lishingizdan qat'i nazar, tongingiz uyg'ongan lahzangizdan boshlanadi.",
  },
  {
    text: "Qachon turishingiz muhim emas, sizda doim 'oltin soat' bo'ladi. Bu soatni qanday o'tkazishingiz butun kuningizni belgilab beradi.",
  },
  { text: "Erta uyg'oning va kun tartibiga qat'iy amal qiling." },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'Well begun is half done.', author: 'Aristotle' },
  {
    text: "Miyangiz maksimal ishlashini istasangiz, uni to'xtovsiz faqat bitta vazifaga yo'naltiring.",
  },
  {
    text: "Ambitsiyali insonlar o'z maqsadlariga erishish uchun kerakli resurslarni jamlay olishadi. Ushbu 'resurslarni birlashtirish' qobiliyati ko'pchilik uchun muvaffaqiyatning asosiy omilidir.",
  },
  {
    text: "Odamlar ko'p o'ylashga moyil. Biroq voqealar mohiyatini anglash uchun eng murakkab muammolarga ham oddiy yondasha olish lozim. Idrokimiz qanchalik sodda bo'lsa, haqiqatni shunchalik tez anglaymiz.",
    author: 'Kadzuo Inamori',
  },
  {
    text: "Hamma qisqa vaqt ichida ko'p ish qilishga intiladi. Lekin ishning hajmi uning sifatiga ta'sir qilishini ko'pchilik tushunmaydi. Odamlar o'zlariga muammo yaratishni, oddiy narsalarni murakkablashtirishni yaxshi ko'rishadi. Bu esa faqat shubha va ikkilanishlarni yuzaga keltiradi. Aslida, hayotni yengillashtirish, sifatli va samarali yashash uchun ishga kamroq e'tibor qaratish kerak.",
    author: 'Tal Ben-Shahar',
  },
];

// One quote per calendar day: the index advances by exactly one each day and
// wraps around, so the whole list cycles deterministically (same day → same
// quote on every device, no storage needed).
export const getQuoteForDate = (date = new Date()): DailyQuote | null => {
  if (DAILY_QUOTES.length === 0) {
    return null;
  }

  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNumber = Math.floor(startOfDay.getTime() / 86_400_000);
  const index = ((dayNumber % DAILY_QUOTES.length) + DAILY_QUOTES.length) % DAILY_QUOTES.length;

  return DAILY_QUOTES[index];
};
