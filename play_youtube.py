import time
from camoufox.sync_api import Camoufox

print("Memulai browser Camoufox dalam mode Headed (Tampilan Terbuka)...")
try:
    with Camoufox(headless=False) as browser:
        print("Membuka tab baru...")
        page = browser.new_page()
        
        print("Membuka YouTube...")
        page.goto("https://www.youtube.com")
        
        print("Mencari lagu 'Avenged Sevenfold Dear God'...")
        # Menunggu kotak pencarian YouTube muncul
        page.wait_for_selector('input[name="search_query"]')
        page.fill('input[name="search_query"]', 'Avenged Sevenfold Dear God')
        page.press('input[name="search_query"]', 'Enter')
        
        # Menunggu hasil pencarian video muncul
        print("Menunggu hasil pencarian video...")
        page.wait_for_selector('a#video-title')
        
        # Mengklik video pertama yang muncul
        print("Memutar video pertama...")
        page.click('a#video-title')
        
        # Membiarkan musik berjalan selama 60 detik sebelum browser otomatis ditutup
        print("\n=== LAGU SEDANG DIPUTAR ===")
        print("Browser akan tetap terbuka selama 60 detik agar Anda bisa mendengarkan lagu.")
        for i in range(60):
            print(f"Memutar musik... sisa waktu {60 - i} detik.")
            time.sleep(1)
            
except Exception as e:
    print(f"Terjadi error saat menjalankan otomasi: {e}")

print("Selesai! Browser ditutup.")
