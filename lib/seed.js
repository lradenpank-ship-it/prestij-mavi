'use strict';
// İlk kurulumda örnek içerik. Ürün adları, özellikler ve fiyatlar ÖRNEKTİR; yönetim panelinden değiştirilir.
const U = require('./util');

const CATS = [
  ['Araç liftleri', 'lift2'], ['Kriko ve vinçler', 'kriko'], ['Kompresör ve havalı ekipman', 'hortum'], ['Takım arabaları', 'takim'],
  ['El aletleri', 'lokma'], ['Aydınlatma', 'lamba'], ['Hidrolik presler', 'pres'], ['Lastik ve jant ekipmanları', 'kriko'],
  ['Ölçü aletleri', 'lokma'], ['Yağlama cihazları', 'hortum'], ['Kumlama makineleri', 'kompresor'], ['Lokma ve anahtar takımları', 'lokma'],
];

// [ad, kategori no, kind, fiyat TL, eski fiyat TL, stok, rozet, kısa, öne çıkan, kademeli]
const PRODUCTS = [
  ['İki Direkli Araç Lifti', 1, 'lift2', 84900, 0, 12, 'Çok satan', '[kapasite] kg · elektrohidrolik', 1, 1],
  ['Makaslı Araç Kaldırma Lifti', 1, 'makas', 129500, 0, 6, 'Yeni', '[kapasite] kg · [platform ölçüsü]', 1, 1],
  ['Hidrolik Garaj Krikosu', 2, 'kriko', 4950, 5900, 60, 'İndirim', '[kapasite] ton · alçak profil', 1, 0],
  ['Hidrolik Atölye Presi', 7, 'pres', 9750, 0, 14, '', '[kapasite] ton · manometreli', 1, 0],
  ['Yağsız Hava Kompresörü', 3, 'kompresor', 13800, 0, 20, 'Hediyeli', '[hacim] L · [güç] kW', 1, 0],
  ['Çekmeceli Takım Arabası', 4, 'takim', 11250, 12900, 25, 'İndirim', '5 çekmece · kilitli', 1, 0],
  ['Lokma Takımı', 5, 'lokma', 3490, 0, 80, '', '1/2″ · [parça sayısı] parça', 0, 0],
  ['LED Çalışma Lambası', 6, 'lamba', 1290, 0, 120, 'Yeni', 'Tripodlu · şarjlı', 0, 0],
  ['Havalı Hortum Makarası', 3, 'hortum', 5600, 0, 30, '', '[uzunluk] m · otomatik sarım', 0, 0],
  ['Seyyar Hidrolik Pres', 7, 'pres', 14900, 16500, 9, 'İndirim', '[kapasite] ton · tekerlekli', 0, 0],
  ['Darbeli Somun Sıkma Tabancası', 5, 'lokma', 6200, 0, 45, 'Yeni', '1/2″ · [tork] Nm', 0, 0],
  ['Tripodlu LED Projektör', 6, 'lamba', 2450, 0, 70, '', '[watt] W · IP65', 0, 0],
];

const SPEC_BASE = 'Kapasite: [kapasite]\nGaranti: [süre]\nMenşei: [bilgi]\nKurulum: Satıcı desteğiyle';

const TASLAK = 'ÖNEMLİ: Bu metin bir taslaktır. Yayına almadan önce firmanızın hukuk danışmanına kontrol ettirin ve bilgileri güncelleyin.\n\n';

const PAGES = {
  hakkimizda: ['Hakkımızda', 'Prestij Servis Ekipmanları, oto servis ve sanayi atölyeleri için araç liftleri, kriko ve presler, kompresörler, takım arabaları ve el aletleri sunar.\n\n[Firma hikayesi, kuruluş yılı, çalışma prensipleri ve referanslar burada yer alacak.]'],
  iletisim: ['İletişim', 'Sorularınız, teklif ve danışmanlık talepleriniz için bize ulaşın.\n\nÇalışma saatleri: [Pazartesi – Cumartesi 08:30 – 18:00]'],
  'odeme-sistemi': ['Ödeme sistemi', 'Üç ödeme yöntemi sunulur:\n\n1) Kredi / banka kartı: Kart bilgileri bu sitede saklanmaz; ödeme kuruluşunun güvenli sayfasında girilir ve banka 3D Secure ile doğrular.\n\n2) Havale / EFT: Siparişten sonra IBAN bilgisi gösterilir. Ödemeyi yaptıktan sonra "Havale bildirimi" formunu doldurun; ödemeniz kontrol edilir ve siparişiniz hazırlanır.\n\n3) Kademeli ödeme: Araç lifti gibi yüksek tutarlı ürünlerde ön ödeme alınır, kalan tutar teslim veya montaj öncesinde ödenir.'],
  katalog: ['Katalog', 'Dijital ürün kataloğumuzu bu sayfadan indirebilirsiniz.\n\n[Katalog dosyası eklendiğinde bağlantı burada yer alacak. Şimdilik tüm ürünleri "Ürünler" sayfasından inceleyebilirsiniz.]'],
  'kargo-teslimat': ['Kargo ve teslimat', 'Siparişler ödeme onayından sonra hazırlanır. Teslimat süresi ürüne göre değişir; araç liftlerinde teslimat ve montaj tarihi sizinle ayrıca netleştirilir.\n\n[Kargo firması, teslim süresi ve ücretsiz kargo sınırı bilgileri.]'],
  'mesafeli-satis-sozlesmesi': ['Mesafeli satış sözleşmesi', TASLAK + '[Satıcı unvanı, adresi, MERSİS/vergi bilgileri]\n\n[Ürün/hizmet bedeli, ödeme şekli, teslimat, cayma hakkı ve istisnaları, uyuşmazlık çözümü maddeleri.]'],
  'iade-kosullari': ['İptal ve iade koşulları', TASLAK + '[Cayma süresi, iade adresi, kullanılmış/montajı yapılmış ürünlerde koşullar, ücret iadesi süreci.]'],
  'gizlilik-kvkk': ['Gizlilik ve KVKK aydınlatma metni', TASLAK + '[Veri sorumlusu, işlenen kişisel veriler, işleme amaçları, aktarım, saklama süresi ve haklarınız.]'],
};

function run(db) {
  const now = Date.now();
  const cats = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  if (cats === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const ic = db.prepare('INSERT INTO categories(slug,name,kind,sort) VALUES(?,?,?,?)');
      CATS.forEach(([n, k], i) => ic.run(U.slugify(n), n, k, i + 1));
      const ip = db.prepare(`INSERT INTO products(slug,sku,name,category_id,price,old_price,stock,badge,short,description,specs,kind,featured,staged_ok,sort,created_at,updated_at,search)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      PRODUCTS.forEach(([n, c, kind, price, old, stock, badge, short, feat, staged], i) => {
        ip.run(U.slugify(n), `PS-${String(i + 1).padStart(4, '0')}`, n, c, price * 100, old ? old * 100 : null, stock, badge || null, short,
          `${n}: atölyenizin günlük işlerinde güvenle kullanabileceğiniz profesyonel ekipman. [Ürün açıklaması, kullanım alanı ve avantajlar burada yer alacak.]`,
          SPEC_BASE, kind, feat, staged, i + 1, now - i * 3600000, now, U.searchKey(`${n} ${short} PS-${String(i + 1).padStart(4, '0')}`));
      });
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }
  const ip = db.prepare('INSERT OR IGNORE INTO pages(slug,title,body,updated_at) VALUES(?,?,?,?)');
  for (const [slug, [title, body]] of Object.entries(PAGES)) ip.run(slug, title, body, now);
}

module.exports = { run, PAGES };
