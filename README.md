# Prestij Servis Ekipmanları — E-ticaret Sitesi

Bağımlılıksız (npm paketi gerektirmeyen) Node.js e-ticaret sitesi. Kurulum yok: Node.js 22.13+ yüklü bir bilgisayarda çalışır.

## Hızlı başlangıç

```
node server.js          # Linux/Mac:  ./baslat.sh     Windows: baslat.bat
```

- Site: http://localhost:3000
- Yönetim paneli: http://localhost:3000/yonetim
- İlk açılışta rastgele yönetici şifresi üretilir ve `data/ilk-sifre.txt` dosyasına yazılır (kullanıcı adı: `admin`). Girişten sonra şifreyi değiştirin ve dosyayı silin.
- İlk açılışta 12 kategori ve "örnek" işaretli 12 ürün yüklenir (`SEED_DEMO=0` ile kapatılır). Gerçek ürünleri panelden ekleyin, örnekleri silin/pasife alın. Ayarlar → "Örnek veri uyarısı"nı kapatın.

## Yönetim panelinden yapılabilenler

Panel özeti, siparişler (filtre, arama, CSV dışa aktarım, durum/kargo takibi, ödeme onayı, not, yazdır), havale bildirimleri (onay/red), ürünler (ekle/düzenle/fotoğraf yükle/stok), kategoriler, mesajlar, sayfalar (hakkımızda, KVKK, iade vb.), ayarlar (IBAN, telefon, kampanya metinleri, kademeli ödeme oranı, vb.), yöneticiler, yedekler, e-bülten listesi, işlem günlüğü.

## Ödeme

| Yöntem | Durum |
|---|---|
| Havale / EFT | Çalışır. IBAN bilgisi Ayarlar'dan. Müşteri "Havale bildirimi" gönderir, yönetici onaylar. |
| Kademeli ödeme | Çalışır. Sadece "kademeli ödemeye uygun" ürünler ve toplam ≥ eşik (varsayılan 20.000 ₺) için. Ön ödeme %30 (ayarlanabilir), kalan tutar sonra. |
| Kredi / banka kartı | `PAYMENT_PROVIDER=demo` (varsayılan): **sadece sunum içindir**, gerçek tahsilat yapmaz. Canlı için `PAYMENT_PROVIDER=paytr` + PayTR mağaza anahtarları. |

**Önemli:** PayTR bağlantısı belgeye göre yazılmıştır ancak mağaza anahtarı olmadan test edilemedi. Canlıya almadan önce PayTR test modunda (`PAYTR_TEST=1`) mutlaka deneme siparişi yapın. iyzico gibi başka sağlayıcılar eklenmemiştir. Kart bilgisi bu sitede asla saklanmaz/günlüğe yazılmaz.

## Ayarlar (ortam değişkeni veya `config.json`)

`deploy/config.example.json` dosyasını `config.json` adıyla kopyalayın veya ortam değişkeni verin.

| Ad | Açıklama |
|---|---|
| PORT, HOST | Dinleme adresi (varsayılan 3000, 127.0.0.1) |
| BASE_URL | Sitenin tam adresi (https://...) — e-posta, sitemap, ödeme dönüşleri için |
| TRUST_PROXY | nginx arkasındaysa `1` |
| DATA_DIR | Veri klasörü (varsayılan `./data`) |
| PAYMENT_PROVIDER, PAYTR_MERCHANT_ID, PAYTR_KEY, PAYTR_SALT, PAYTR_TEST | Kart ödemesi |
| SMTP_HOST, SMTP_PORT, SMTP_SECURE (tls/starttls/none), SMTP_USER, SMTP_PASS, SMTP_FROM | E-posta bildirimleri. Tanımlı değilse e-postalar "outbox"ta kuyruğa alınır (panelde görülebilir). SMTP istemcisi gerçek bir sunucuyla denenmemiştir; canlıda deneme e-postası ile doğrulayın. |
| ADMIN_USER, ADMIN_PASS | İlk yönetici (verilmezse rastgele şifre) |
| LOG_KEEP_DAYS (60), BACKUP_KEEP (14) | Saklama süreleri |

## Yıllarca açık kalması için yapılanlar

- SQLite (WAL) + indeksler, her listede sayfalama; 10.000+ siparişte hız düşmez.
- Sipariş oluşturma tek işlemde (transaction): stok atomik düşer, fazla satış olmaz, çift tıklama/çift gönderim tek sipariş üretir.
- Ödenmeyen siparişler otomatik iptal edilip stok iade edilir (kart 3 saat, havale 72 saat; bekleyen havale bildirimi varsa dokunulmaz).
- Her 6 saatte otomatik yedek (son 14 saklanır), saatlik veritabanı bakımı, günlük dosyaları günlük döner ve 60 gün saklanır.
- Güvenlik: CSRF, HttpOnly/SameSite çerez, scrypt şifre, hız sınırlama, CSP ve güvenlik başlıkları, yükleme doğrulaması.
- Beklenmedik hatada süreç kapanır, systemd/Docker yeniden başlatır. Sağlık kontrolü: `/saglik`.

## Canlıya alma (Linux)

1. Klasörü `/opt/prestij` altına koyun, `prestij` kullanıcısı oluşturun.
2. `deploy/prestij.service` → `/etc/systemd/system/`; anahtarları `/etc/prestij.env` içine yazın; `systemctl enable --now prestij`.
3. `deploy/nginx.conf` ile ters vekil, `certbot` ile HTTPS.
4. Alternatif: `deploy/Dockerfile` ve `deploy/docker-compose.yml`.

## Yedek ve geri yükleme

- Panel → Yedekler: anında yedek al / indir. Otomatik yedekler `data/yedekler/`.
- Elle: `node scripts/backup.js [klasör]` (veritabanı + yüklenen fotoğraflar).
- Geri yükleme (sunucu durdurulmuşken): `node scripts/restore.js yedek.sqlite`
- Yönetici şifresi sıfırlama: `node scripts/create-admin.js admin "YeniSifre123456"`
- Düzenli olarak yedekleri başka bir makineye de kopyalayın.

## Test

- `node scripts/selftest.js` — yaklaşık 100 otomatik kontrol (sipariş, havale, kademeli ödeme, stok, güvenlik).
- `node scripts/loadtest.js 2000 24` — yük testi (geçici veri klasöründe çalışır).

## Sınırlar / yapılacaklar

- Ürün görselleri örnek çizimlerdir; gerçek fotoğrafları panelden yükleyin.
- Yasal sayfalar (mesafeli satış, KVKK, iade) taslaktır; hukukçu kontrolünden geçirin.
- Fatura/e-fatura entegrasyonu, kargo firması API entegrasyonu yoktur (kargo takip no panelden girilir).
- WordPress/WooCommerce sürümü ayrı bir aşamadır.
